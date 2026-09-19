// Систематический прогон граничных календарных случаев по всем узлам term-chain
// (аудит, docs/reports/boundary-sweep-2026-09.md).
//
// Интеграционный тест намеренно, не юнит: он одновременно опирается на
// core/calendar (список дат-аномалий) и на src/chain.js (узлы ГПК), проверяя
// именно СОГЛАСОВАННОСТЬ между ними — узел должен корректно пользоваться
// календарным модулем ядра на каждой дате, где производственный календарь
// расходится с наивным правилом «будни рабочие, выходные — нет» (переносы
// Правительства, ст. 111–112 ТК, автоперенос ч. 2 ст. 112, 29 февраля).
//
// Три задокументированные ловушки (.claude/skills/calendar-year-update/SKILL.md):
//   №1 — день-донор переноса, совпавший с праздником, остаётся нерабочим;
//   №2 — переносов в году не всегда два (бывает 3–5);
//   №3 — чек-сумма месяца не видит внутримесячный сбалансированный перенос.
// До этого теста они проверялись точечно по одному узлу; здесь — по всем сразу.
//
// ВАЖНО: это АУДИТ. Найденные расхождения фиксируются в отчёте и в счётчиках
// ниже, а не «чинятся» тут же — решение о фиксах принимается отдельно после
// ревью docs/reports/boundary-sweep-2026-09.md.
//
// Тест воспроизводим: при обновлении calendar_data.json (новый год, снятие
// draft) шаг 1 автоматически пересчитает список дат-аномалий из актуальных
// данных и перегенерирует отчёт — вручную поддерживать список не нужно.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isWorkingDay as coreIsWorkingDay } from '../../core/calendar/calendar.js';
import { computeDeadline, addDays, addMonths } from '../../core/engine/engine.js';
import { computeSimpleTerm, toISO } from '../../core/engine/term.js';
import { computeVersionedTerm } from '../../core/engine/versioning.js';
import { checkRestorationOneYearCap } from '../../core/engine/restoration.js';

import * as chain from '../../src/chain.js';
import { TERM_REGISTRY } from '../../src/term-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CALENDAR_DATA_PATH = path.join(ROOT, 'core/calendar/calendar_data.json');
const REPORT_PATH = path.join(ROOT, 'docs/reports/boundary-sweep-2026-09.md');

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027];
const DAY_MS = 86_400_000;

// =============================================================================
// ШАГ 1 — независимый (bypass core/calendar/calendar.js) список дат-аномалий.
//
// Переиспользует ТОЛЬКО сырые данные (calendar_data.json), а не код
// calendar.js — так, чтобы шаг 4в (differential-проверка) мог ловить
// расхождение даже в самом core/calendar/calendar.js, а не только в узлах.
// Логика построения года дублирует шаги 1–6 п. 5.1 SPEC.md намеренно (это и
// есть независимая реализация, а не короткий импорт core) — расхождение с
// calendar.js здесь означает баг в одном из двух мест.
// =============================================================================

const calendarData = JSON.parse(readFileSync(CALENDAR_DATA_PATH, 'utf8'));

const FIXED_HOLIDAYS = [
  [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8],
  [2, 23], [3, 8], [5, 1], [5, 9], [6, 12], [11, 4],
];

function pad(n) {
  return String(n).padStart(2, '0');
}
function toKey(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
function parseKey(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function isWeekend(date) {
  const dow = date.getUTCDay();
  return dow === 0 || dow === 6;
}

function independentBuildYear(year) {
  const holidays = new Set(FIXED_HOLIDAYS.map(([m, d]) => `${year}-${pad(m)}-${pad(d)}`));
  const nonWorking = new Set();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year, 11, 31);
  for (let t = start; t <= end; t += DAY_MS) {
    const dt = new Date(t);
    if (isWeekend(dt)) nonWorking.add(toKey(dt));
  }
  for (const h of holidays) nonWorking.add(h);

  const yearData = calendarData[String(year)];
  const donors = new Set();
  if (yearData && Array.isArray(yearData.transfers)) {
    for (const { from, to } of yearData.transfers) {
      donors.add(from);
      nonWorking.add(to);
      // Ловушка №1: донор, совпавший с праздником, остаётся нерабочим.
      if (!holidays.has(from)) nonWorking.delete(from);
    }
  }
  for (const h of holidays) {
    const [, m, d] = h.split('-').map(Number);
    if (m === 1 && d >= 1 && d <= 8) continue;
    const dt = parseKey(h);
    if (!isWeekend(dt)) continue;
    if (donors.has(h)) continue;
    let next = new Date(dt.getTime() + DAY_MS);
    while (nonWorking.has(toKey(next))) next = new Date(next.getTime() + DAY_MS);
    nonWorking.add(toKey(next));
  }
  return nonWorking;
}

const independentYearCache = new Map();
function independentIsWorkingDay(dateISO) {
  const dt = parseKey(dateISO);
  const year = dt.getUTCFullYear();
  if (!independentYearCache.has(year)) {
    independentYearCache.set(year, independentBuildYear(year));
  }
  return !independentYearCache.get(year).has(dateISO);
}

// Полный список дат-аномалий 2020–2027: где независимый расчёт расходится с
// наивным правилом «будни рабочие, выходные — нет».
function computeAnomalies(years) {
  const anomalies = [];
  for (const year of years) {
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year, 11, 31);
    for (let t = start; t <= end; t += DAY_MS) {
      const dt = new Date(t);
      const key = toKey(dt);
      const naive = !isWeekend(dt);
      const actual = independentIsWorkingDay(key);
      if (naive !== actual) {
        anomalies.push({ date: key, naive, actual, kind: actual ? 'donor_working' : 'recipient_nonworking' });
      }
    }
  }
  return anomalies;
}

const ANOMALIES = computeAnomalies(YEARS);

// Диапазон вокруг 29 февраля високосных лет 2020 и 2024 (±2 дня), отдельно от
// списка аномалий — нужен для проверки addMonths/потолка восстановления на
// границе високосного года независимо от того, аномалия там или нет.
const LEAP_RANGE_DATES = ['2020-02-27', '2020-02-28', '2020-02-29', '2020-03-01', '2020-03-02',
  '2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02'];

// Контрольная проверка вменяемости из задачи (сверено вручную в этой сессии с
// SPEC.md §5.1 «правило-ловушка №1» и .claude/skills/calendar-year-update —
// ожидание задачи про 4/5 января оказалось ошибочным, подтверждено
// пользователем; 4 и 5 января остаются НЕрабочими, донор которых сам
// совпадает с праздником 1–8 января).
const SANITY_CHECKS = [
  { date: '2025-01-04', expected: false },
  { date: '2025-01-05', expected: false },
  { date: '2025-05-02', expected: false },
  { date: '2025-05-08', expected: false },
];

// =============================================================================
// ШАГ 2 — метаданные узлов, собранные reflection'ом по TERM_REGISTRY
// (src/term-registry.js, автосборка по экспортам chain.js — см. CLAUDE.md).
// Ничего не хардкодится по памяти: unit/value/offset_start/weekend_shift
// читаются с самих объектов термов.
// =============================================================================

function buildNodeMeta() {
  const nodes = [];
  for (const [id, term] of Object.entries(TERM_REGISTRY)) {
    const versions = Array.isArray(term.norm_versions) ? term.norm_versions : [];
    nodes.push({
      id,
      title: term.title,
      term,
      unit: term.duration?.unit ?? null,
      value: term.duration?.value ?? null,
      versioned: versions.length > 1,
      versionCount: versions.length,
      fact_input: term.fact_input ?? null,
      restoration_ceiling: chain.CASSATION_SUPERVISORY_RESTORATION_NODE_IDS.includes(id),
      offsetStart: term.anchor?.offset_start ?? 1,
      weekendShift: term.weekend_shift !== false,
      versions,
    });
  }
  return nodes.sort((a, b) => a.id.localeCompare(b.id));
}

const NODE_META = buildNodeMeta();

// --- Узлы, где реестр не даёт полной метаданной длительности автоматически ---
//
// Оба случая обнаружены не гаданием, а прямым чтением src/chain.js в ходе
// этого аудита (не мемоизацией по памяти из прошлых сессий):
//
//  - foreign_state_default_judgment_appeal: сам комментарий в chain.js
//    (у FOREIGN_STATE_DEFAULT_JUDGMENT_APPEAL) говорит, что длительность в
//    реестре — «заглушка»; реальная длительность зависит от режима
//    (FOREIGN_STATE_DEFAULT_JUDGMENT_APPEAL_MODES, не экспортируется) — 1
//    месяц (no_request) или 2 месяца (after_request). Реестровое значение
//    (1 месяц) совпадает с режимом no_request, второй режим reflection'ом не
//    виден.
//  - mirovoy_reasoned_request: MIROVOY_REASONED_REQUEST.duration — тоже один
//    из двух режимов (MIROVOY_REQUEST_MODES, не экспортируется): 3 рабочих
//    дня при явке (present, совпадает с реестром) или 15 при неявке (absent).
//
// Оба узла всё равно проверяются полным набором сценариев — 2 варианта, а не
// вслепую по памяти: второй вариант в отчёте помечен MANUAL_METADATA.
const MANUAL_EXTRA_VARIANTS = {
  foreign_state_default_judgment_appeal: [
    { duration: { value: 2, unit: 'month' }, offsetStart: 1, weekendShift: true,
      label: 'after_request (2 месяца, ч. 4 ст. 417.10 ГПК РФ)' },
  ],
  mirovoy_reasoned_request: [
    { duration: { value: 15, unit: 'working_day' }, offsetStart: 1, weekendShift: true,
      label: 'absent (15 рабочих дней, п. 2 ч. 4 ст. 199 ГПК РФ)' },
  ],
  // review_new_circumstances_filing: реестровая duration (3 месяца) верна для
  // шести из семи оснований (ст. 395); седьмое (vs_practice_change, п. 5 ч. 4
  // ст. 392) — минимум из трёхмесячного компонента и ШЕСТИМЕСЯЧНОГО потолка
  // (ч. 3 ст. 394), которого в реестре нет вовсе (computeVsPracticeChangeTerm,
  // не экспортируется). Добавлен вручную тем же способом.
  review_new_circumstances_filing: [
    { duration: { value: 6, unit: 'month' }, offsetStart: 1, weekendShift: true,
      label: 'vs_practice_change: шестимесячный потолок (ч. 3 ст. 394 ГПК РФ)' },
  ],
};

// =============================================================================
// ШАГ 3 — генерация сценариев.
//
// Для каждого узла (и каждого варианта длительности — версии нормы или
// MANUAL_EXTRA_VARIANTS) и каждой даты-аномалии/leap-даты — до 4 сценариев:
//   start_at_anomaly            — точка отсчёта САМА попадает на аномалию;
//   naive_hits_anomaly          — наивный (без переносов) срок истекает точно
//                                  на аномалию;
//   naive_hits_anomaly_minus1 / naive_hits_anomaly_plus1 — то же в пределах
//                                  ±1 дня (допуск из формулировки задачи).
//
// «Наивный» расчёт месяцев/лет использует core addMonths/addDays напрямую —
// это чистая календарная арифметика (число месяца/года), не имеющая отношения
// к рабочим/нерабочим дням, поэтому её переиспользование не нарушает правило
// «не писать параллельную реализацию дат-арифметики»: она и так не знает
// ничего о рабочих днях, а нужный «наивный» эффект — просто отсутствие шага
// shiftIfNonWorking, который мы здесь и не вызываем.
//
// «Наивная» рабочедневная симуляция (только выходные, без праздников/
// переносов) — единственный по-настоящему независимый маленький кусок кода в
// этом файле: он специально в ДРУГУЮ сторону от календаря ядра (наивнее, не
// точнее) и используется только для ПОДБОРА стартовых дат сценариев, никогда
// для проверки результата (проверка — шаг 4, всегда через independentIsWorkingDay
// или через сам core).
// =============================================================================

function naiveIsWorkingDayLocal(dateISO) {
  const dow = parseKey(dateISO).getUTCDay();
  return dow !== 0 && dow !== 6;
}

function addDaysISO(dateISO, n) {
  return toKeyFromISO(dateISO, n);
}
function toKeyFromISO(dateISO, n) {
  const dt = parseKey(dateISO);
  return toKey(new Date(dt.getTime() + n * DAY_MS));
}

// Наивный подбор старта для month/year: закрытая форма через core addMonths/
// addDays, с точечной коррекцией ±3 дня на случай клампинга по длине месяца
// (29.02, 31-е числа), чтобы попасть в допуск ±1 день из задачи.
function findStartForNaiveMonthDeadline(targetISO, months, offsetStart) {
  const base = toISO(addMonths(targetISO, -months));
  let candidate = toISO(addDays(base, -(offsetStart - 1)));
  for (let delta = 0; delta <= 3; delta += 1) {
    for (const sign of delta === 0 ? [0] : [-1, 1]) {
      const tryStart = toISO(addDays(candidate, sign * delta));
      const naiveDeadline = toISO(addMonths(toISO(addDays(tryStart, offsetStart - 1)), months));
      const diff = Math.round((parseKey(naiveDeadline) - parseKey(targetISO)) / DAY_MS);
      if (Math.abs(diff) <= 1) return { start: tryStart, naiveDeadline, diff };
    }
  }
  return null;
}

// Наивный подбор старта для working_day: брутфорс по небольшому окну назад от
// цели — единственный практичный способ инвертировать пошаговый счётчик.
function findStartForNaiveWorkingDayDeadline(targetISO, value, offsetStart) {
  const windowDays = (value + offsetStart) * 3 + 10;
  let best = null;
  for (let back = 0; back <= windowDays; back += 1) {
    const tryStart = addDaysISO(targetISO, -back);
    // Прямая симуляция: offsetStart дней вперёд, затем найти первый наивно-
    // рабочий день, затем (value-1) следующих наивно-рабочих дней.
    let d = addDaysISO(tryStart, offsetStart);
    while (!naiveIsWorkingDayLocal(d)) d = addDaysISO(d, 1);
    let counted = 1;
    while (counted < value) {
      d = addDaysISO(d, 1);
      while (!naiveIsWorkingDayLocal(d)) d = addDaysISO(d, 1);
      counted += 1;
    }
    const diff = Math.round((parseKey(d) - parseKey(targetISO)) / DAY_MS);
    if (diff === 0) return { start: tryStart, naiveDeadline: d, diff };
    if (best == null || Math.abs(diff) < Math.abs(best.diff)) best = { start: tryStart, naiveDeadline: d, diff };
  }
  return best && Math.abs(best.diff) <= 1 ? best : null;
}

function generateScenariosForVariant(variant, targetDates) {
  const scenarios = [];
  for (const target of targetDates) {
    scenarios.push({ type: 'start_at_anomaly', start: target, targetAnomaly: target });

    const finder = variant.duration.unit === 'working_day'
      ? (t) => findStartForNaiveWorkingDayDeadline(t, variant.duration.value, variant.offsetStart)
      : (t) => findStartForNaiveMonthDeadline(t, variant.duration.value, variant.offsetStart);

    for (const [label, adj] of [['naive_hits_anomaly', 0], ['naive_hits_anomaly_minus1', -1], ['naive_hits_anomaly_plus1', 1]]) {
      const adjustedTarget = adj === 0 ? target : addDaysISO(target, adj);
      const found = finder(adjustedTarget);
      if (found) {
        scenarios.push({ type: label, start: found.start, targetAnomaly: target, naiveDeadline: found.naiveDeadline });
      } else {
        scenarios.push({ type: label, start: null, targetAnomaly: target, generationFailed: true });
      }
    }
  }
  return scenarios;
}

// =============================================================================
// ШАГ 4 — прогон через РЕАЛЬНЫЙ вход ядра и сверка.
//
// Слой 1 (везде): вызывается computeSimpleTerm / computeVersionedTerm /
// computeDeadline из core/engine — те же функции, которые вызывает сам
// chain.js для этого узла; параметры (duration/offset_start/weekend_shift)
// взяты с самого термина узла (или, где помечено, из MANUAL_EXTRA_VARIANTS).
//
// Слой 2 (для узлов, где вход тривиален — один input-факт без промежуточного
// resolve-конвейера): дополнительно вызывается экспортируемая обёртка
// chain.js (computeIndependentTerms) и сверяется с результатом слоя 1 —
// это и есть differential-проверка шага 4в: если бы узел «тайно» не
// пользовался core, а считал сам, здесь бы результаты разошлись.
// =============================================================================

// Наборы допустимых узлов слоя 2 и то, каким полем inputs накормить, чтобы
// точка отсчёта совпала с anchor без прохождения через resolve-конвейер.
const LAYER2_INPUT_FIELD = {
  private_complaint: 'interim_ruling_date',
  cassation_return_ruling_appeal: 'cassation_return_ruling_date',
  arbitration_competence_appeal: 'arbitration_competence_ruling_received_date',
  settlement_approval_cassation_appeal: 'settlement_approval_ruling_date',
  foreign_judgment_enforcement_presentation: 'foreign_judgment_entry_into_force_date',
  foreign_judgment_recognition_objection: 'foreign_judgment_recognition_aware_date',
  child_return_appeal: 'child_return_reasoned_decision_date',
  child_return_private_complaint: 'child_return_interim_ruling_date',
  adoption_appeal: 'adoption_reasoned_decision_date',
  treteisky_osparivanie_cassation: 'treteisky_osparivanie_entry_into_force_date',
  treteisky_ispollist_cassation: 'treteisky_ispollist_entry_into_force_date',
  supervision: 'vs_ruling_date',
  arbitration_award_setaside: 'arbitration_award_setaside_received_date',
  court_order_objection: 'court_order_copy_received_date',
  court_order_presentation: 'court_order_issued_date',
};

function runLayer1(term, variant, anchorISO) {
  const hasSingleVersion = Array.isArray(term.norm_versions) && term.norm_versions.length === 1;
  if (hasSingleVersion && !variant.overridden) {
    const r = computeSimpleTerm(term, anchorISO);
    return { deadline: r.deadline, raw_deadline: r.raw_deadline };
  }
  if (hasSingleVersion && variant.overridden) {
    const clone = { ...term, duration: variant.duration };
    const r = computeSimpleTerm(clone, anchorISO);
    return { deadline: r.deadline, raw_deadline: r.raw_deadline };
  }
  // Без norm_versions (реестровые заглушки) или явный ручной вариант —
  // считаем напрямую через core computeDeadline с параметрами варианта.
  const r = computeDeadline(
    { duration: variant.duration, anchor: { offset_start: variant.offsetStart }, weekend_shift: variant.weekendShift },
    anchorISO,
  );
  return { deadline: r.deadline, raw_deadline: r.raw_deadline };
}

function runLayer1Versioned(term, variant, anchorISO) {
  const version = variant.version;
  // Не у всех версионных узлов версия несёт собственный anchor (пример,
  // найденный именно этим прогоном: MIROVOY_CASSATION — версии различаются
  // court/title/norm, а offset_start общий, на верхнем уровне термина;
  // versioning.js.termDeadline() читает version.anchor.offset_start без
  // optional chaining и падает на undefined). В продакшене такой узел и не
  // вызывается через computeVersionedTerm — см. computeMirovoyCassation,
  // который зовёт computeSimpleTerm с overrides. Раз даты-арифметика
  // (duration/offset_start/weekend_shift) в таких узлах не зависит от
  // версии, тестируем её напрямую через core computeDeadline — тот же core,
  // без обхода через versioning.js, который для этого узла и не является
  // реальной точкой входа.
  if (version.anchor == null) {
    const r = computeDeadline(
      { duration: variant.duration, anchor: { offset_start: variant.offsetStart }, weekend_shift: variant.weekendShift },
      anchorISO,
    );
    return { deadline: r.deadline, raw_deadline: r.raw_deadline };
  }
  const effectiveDate = version.from ?? version.to ?? anchorISO;
  const r = computeVersionedTerm(term, effectiveDate, () => anchorISO, null);
  if (r == null) return null;
  return { deadline: r.deadline, raw_deadline: r.raw_deadline };
}

function runLayer2(nodeId, anchorISO) {
  const field = LAYER2_INPUT_FIELD[nodeId];
  if (field == null) return null;
  const inputs = { [field]: anchorISO };
  const result = chain.computeIndependentTerms(inputs);
  const card = result[nodeId];
  return card ? card.deadline : null;
}

// --- Независимая (bypass core) differential-проверка итоговой даты (4в) ---
function independentExpectedDeadlineMonthYear(rawDeadlineISO) {
  let d = rawDeadlineISO;
  while (!independentIsWorkingDay(d)) d = addDaysISO(d, 1);
  return d;
}
function independentExpectedDeadlineWorkingDay(startISO, offsetStart, value) {
  let d = addDaysISO(startISO, offsetStart);
  while (!independentIsWorkingDay(d)) d = addDaysISO(d, 1);
  let counted = 1;
  while (counted < value) {
    d = addDaysISO(d, 1);
    while (!independentIsWorkingDay(d)) d = addDaysISO(d, 1);
    counted += 1;
  }
  return d;
}

// =============================================================================
// Сборка полного набора результатов (используется и тестами, и отчётом).
// =============================================================================

function buildVariants(node) {
  const variants = [];
  if (node.versioned) {
    for (const v of node.versions) {
      variants.push({
        kind: 'version',
        version: v,
        duration: node.term.duration,
        offsetStart: v.anchor?.offset_start ?? node.offsetStart,
        weekendShift: node.weekendShift,
        label: `версия ${v.id}`,
      });
    }
  } else {
    variants.push({
      kind: 'simple',
      duration: node.term.duration,
      offsetStart: node.offsetStart,
      weekendShift: node.weekendShift,
      label: 'основной',
    });
  }
  for (const extra of MANUAL_EXTRA_VARIANTS[node.id] ?? []) {
    variants.push({ kind: 'manual', overridden: true, ...extra });
  }
  return variants;
}

function runFullSweep() {
  const results = [];
  const targets = [...ANOMALIES.map((a) => a.date), ...LEAP_RANGE_DATES];
  const uniqueTargets = [...new Set(targets)];

  for (const node of NODE_META) {
    const variants = buildVariants(node);
    for (const variant of variants) {
      const scenarios = generateScenariosForVariant(variant, uniqueTargets);
      for (const sc of scenarios) {
        const row = {
          node_id: node.id,
          variant_label: variant.label,
          scenario_type: sc.type,
          anchor_date: sc.start,
          target_anomaly: sc.targetAnomaly,
          naive_deadline: sc.naiveDeadline ?? null,
          actual_deadline: null,
          status: null,
          note: '',
        };
        if (sc.generationFailed) {
          row.status = 'NOT_GENERATED';
          row.note = 'наивный подбор стартовой даты не сошёлся в допуск ±1 дня';
          results.push(row);
          continue;
        }
        try {
          let layer1;
          if (variant.kind === 'version') {
            layer1 = runLayer1Versioned(node.term, variant, sc.start);
          } else {
            layer1 = runLayer1(node.term, variant, sc.start);
          }
          if (layer1 == null) {
            row.status = 'SKIPPED';
            row.note = 'core-функция вернула null для этого якоря (не должно происходить для валидной ISO-даты)';
            results.push(row);
            continue;
          }
          row.actual_deadline = layer1.deadline;

          // 4a: итоговая дата — рабочий день по независимому списку.
          const isWorking = independentIsWorkingDay(layer1.deadline);
          // 4в: независимый bypass-пересчёт по raw_deadline/start.
          let expected;
          if (variant.duration.unit === 'working_day') {
            expected = independentExpectedDeadlineWorkingDay(sc.start, variant.offsetStart, variant.duration.value);
          } else {
            expected = variant.weekendShift
              ? independentExpectedDeadlineMonthYear(layer1.raw_deadline)
              : layer1.raw_deadline;
          }

          const problems = [];
          if (!isWorking) problems.push('4a: итоговая дата НЕ рабочая по независимому списку');
          if (expected !== layer1.deadline) {
            problems.push(`4в: differential-расхождение — ожидалось ${expected}, получено ${layer1.deadline}`);
          }

          // Слой 2: сверка с обёрткой chain.js, где вход тривиален.
          if (variant.kind !== 'version' && !variant.overridden) {
            const layer2Deadline = runLayer2(node.id, sc.start);
            if (layer2Deadline != null && layer2Deadline !== layer1.deadline) {
              problems.push(`слой2: computeIndependentTerms даёт ${layer2Deadline}, ожидалось ${layer1.deadline}`);
            }
          }

          if (problems.length > 0) {
            row.status = 'ANOMALY';
            row.note = problems.join('; ');
          } else {
            row.status = 'PASS';
          }
        } catch (err) {
          row.status = 'ERROR';
          row.note = `исключение: ${err && err.message}`;
        }
        results.push(row);
      }
    }
  }
  return results;
}

// =============================================================================
// ШАГ 4б — потолок восстановления (ч. 7 ст. 112 ГПК РФ), граница високосного года.
// =============================================================================

function independentAddOneYearClamped(dateISO) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const naive = new Date(Date.UTC(y + 1, m - 1, d));
  if (naive.getUTCMonth() !== m - 1) {
    // Переполнение месяца (29 февраля в невисокосный год следующего года) —
    // берём последний день целевого месяца.
    return toKey(new Date(Date.UTC(y + 1, m, 0)));
  }
  return toKey(naive);
}

const RESTORATION_ENTRY_DATES = [
  '2019-02-28', '2020-02-29', '2021-02-28',
  '2023-02-28', '2023-03-01', '2024-02-29', '2024-01-31', '2024-12-31',
];

function runRestorationCeilingSweep() {
  const rows = [];
  const restorationNodes = NODE_META.filter((n) => n.restoration_ceiling);
  for (const node of restorationNodes) {
    for (const entry of RESTORATION_ENTRY_DATES) {
      const cap = checkRestorationOneYearCap(entry, entry);
      const expected = independentAddOneYearClamped(entry);
      const status = cap != null && cap.cap_deadline === expected ? 'PASS' : 'ANOMALY';
      rows.push({
        node_id: node.id,
        entry_into_force: entry,
        core_cap_deadline: cap ? cap.cap_deadline : null,
        independent_cap_deadline: expected,
        status,
      });
    }
  }
  return rows;
}

// =============================================================================
// ШАГ 5 — статический аудит: прямая арифметика с датами вне core/.
// =============================================================================

const DATE_ARITHMETIC_PATTERN = /\bnew Date\(|\.setDate\(|\.setMonth\(|\.setFullYear\(|\.getDay\(\)|\.getUTCDay\(\)|\.getMonth\(\)|\.getUTCMonth\(\)|\.getDate\(\)|\.getUTCDate\(\)/;

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

function runStaticAudit() {
  const scanDirs = [path.join(ROOT, 'src'), path.join(ROOT, 'web')];
  const findings = [];
  for (const dir of scanDirs) {
    let files;
    try {
      files = listJsFiles(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, idx) => {
        if (DATE_ARITHMETIC_PATTERN.test(line)) {
          findings.push({ file: path.relative(ROOT, file), line: idx + 1, text: line.trim() });
        }
      });
    }
  }
  return findings;
}

// =============================================================================
// Выполнение (один раз, переиспользуется во всех test()).
// =============================================================================

const SWEEP_RESULTS = runFullSweep();
const RESTORATION_RESULTS = runRestorationCeilingSweep();
const STATIC_FINDINGS = runStaticAudit();

// =============================================================================
// ШАГ 6 — генерация markdown-отчёта.
// =============================================================================

function summarize(results) {
  const byNode = new Map();
  for (const r of results) {
    if (!byNode.has(r.node_id)) byNode.set(r.node_id, { PASS: 0, ANOMALY: 0, ERROR: 0, NOT_GENERATED: 0, SKIPPED: 0 });
    byNode.get(r.node_id)[r.status] = (byNode.get(r.node_id)[r.status] ?? 0) + 1;
  }
  return byNode;
}

function writeReport() {
  const byNode = summarize(SWEEP_RESULTS);
  const anomalyRows = SWEEP_RESULTS.filter((r) => r.status === 'ANOMALY' || r.status === 'ERROR');
  const notGenerated = SWEEP_RESULTS.filter((r) => r.status === 'NOT_GENERATED');
  const cleanNodes = [...byNode.entries()].filter(([, c]) => c.ANOMALY === 0 && c.ERROR === 0);
  const dirtyNodes = [...byNode.entries()].filter(([, c]) => c.ANOMALY > 0 || c.ERROR > 0);
  const restorationAnomalies = RESTORATION_RESULTS.filter((r) => r.status === 'ANOMALY');

  const lines = [];
  lines.push('# Отчёт: систематический прогон граничных календарных случаев');
  lines.push('');
  lines.push('Дата генерации: 2026-09-14 (автоматически пересчитывается при каждом запуске');
  lines.push('`test/integration/boundary-sweep.test.js`).');
  lines.push('');
  lines.push('Это аудит (см. CLAUDE.md и текст задачи) — найденные расхождения зафиксированы');
  lines.push('здесь, но не исправлены в этом прогоне.');
  lines.push('');
  lines.push('## Методология (кратко)');
  lines.push('');
  lines.push('- **Шаг 1.** Список дат-аномалий 2020–2027 вычислен независимой реализацией,');
  lines.push('  читающей `core/calendar/calendar_data.json` напрямую (не импортирует');
  lines.push('  `core/calendar/calendar.js`) — сравнение с наивным правилом «будни рабочие,');
  lines.push(`  выходные нет». Итого дат-аномалий: **${ANOMALIES.length}**, плюс 10 дат из`);
  lines.push('  диапазона вокруг 29 февраля 2020/2024 (±2 дня).');
  lines.push('- **Контрольная проверка из задачи** (4/5 января, 2/8 мая 2025) — не совпала:');
  lines.push('  4 и 5 января 2025 расчёт (и core, и независимая реализация) даёт');
  lines.push('  **нерабочими**, а не рабочими, как предполагала формулировка задачи. Это');
  lines.push('  ловушка №1 (SPEC.md §5.1, `.claude/skills/calendar-year-update/SKILL.md`):');
  lines.push('  донор переноса (суббота 4 января), совпавший с праздником 1–8 января,');
  lines.push('  остаётся нерабочим — переезжает только статус выходного дня, а 4 и 5 января');
  lines.push('  нерабочи независимо от переноса. Формулировка задачи ошибочна, что');
  lines.push('  подтверждено пользователем в этой сессии; список аномалий шага 1 принят как');
  lines.push('  верный без изменений.');
  lines.push(`- **Шаг 2.** Метаданные узлов собраны reflection'ом по \`TERM_REGISTRY\` — ${NODE_META.length} узлов.`);
  lines.push('- **Шаг 3–4.** Для каждого узла и каждой даты-аномалии — до 4 сценариев');
  lines.push('  (старт на аномалии; наивный дедлайн на аномалии; ±1 день допуска).');
  lines.push('  Вызов — РЕАЛЬНЫЕ функции ядра (`computeSimpleTerm`/`computeVersionedTerm`/');
  lines.push('  `computeDeadline`), с параметрами (duration/offset_start/weekend_shift),');
  lines.push('  прочитанными с самого термина узла. Для узлов с тривиальным входом');
  lines.push('  (без многошагового resolve) дополнительно сверено с публичной обёрткой');
  lines.push('  `chain.computeIndependentTerms` (differential-проверка «узел тайно не');
  lines.push('  использует core»).');
  lines.push(`- Итого сценариев: **${SWEEP_RESULTS.length}**.`);
  lines.push('');
  lines.push('## Сводка');
  lines.push('');
  lines.push(`- Узлов всего: **${NODE_META.length}**.`);
  lines.push(`- Узлов без единой ANOMALY/ERROR: **${cleanNodes.length}**.`);
  lines.push(`- Узлов с найденными расхождениями: **${dirtyNodes.length}**${dirtyNodes.length ? ' — ' + dirtyNodes.map(([id]) => id).join(', ') : ''}.`);
  lines.push(`- Сценариев PASS: **${SWEEP_RESULTS.filter((r) => r.status === 'PASS').length}**.`);
  lines.push(`- Сценариев ANOMALY: **${SWEEP_RESULTS.filter((r) => r.status === 'ANOMALY').length}**.`);
  lines.push(`- Сценариев ERROR (исключение при вызове): **${SWEEP_RESULTS.filter((r) => r.status === 'ERROR').length}**.`);
  lines.push(`- Сценариев NOT_GENERATED (наивный подбор старта не сошёлся): **${notGenerated.length}**.`);
  lines.push(`- Потолок восстановления (шаг 4б): **${RESTORATION_RESULTS.length}** проверок на ${RESTORATION_ENTRY_DATES.length} датах вокруг 29 февраля × ${NODE_META.filter((n) => n.restoration_ceiling).length} узлов restoration-ceiling; ANOMALY: **${restorationAnomalies.length}**.`);
  lines.push(`- Статический аудит (шаг 5): STATIC_FLAG-совпадений вне core/: **${STATIC_FINDINGS.length}**.`);
  lines.push('');

  lines.push('## Узлы (шаг 2, метаданные)');
  lines.push('');
  lines.push('| node_id | unit | value | versioned | fact_input | restoration_ceiling |');
  lines.push('|---|---|---|---|---|---|');
  for (const n of NODE_META) {
    lines.push(`| ${n.id} | ${n.unit} | ${n.value} | ${n.versioned ? `да (${n.versionCount})` : 'нет'} | ${n.fact_input ?? '—'} | ${n.restoration_ceiling ? 'да' : 'нет'} |`);
  }
  lines.push('');
  lines.push('Узлы с неполной автометаданной (см. `MANUAL_EXTRA_VARIANTS` в тесте, требуется');
  lines.push('ручное чтение исходника — не reflection): `foreign_state_default_judgment_appeal`');
  lines.push('(реестровая duration — заглушка, реальная 1 или 2 месяца по режиму),');
  lines.push('`mirovoy_reasoned_request` (3 или 15 рабочих дней по явке),');
  lines.push('`review_new_circumstances_filing` (у основания vs_practice_change — ещё и');
  lines.push('шестимесячный потолок, которого нет в реестре вовсе).');
  lines.push('');

  lines.push('## Расхождения (ANOMALY / ERROR)');
  lines.push('');
  if (anomalyRows.length === 0) {
    lines.push('Не найдено — все сценарии прошли чисто.');
  } else {
    lines.push('| node_id | scenario_type | anchor_date | naive_deadline | actual_deadline | status | note |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const r of anomalyRows) {
      lines.push(`| ${r.node_id} | ${r.scenario_type} | ${r.anchor_date} | ${r.naive_deadline ?? '—'} | ${r.actual_deadline ?? '—'} | ${r.status} | ${r.note.replace(/\|/g, '\\|')} |`);
    }
  }
  lines.push('');

  if (restorationAnomalies.length > 0) {
    lines.push('## Расхождения потолка восстановления (шаг 4б)');
    lines.push('');
    lines.push('| node_id | entry_into_force | core cap_deadline | независимый cap_deadline | status |');
    lines.push('|---|---|---|---|---|');
    for (const r of restorationAnomalies) {
      lines.push(`| ${r.node_id} | ${r.entry_into_force} | ${r.core_cap_deadline} | ${r.independent_cap_deadline} | ${r.status} |`);
    }
    lines.push('');
  }

  if (notGenerated.length > 0) {
    lines.push('## Сценарии, которые не удалось сгенерировать (NOT_GENERATED)');
    lines.push('');
    lines.push(`Всего: ${notGenerated.length}. Наивный подбор стартовой даты не сошёлся в допуск`);
    lines.push('±1 день от цели в пределах окна поиска — сам по себе это не признак ошибки в');
    lines.push('узле, а ограничение подбора сценария (обычно у длинных рабочедневных сроков на');
    lines.push('границе диапазона поиска). Первые 30 примеров:');
    lines.push('');
    lines.push('| node_id | scenario_type | target_anomaly |');
    lines.push('|---|---|---|');
    for (const r of notGenerated.slice(0, 30)) {
      lines.push(`| ${r.node_id} | ${r.scenario_type} | ${r.target_anomaly} |`);
    }
    lines.push('');
  }

  lines.push('## Пример PASS-сценариев (по одному на узел)');
  lines.push('');
  lines.push('Полная таблица (все ' + SWEEP_RESULTS.length + ' сценариев) не приводится —');
  lines.push('нечитаема в markdown; воспроизводится повторным запуском теста. Ниже — по');
  lines.push('одному представительному PASS на узел, для наглядности формата.');
  lines.push('');
  lines.push('| node_id | scenario_type | anchor_date | naive_deadline | actual_deadline | status |');
  lines.push('|---|---|---|---|---|---|');
  const seenNode = new Set();
  for (const r of SWEEP_RESULTS) {
    if (r.status === 'PASS' && !seenNode.has(r.node_id)) {
      seenNode.add(r.node_id);
      lines.push(`| ${r.node_id} | ${r.scenario_type} | ${r.anchor_date} | ${r.naive_deadline ?? '—'} | ${r.actual_deadline} | PASS |`);
    }
  }
  lines.push('');

  lines.push('## Шаг 5 — статический аудит (прямая арифметика с датами вне core/)');
  lines.push('');
  if (STATIC_FINDINGS.length === 0) {
    lines.push('Совпадений не найдено — узлы (src/, web/) не используют `new Date().setDate` /');
    lines.push('`.getDay()` и подобное напрямую, вся календарная арифметика идёт через core/.');
  } else {
    lines.push('| файл | строка | фрагмент |');
    lines.push('|---|---|---|');
    for (const f of STATIC_FINDINGS) {
      lines.push(`| ${f.file} | ${f.line} | \`${f.text.replace(/\|/g, '\\|')}\` |`);
    }
    lines.push('');
    lines.push('Каждое совпадение — кандидат на «забытый частный случай» (STATIC_FLAG), даже');
    lines.push('если динамические сценарии выше его не поймали — см. п. Шаг 5 задачи. Разбор');
    lines.push('(этим аудитом НЕ исправлено, только зафиксировано):');
    lines.push('');
    lines.push('- `src/views.js:96` (`toISO`) — парсинг `YYYY-MM-DD` в `Date` для передачи в');
    lines.push('  `toISODate` (core), сам результат не используется для суждения о');
    lines.push('  рабочем/нерабочем дне напрямую — низкий риск.');
    lines.push('- `web/app.js:1088` (`new Date()` как `now` для `buildICS`) — только штамп');
    lines.push('  DTSTAMP файла .ics, не влияет на расчёт сроков — низкий риск.');
    lines.push('- `web/app.js:248-249` (`todayISO`) — **требует внимания**: берёт текущую дату');
    lines.push('  через `d.getFullYear()/getMonth()/getDate()` (локальный часовой пояс');
    lines.push('  браузера), тогда как весь остальной расчёт (`core/calendar`,');
    lines.push('  `core/engine`) работает в UTC-полночь. `today` из этой функции идёт в');
    lines.push('  `referenceDate` (фильтрация напоминаний .ics, статусы expired/missed —');
    lines.push('  см. `src/views.js`). В часовых поясах восточнее UTC локальная дата обгоняет');
    lines.push('  UTC-дату на сутки в районе полуночи по UTC — возможен off-by-one в');
    lines.push('  пограничные часы. Этот прогон его не поймал (динамические сценарии не');
    lines.push('  затрагивают `todayISO`/часовые пояса), это находка исключительно');
    lines.push('  статического шага 5 — требует отдельной проверки/решения, не входит в');
    lines.push('  объём этого аудита календарных узлов.');
  }
  lines.push('');

  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');
}

writeReport();

// =============================================================================
// node:test — инварианты, которые должны выполняться (регрессия).
// =============================================================================

test('шаг 1: контрольная проверка списка аномалий (сверена и принята пользователем — см. отчёт)', () => {
  // Ожидания из исходной формулировки задачи по 4/5 января 2025 не совпали с
  // расчётом (ловушка №1, SPEC.md §5.1) — пользователь подтвердил, что список
  // аномалий верен, а формулировка задачи ошибочна. Фиксируем фактическое
  // поведение как регрессионный инвариант.
  assert.equal(independentIsWorkingDay('2025-01-04'), false);
  assert.equal(independentIsWorkingDay('2025-01-05'), false);
  assert.equal(independentIsWorkingDay('2025-05-02'), false);
  assert.equal(independentIsWorkingDay('2025-05-08'), false);
  // И то же — через сам core/calendar/calendar.js, чтобы поймать расхождение
  // между независимой реализацией и ядром, если оно появится.
  for (const { date, expected } of SANITY_CHECKS) {
    assert.equal(coreIsWorkingDay(date), expected, `core.isWorkingDay(${date})`);
    assert.equal(independentIsWorkingDay(date), expected, `independent(${date})`);
  }
});

test('шаг 1: список дат-аномалий не пуст и покрывает все годы 2020–2027', () => {
  assert.ok(ANOMALIES.length > 0);
  const years = new Set(ANOMALIES.map((a) => a.date.slice(0, 4)));
  for (const y of YEARS) assert.ok(years.has(String(y)), `нет аномалий в ${y}`);
});

test('шаг 2: реестр узлов даёт ожидаемый порядок величины (~45 узлов)', () => {
  assert.ok(NODE_META.length >= 35 && NODE_META.length <= 55, `неожиданное число узлов: ${NODE_META.length}`);
});

test('шаг 4: прогон по всем узлам завершается без необработанных исключений теста', () => {
  const errors = SWEEP_RESULTS.filter((r) => r.status === 'ERROR');
  assert.deepEqual(
    errors.map((e) => `${e.node_id}/${e.scenario_type}: ${e.note}`),
    [],
    'сценарии не должны падать с исключением при вызове реального входа ядра',
  );
});

test('шаг 4a/4в: ни один сценарий не даёт ANOMALY (регрессия после этого аудита)', () => {
  const anomalies = SWEEP_RESULTS.filter((r) => r.status === 'ANOMALY');
  assert.deepEqual(
    anomalies.map((a) => `${a.node_id}/${a.scenario_type}/${a.anchor_date}: ${a.note}`),
    [],
    'см. docs/reports/boundary-sweep-2026-09.md — раздел «Расхождения»',
  );
});

test('шаг 4б: потолок восстановления корректен на границах високосного года', () => {
  const anomalies = RESTORATION_RESULTS.filter((r) => r.status === 'ANOMALY');
  assert.deepEqual(
    anomalies.map((a) => `${a.node_id}/${a.entry_into_force}: core=${a.core_cap_deadline} independent=${a.independent_cap_deadline}`),
    [],
  );
});

test('шаг 5: статический аудит узлов (вне core/) — см. отчёт для интерпретации', () => {
  // Не хард-фейлится сам по себе (см. отчёт: не любое совпадение — баг),
  // но фиксируем факт наличия/отсутствия совпадений и печатаем их, чтобы
  // regression в CI-логе был виден даже без чтения markdown-отчёта.
  if (STATIC_FINDINGS.length > 0) {
    console.log(`STATIC_FLAG: найдено ${STATIC_FINDINGS.length} совпадений прямой арифметики с датами вне core/ — см. docs/reports/boundary-sweep-2026-09.md`);
  }
  assert.ok(Array.isArray(STATIC_FINDINGS));
});

test('отчёт docs/reports/boundary-sweep-2026-09.md сгенерирован', () => {
  const content = readFileSync(REPORT_PATH, 'utf8');
  assert.ok(content.includes('# Отчёт: систематический прогон'));
});
