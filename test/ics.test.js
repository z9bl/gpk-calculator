// Тест экспорта .ics (раздел 8, задача 5 SPEC.md).

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildICS, icsTermsFromChain, icsTermsFromView, TERM_REGISTRY } from '../src/ics.js';
import { buildView } from '../src/views.js';
import { computeChain } from '../src/chain.js';
import { addDays, addMonths } from '../src/engine.js';
import { toISODate, isWorkingDay, shiftBackIfNonWorking, subtractWorkingDays } from '../src/calendar.js';

const NOW = '2025-01-01T00:00:00Z'; // фиксируем DTSTAMP для детерминизма

const byId = (nodes, id) => nodes.find((n) => n.id === id);

const APPEAL = {
  title: 'Апелляционная жалоба',
  deadline: '2025-06-16',
  norm: 'ч. 1 ст. 321 ГПК РФ',
  ics: true,
  duration: { value: 1, unit: 'month' },
};
const TRANSFER = {
  title: 'Направление дела в апелляционную инстанцию',
  deadline: '2025-06-20',
  norm: 'ч. 4 ст. 321 ГПК РФ',
  ics: false,
  duration: { value: 3, unit: 'day' },
};

// Мини-парсер для валидации формата.
function parseICS(text) {
  assert.ok(text.includes('\r\n'), 'строки должны разделяться CRLF');
  const raw = text.split('\r\n');
  const enc = new TextEncoder();
  for (const line of raw) {
    assert.ok(enc.encode(line).length <= 75, `строка > 75 октетов: ${line}`);
  }
  const logical = [];
  for (const line of raw) {
    if (line === '') continue;
    if (line.startsWith(' ')) logical[logical.length - 1] += line.slice(1);
    else logical.push(line);
  }
  return logical;
}

test('4. Файл проходит валидацию формата', () => {
  const terms = [APPEAL, { ...APPEAL, title: 'Кассационная жалоба в КСОЮ', deadline: '2025-09-10', duration: { value: 3, unit: 'month' } }];
  const ics = buildICS(terms, { referenceDate: '2025-05-01', now: NOW });
  const lines = parseICS(ics);

  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines[lines.length - 1], 'END:VCALENDAR');
  assert.ok(lines.includes('VERSION:2.0'));
  assert.ok(lines.some((l) => l.startsWith('PRODID:')));

  // Сбалансированность BEGIN/END и обязательные поля VEVENT.
  const stack = [];
  let events = 0;
  let cur = null;
  for (const l of lines) {
    if (l.startsWith('BEGIN:')) {
      const t = l.slice(6);
      stack.push(t);
      if (t === 'VEVENT') { cur = new Set(); events += 1; }
    } else if (l.startsWith('END:')) {
      const t = l.slice(4);
      assert.equal(stack.pop(), t, 'BEGIN/END должны совпадать');
      if (t === 'VEVENT') {
        for (const req of ['UID', 'DTSTAMP', 'DTSTART', 'SUMMARY']) {
          assert.ok(cur.has(req), `в VEVENT нет обязательного ${req}`);
        }
        cur = null;
      }
    } else if (cur) {
      cur.add(l.split(/[:;]/)[0]);
    }
  }
  assert.equal(stack.length, 0, 'все блоки закрыты');
  assert.equal(events, 2);

  // Событие на весь день в дату дедлайна; норма в описании.
  assert.ok(lines.includes('DTSTART;VALUE=DATE:20250616'));
  // В названии события — пояснение, что означает дата: в календаре видно
  // только название.
  assert.ok(lines.includes('SUMMARY:Апелляционная жалоба — последний день подачи'));
  assert.ok(lines.some((l) => l.startsWith('DESCRIPTION:Норма: ч. 1 ст. 321')));
});

test('1. Сроки с ics: false в файл не попадают', () => {
  const ics = buildICS([APPEAL, TRANSFER], { referenceDate: '2025-05-01', now: NOW });
  assert.ok(ics.includes('SUMMARY:Апелляционная жалоба'));
  assert.ok(!ics.includes('Направление дела'), 'срок с ics:false не должен экспортироваться');
});

test('2. Напоминание, выпавшее на нерабочий день, сдвинуто назад', () => {
  // deadline 16.06.2025, срок 1 мес → напоминания за 3 и 7 дней: 13.06 и 09.06.
  // 13.06.2025 — нерабочий (перенос 08.03→13.06), 12.06 — праздник → сдвиг к 11.06.
  const ics = buildICS([APPEAL], { referenceDate: '2025-05-01', now: NOW });
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20250611T090000Z'), 'сдвинуто на 11.06 (пятница→среда рабочий)');
  assert.ok(!ics.includes('20250613T090000Z'), 'исходная нерабочая дата не должна остаться');
  // рабочее напоминание не сдвигается
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20250609T090000Z'));
});

test('3. Напоминание раньше даты расчёта не создаётся', () => {
  // Дата расчёта 10.06.2025: напоминание за 7 дней (09.06) — в прошлом, отсекается;
  // за 3 дня (13.06 → 11.06 после сдвига с нерабочего) — остаётся.
  const ics = buildICS([APPEAL], { referenceDate: '2025-06-10', now: NOW });
  assert.ok(!ics.includes('20250609T090000Z'), 'напоминание до даты расчёта не создаётся');
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20250611T090000Z'), 'более позднее — остаётся');
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 1);
});

test('интеграция: computeChain → icsTermsFromChain → buildICS (обжаловано)', () => {
  const chain = computeChain(
    {
      reasoned_decision_date: '2025-03-11',
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      appeal_ruling_reasoned_date: '2025-06-02',
    },
    { today: '2025-07-01' },
  );
  const terms = icsTermsFromChain(chain);
  // Обжаловано и вступление в силу разрешено → к апелляции и кассации
  // добавляется срок предъявления ИЛ (событие разрешено).
  assert.deepEqual(terms.map((t) => t.title), [
    'Апелляционная жалоба',
    'Кассационная жалоба в КСОЮ',
    'Предъявление исполнительного листа к исполнению',
  ]);
  const ics = buildICS(terms, { referenceDate: '2025-01-01', now: NOW });
  const events = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(events, 3);
  // кассация (3 мес) даёт до 4 напоминаний
  assert.ok((ics.match(/BEGIN:VALARM/g) || []).length >= 4);
});

test('pending: кассация не рассчитана — в экспорт попадает только апелляция', () => {
  const chain = computeChain({ reasoned_decision_date: '2025-03-11' }, { today: '2025-04-01' });
  const terms = icsTermsFromChain(chain);
  assert.deepEqual(terms.map((t) => t.title), ['Апелляционная жалоба']);
});

test('5. срок предъявления ИЛ уходит в .ics', () => {
  const chain = computeChain({ reasoned_decision_date: '2025-03-11' }, { today: '2025-05-01' });
  const terms = icsTermsFromChain(chain);
  const il = terms.find((t) => t.title.includes('исполнительного листа'));
  assert.ok(il, 'срок ИЛ в списке экспортируемых');
  assert.equal(il.deadline, chain.enforcement.deadline);

  const ics = buildICS(terms, { referenceDate: '2025-05-01', now: NOW });
  // SUMMARY длинная (кириллица) и сворачивается — проверяем префикс до сгиба.
  assert.ok(ics.includes('SUMMARY:Предъявление'));
  // событие на весь день в дату дедлайна
  const compact = chain.enforcement.deadline.replace(/-/g, '');
  assert.ok(ics.includes(`DTSTART;VALUE=DATE:${compact}`));
});

test('ИЛ упрощённого и заочного уходят в .ics с той же структурой (3 года → 2 напоминания)', () => {
  // Упрощённое: событие ст. 232.4 разрешено (ч. 5) → ИЛ экспортируется.
  const sView = buildView({ simplified_resolution_date: '2025-12-22' }, { today: '2026-03-01' });
  const sTerm = icsTermsFromView(sView).find((t) => t.title.includes('исполнительного листа'));
  assert.ok(sTerm, 'ИЛ упрощённого в списке экспорта');
  assert.deepEqual(sTerm.duration, { value: 3, unit: 'year' });
  const sIcs = buildICS([sTerm], { referenceDate: '2020-01-01', now: NOW });
  assert.equal((sIcs.match(/BEGIN:VALARM/g) || []).length, 2); // как в общем порядке

  // Заочное: событие ч. 1 ст. 244 разрешено → ИЛ экспортируется.
  const dView = buildView(
    { default_judgment_service_date: '2025-12-22', default_judgment_refusal_date: '2026-02-10' },
    { today: '2026-03-01' },
  );
  const dTerm = icsTermsFromView(dView).find((t) => t.title.includes('исполнительного листа'));
  assert.ok(dTerm, 'ИЛ заочного в списке экспорта');
  assert.deepEqual(dTerm.duration, { value: 3, unit: 'year' });
  const dIcs = buildICS([dTerm], { referenceDate: '2020-01-01', now: NOW });
  assert.equal((dIcs.match(/BEGIN:VALARM/g) || []).length, 2);

  // Мировой судья: событие ч. 1 ст. 209 разрешено (не обжаловано) → ИЛ экспортируется.
  const mView = buildView({ mirovoy_resolution_date: '2025-12-22' }, { today: '2026-03-01' });
  const mTerm = icsTermsFromView(mView).find((t) => t.title.includes('исполнительного листа'));
  assert.ok(mTerm, 'ИЛ мирового в списке экспорта');
  assert.deepEqual(mTerm.duration, { value: 3, unit: 'year' });
  const mIcs = buildICS([mTerm], { referenceDate: '2020-01-01', now: NOW });
  assert.equal((mIcs.match(/BEGIN:VALARM/g) || []).length, 2);
});

// --- Напоминания для сроков в годах (3 года: 3 мес / 1 мес / 7 дней) --------

// Срок предъявления ИЛ (3 года) с дедлайном 10.07.2028. Заранее проверено:
// 3 мес назад → 10.04.2028 (пн, рабочий); 1 мес назад → 10.06.2028 (сб,
// нерабочий → сдвиг на 09.06.2028, пт); 7 дней назад → 03.07.2028 (пн, рабочий).
const IL_TERM = {
  title: 'Предъявление исполнительного листа к исполнению',
  deadline: '2028-07-10',
  norm: 'ч. 1 ст. 21 ФЗ от 02.10.2007 № 229-ФЗ',
  ics: true,
  duration: { value: 3, unit: 'year' },
};

test('1. срок в годах: оба напоминания создаются на верных датах', () => {
  const ics = buildICS([IL_TERM], { referenceDate: '2025-01-01', now: NOW });
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20280703T090000Z')); // 7 дней
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20280609T090000Z')); // 1 мес, сдвинут с 10.06 (сб)
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
});

test('2. смещение в месяцах клампится на последний день короткого месяца', () => {
  // Сама механика клампинга (та же логика, что addMonths), на несколько месяцев.
  assert.equal(toISODate(addMonths('2027-05-31', -3)), '2027-02-28');
  assert.equal(toISODate(addMonths('2027-05-31', -1)), '2027-04-30');

  // Правило годового срока — за месяц до дедлайна: 31.05.2027 − 1 мес = 30.04.2027
  // (в апреле нет 31 числа), это пятница — сдвигать не нужно.
  const term = { ...IL_TERM, deadline: '2027-05-31' };
  const ics = buildICS([term], { referenceDate: '2025-01-01', now: NOW });
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20270430T090000Z'));
  assert.ok(!ics.includes('20270531T090000Z'), 'напоминание не совпадает с дедлайном');
});

test('3. напоминание, выпавшее на нерабочий день, сдвинуто назад', () => {
  // 1-месячное напоминание для дедлайна 10.07.2028: 10.06.2028 — суббота.
  const ics = buildICS([IL_TERM], { referenceDate: '2025-01-01', now: NOW });
  assert.ok(!ics.includes('20280610T090000Z'), 'исходная нерабочая дата не должна остаться');
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20280609T090000Z'));
});

test('4. расчёт от старого решения: часть напоминаний в прошлом — создаются только будущие', () => {
  // referenceDate после 3-месячного (10.04) и сдвинутого 1-месячного (09.06)
  // напоминаний, но до 7-дневного (03.07) — создаётся только последнее.
  const ics = buildICS([IL_TERM], { referenceDate: '2028-06-15', now: NOW });
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 1);
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20280703T090000Z'));
  assert.ok(!ics.includes('20280410T090000Z'));
  assert.ok(!ics.includes('20280609T090000Z'));
});

// --- Напоминания для сроков в рабочих днях -----------------------------------
// Смещения считаются в рабочих днях: срок исчисляется в них же, а календарное
// смещение на каникулах даёт меньший запас, чем задумано (см. проверку ниже).

// Замечания на протокол: 5 рабочих дней от 28.12.2025 → дедлайн 14.01.2026.
const REMARKS_TERM = {
  title: 'Замечания на протокол судебного заседания',
  deadline: '2026-01-14',
  norm: 'ч. 1 ст. 231 ГПК РФ',
  ics: true,
  duration: { value: 5, unit: 'working_day' },
};

// Частная жалоба: 15 рабочих дней от 15.12.2025 → дедлайн 15.01.2026
// (срок пересекает январские каникулы).
const COMPLAINT_TERM = {
  title: 'Частная жалоба на определение суда первой инстанции',
  deadline: '2026-01-15',
  norm: 'ст. 332 ГПК РФ',
  ics: true,
  duration: { value: 15, unit: 'working_day' },
};

test('для 5-дневного срока создаются два напоминания: за 1 и за 2 рабочих дня', () => {
  const ics = buildICS([REMARKS_TERM], { referenceDate: '2025-12-29', now: NOW });
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
  // 14.01 → 13.01 (1 рабочий день) → 12.01 (2 рабочих дня)
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20260113T090000Z'));
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20260112T090000Z'));
});

test('срок, пересекающий январские каникулы: напоминания не уходят раньше даты расчёта', () => {
  const referenceDate = '2025-12-16'; // день расчёта, сразу после вынесения определения
  const ics = buildICS([COMPLAINT_TERM], { referenceDate, now: NOW });

  // Оба напоминания созданы (ни одно не отсеяно как прошлое).
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
  const triggers = [...ics.matchAll(/TRIGGER;VALUE=DATE-TIME:(\d{4})(\d{2})(\d{2})T/g)].map(
    (m) => `${m[1]}-${m[2]}-${m[3]}`,
  );
  // 15.01 − 3 рабочих = 12.01.2026; 15.01 − 7 рабочих = 25.12.2025 (через каникулы).
  // Порядок в файле — от ближайшего к дедлайну к более раннему.
  assert.deepEqual(triggers, ['2026-01-12', '2025-12-25']);

  for (const t of triggers) {
    assert.ok(t >= referenceDate, `напоминание ${t} не раньше даты расчёта`);
    assert.ok(t <= COMPLAINT_TERM.deadline, `напоминание ${t} не позже дедлайна`);
    assert.ok(isWorkingDay(t), `напоминание ${t} — рабочий день по построению`);
  }
});

test('смещение в рабочих днях даёт больший запас, чем календарное, на каникулах', () => {
  // 7 рабочих дней назад от 15.01.2026 = 25.12.2025 — семь рабочих дней запаса.
  assert.equal(subtractWorkingDays('2026-01-15', 7), '2025-12-25');
  // 7 календарных дней назад = 08.01.2026 — нерабочий день внутри каникул;
  // после сдвига назад это 30.12.2025, то есть всего 4 рабочих дня запаса.
  const calendarRaw = toISODate(addDays('2026-01-15', -7));
  assert.equal(calendarRaw, '2026-01-08');
  assert.ok(!isWorkingDay(calendarRaw));
  assert.equal(shiftBackIfNonWorking(calendarRaw), '2025-12-30');
  assert.equal(subtractWorkingDays('2026-01-15', 4), '2025-12-30');
});

// --- Структурная проверка полноты экспорта ----------------------------------
// Проверяем по списку узлов, а не перечислением: следующий добавленный узел с
// ics: true обязан попасть и в реестр, и в скачиваемый файл — иначе тест падает.

// Входные данные, активирующие все ветви расчёта сразу.
const ALL_BRANCHES_INPUTS = {
  // цепочка общего порядка (вступление в силу разрешено → появляется срок ИЛ)
  reasoned_decision_date: '2025-03-11',
  appeal_filed_date: '2025-04-05',
  appeal_ruling_date: '2025-06-02',
  appeal_ruling_reasoned_date: '2025-06-10',
  // кассация в ВС
  ksoyu_ruling_date: '2025-08-01',
  ksoyu_ruling_reasoned_date: '2025-08-05',
  // сроки в рабочих днях
  protocol_signed_date: '2025-07-01',
  interim_ruling_date: '2025-07-02',
  // упрощённое производство
  simplified_resolution_date: '2025-07-03',
  simplified_reasoned_request_date: '2025-07-04',
  simplified_reasoned_date: '2025-07-10',
  // заочное решение
  default_judgment_service_date: '2025-07-05',
  default_judgment_refusal_date: '2025-08-10',
  // надзор в Президиум ВС
  vs_ruling_date: '2025-09-01',
  // мировой судья
  mirovoy_resolution_date: '2025-07-06',
  mirovoy_request_date: '2025-07-07',
  mirovoy_reasoned_date: '2025-07-15',
  // Принятие апелляционного определения — вступление в силу и предъявление ИЛ.
  mirovoy_appeal_ruling_date: '2025-08-15',
  // Мотивированное апелляционное определение районного суда: открывает узел
  // кассации по делам мировых судей, не требуя, чтобы срок апелляции истёк.
  mirovoy_appeal_ruling_reasoned_date: '2025-08-20',
  // судебный приказ (независимый трек, глава 11 ГПК)
  court_order_issued_date: '2023-04-12',
};

// Дата расчёта для проверок полноты экспорта — раньше всех дедлайнов набора.
// Истёкшие сроки в .ics не выгружаются (это отдельная проверка ниже), и если
// вести проверку полноты от поздней даты, отсев по истечении скрывал бы узлы.
const BEFORE_ALL_DEADLINES = '2025-07-01';

test('реестр сроков собран из chain.js и покрывает все узлы с ics: true', () => {
  const withIcs = Object.values(TERM_REGISTRY).filter((t) => t.ics === true);
  assert.ok(withIcs.length >= 12, `в реестре ${withIcs.length} экспортируемых сроков`);
  // Реестр строится по id — id должен совпадать с ключом.
  for (const [id, term] of Object.entries(TERM_REGISTRY)) {
    assert.equal(term.id, id);
    assert.ok(term.duration && term.duration.unit, `${id}: нет duration`);
  }
});

test('каждый узел с ics: true попадает в скачиваемый файл', () => {
  const view = buildView(ALL_BRANCHES_INPUTS, { today: BEFORE_ALL_DEADLINES });
  const terms = icsTermsFromView(view); // ровно тот путь, что у кнопки «Скачать»
  const ics = buildICS(terms, { referenceDate: '2020-01-01', now: NOW });

  const visibleIds = new Set(view.cards.map((c) => c.id));
  const expected = Object.values(TERM_REGISTRY).filter(
    (t) => t.ics === true && visibleIds.has(t.id),
  );
  // Набор входных данных должен активировать все экспортируемые узлы: иначе
  // проверка становится дырявой и новый узел проскочит.
  const missingFromView = Object.values(TERM_REGISTRY)
    .filter((t) => t.ics === true && !visibleIds.has(t.id))
    .map((t) => t.id);
  assert.deepEqual(missingFromView, [], 'все узлы с ics:true должны быть видны в этом наборе');

  const exportedTitles = terms.map((t) => t.title);
  for (const term of expected) {
    const card = view.cards.find((c) => c.id === term.id);
    assert.ok(
      exportedTitles.includes(card.title),
      `узел ${term.id} не попал в список экспорта`,
    );
    // И сам дедлайн присутствует в файле как событие на весь день.
    assert.ok(
      ics.includes(`DTSTART;VALUE=DATE:${card.deadline.replace(/-/g, '')}`),
      `узел ${term.id}: дедлайн ${card.deadline} отсутствует в .ics`,
    );
  }
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, expected.length);
});

test('узлы с ics: false в файл не попадают', () => {
  const view = buildView(ALL_BRANCHES_INPUTS, { today: BEFORE_ALL_DEADLINES });
  const exportedIds = new Set(
    icsTermsFromView(view).map((t) => view.cards.find((c) => c.title === t.title)?.id),
  );
  for (const term of Object.values(TERM_REGISTRY)) {
    if (term.ics === false) {
      assert.ok(!exportedIds.has(term.id), `справочный срок ${term.id} не должен экспортироваться`);
    }
  }
});

test('длительность берётся из карточки: 15 рабочих дней у мирового без явки', () => {
  // Регрессия: реестр несёт 3 рабочих дня (значение по умолчанию), а при отсутствии
  // явки срок 15-дневный — правила напоминаний должны соответствовать факту.
  const view = buildView(
    { mirovoy_resolution_date: '2025-12-22', mirovoy_attendance: 'absent' },
    { today: '2026-01-15' },
  );
  const term = icsTermsFromView(view).find((t) => t.title.includes('мотивированного решения'));
  assert.deepEqual(term.duration, { value: 15, unit: 'working_day' });
  const ics = buildICS([term], { referenceDate: '2020-01-01', now: NOW });
  // 15 рабочих дней → два напоминания (за 7 и 3), а не одно (правило для 3 дней).
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
});

test('надзор уходит в .ics с напоминаниями трёхмесячного срока (за 3 и 14 дней)', () => {
  const view = buildView({ vs_ruling_date: '2027-09-01' }, { today: '2026-07-26' });
  const terms = icsTermsFromView(view);
  const sup = terms.find((t) => t.title.includes('Надзорная'));
  assert.ok(sup, 'надзорный срок в списке экспорта');
  assert.deepEqual(sup.duration, { value: 3, unit: 'month' });

  const ics = buildICS(terms, { referenceDate: '2026-07-26', now: NOW });
  assert.ok(ics.includes(`DTSTART;VALUE=DATE:${sup.deadline.replace(/-/g, '')}`));
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2); // за 3 и за 14 дней
});

test('предъявление судебного приказа уходит в .ics (3 года → 2 напоминания)', () => {
  const view = buildView({ court_order_issued_date: '2023-04-12' }, { today: '2026-03-01' });
  const terms = icsTermsFromView(view);
  const co = terms.find((t) => t.title.includes('судебного приказа'));
  assert.ok(co, 'срок предъявления судебного приказа в списке экспорта');
  assert.deepEqual(co.duration, { value: 3, unit: 'year' });
  assert.equal(co.deadline, '2026-04-13');
  assert.match(co.norm, /ч\. 3 ст\. 21/);

  const ics = buildICS(terms, { referenceDate: '2020-01-01', now: NOW });
  assert.ok(ics.includes(`DTSTART;VALUE=DATE:${co.deadline.replace(/-/g, '')}`));
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2); // как у других трёхлетних сроков
});

// --- Истёкшие сроки и отсечение прошлых напоминаний --------------------------

test('истёкший срок в .ics не выгружается', () => {
  const inputs = { reasoned_decision_date: '2025-03-11' }; // апелляция → 11.04.2025

  // До дедлайна срок экспортируется.
  const live = buildView(inputs, { today: '2025-04-01' });
  assert.equal(byId(live.cards, 'appeal_general').status, 'computed');
  const liveIcs = buildICS(icsTermsFromView(live), { referenceDate: '2025-04-01', now: NOW });
  assert.ok(liveIcs.includes('DTSTART;VALUE=DATE:20250411'));

  // После — не экспортируется вовсе: напоминать не о чем.
  const expired = buildView(inputs, { today: '2025-04-20' });
  assert.equal(byId(expired.cards, 'appeal_general').status, 'expired');
  const terms = icsTermsFromView(expired);
  assert.ok(!terms.some((t) => /Апелляционная жалоба/.test(t.title)));
  const expiredIcs = buildICS(terms, { referenceDate: '2025-04-20', now: NOW });
  assert.ok(!expiredIcs.includes('DTSTART;VALUE=DATE:20250411'));
});

test('все напоминания отсечены, но срок не истёк — событие остаётся в файле', () => {
  // Апелляция 11.04.2025, напоминания за 14/7/3 дня → 28.03, 04.04, 08.04.
  // Смотрим из 10.04: все напоминания в прошлом, а сам срок ещё идёт.
  const view = buildView({ reasoned_decision_date: '2025-03-11' }, { today: '2025-04-10' });
  const card = byId(view.cards, 'appeal_general');
  assert.equal(card.status, 'computed', 'срок ещё не истёк');

  const ics = buildICS(icsTermsFromView(view), { referenceDate: '2025-04-10', now: NOW });
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20250411'), 'событие должно остаться');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 0, 'все напоминания отсечены');
});

// --- Пригодность файла для календарей (iOS в том числе) ---------------------

test('файл соответствует обязательным требованиям RFC 5545', () => {
  const view = buildView(ALL_BRANCHES_INPUTS, { today: BEFORE_ALL_DEADLINES });
  const ics = buildICS(icsTermsFromView(view), { referenceDate: BEFORE_ALL_DEADLINES, now: NOW });

  // Одиночных LF быть не должно — только CRLF, и файл завершается переводом.
  assert.equal(/(?<!\r)\n/.test(ics), false, 'встретился LF без CR');
  assert.ok(ics.endsWith('\r\n'), 'файл должен заканчиваться CRLF');

  const lines = ics.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.ok(lines.includes('VERSION:2.0'));
  assert.ok(lines.some((l) => l.startsWith('PRODID:')));

  const events = (ics.match(/BEGIN:VEVENT/g) || []).length;
  const uids = ics.match(/^UID:.+$/gm) || [];
  assert.equal(uids.length, events, 'UID нужен каждому событию');
  assert.equal(new Set(uids).size, uids.length, 'UID должны быть уникальны');
  assert.equal((ics.match(/^DTSTAMP:/gm) || []).length, events, 'DTSTAMP нужен каждому событию');
});

test('свёртка строк не разрывает символ пополам', () => {
  // Кириллица занимает два октета: свёртка по октетам может рассечь символ, и
  // тогда файл перестанет быть валидным UTF-8 для разборщика календаря.
  const view = buildView(ALL_BRANCHES_INPUTS, { today: BEFORE_ALL_DEADLINES });
  const ics = buildICS(icsTermsFromView(view), { referenceDate: BEFORE_ALL_DEADLINES, now: NOW });

  // Развернём свёртку и сверим с исходными значениями: если бы символ рвался,
  // на его месте оказались бы замещающие символы.
  assert.equal(ics.includes('�'), false, 'появился замещающий символ');
  const unfolded = ics.replace(/\r\n /g, '');
  const titles = icsTermsFromView(view).map((t) => t.title);
  for (const title of titles) {
    assert.ok(unfolded.includes(`SUMMARY:${title}`), `после развёртки потерян SUMMARY: ${title}`);
  }
});

// --- Ограничение числа напоминаний и уникальность UID ------------------------

test('на событие не больше двух напоминаний', () => {
  // Календари обрезают список молча (iOS показывает два, Outlook одно), поэтому
  // правил не должно быть больше двух ни у одной длительности.
  const view = buildView(ALL_BRANCHES_INPUTS, { today: BEFORE_ALL_DEADLINES });
  const ics = buildICS(icsTermsFromView(view), { referenceDate: BEFORE_ALL_DEADLINES, now: NOW });

  const events = ics.split('BEGIN:VEVENT').slice(1);
  assert.ok(events.length >= 10, `в наборе ${events.length} событий — маловато для проверки`);
  for (const ev of events) {
    const alarms = (ev.match(/BEGIN:VALARM/g) || []).length;
    const summary = (ev.match(/SUMMARY:(.*)/) || ['', '?'])[1];
    assert.ok(alarms <= 2, `${summary}: ${alarms} напоминаний, допустимо не больше двух`);
  }
});

test('первое напоминание ближе к дедлайну, чем второе', () => {
  // Если календарь оставит только одно, останется то, которое важнее.
  const view = buildView(ALL_BRANCHES_INPUTS, { today: BEFORE_ALL_DEADLINES });
  const ics = buildICS(icsTermsFromView(view), { referenceDate: BEFORE_ALL_DEADLINES, now: NOW });

  let checked = 0;
  for (const ev of ics.split('BEGIN:VEVENT').slice(1)) {
    const triggers = [...ev.matchAll(/TRIGGER;VALUE=DATE-TIME:(\d{8})T/g)].map((m) => m[1]);
    if (triggers.length < 2) continue;
    const summary = (ev.match(/SUMMARY:(.*)/) || ['', '?'])[1];
    assert.ok(triggers[0] > triggers[1], `${summary}: порядок напоминаний ${triggers.join(' → ')}`);
    checked += 1;
  }
  assert.ok(checked >= 5, `проверено ${checked} событий с двумя напоминаниями — маловато`);
});

test('UID различаются у двух выгрузок с одинаковыми данными', () => {
  // Иначе расчёты по разным делам с совпадающими датами перезаписывают друг
  // друга в календаре: два файла с апелляцией на одну дату дают одно событие.
  const uidsOf = (ics) => (ics.match(/^UID:.+$/gm) || []);
  const first = uidsOf(buildICS([APPEAL], { referenceDate: '2025-05-01', now: NOW }));
  const second = uidsOf(buildICS([APPEAL], { referenceDate: '2025-05-01', now: NOW }));

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.notEqual(first[0], second[0], 'UID двух выгрузок совпали');
  // При этом внутри одной выгрузки UID остаются уникальными между событиями.
  const many = uidsOf(
    buildICS([APPEAL, { ...APPEAL, title: 'Другой срок' }], { referenceDate: '2025-05-01', now: NOW }),
  );
  assert.equal(new Set(many).size, many.length);
});

test('в названии события указано, что дата — последний день подачи', () => {
  const view = buildView(ALL_BRANCHES_INPUTS, { today: BEFORE_ALL_DEADLINES });
  const terms = icsTermsFromView(view);
  const ics = buildICS(terms, { referenceDate: BEFORE_ALL_DEADLINES, now: NOW });
  const unfolded = ics.replace(/\r\n /g, '');

  const summaries = [...unfolded.matchAll(/^SUMMARY:(.+)$/gm)].map((m) => m[1]);
  assert.equal(summaries.length, terms.length);
  for (const s of summaries) {
    assert.ok(s.endsWith(' — последний день подачи'), `без пояснения: ${s}`);
  }
  // Сам список сроков остаётся с чистыми названиями — пояснение только в
  // названии события календаря, где кроме него ничего не видно.
  for (const t of terms) assert.ok(!t.title.includes('последний день'));
});
