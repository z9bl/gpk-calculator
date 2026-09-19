// Вычет периода из срока предъявления (ч. 3.1 ст. 22 ФЗ № 229-ФЗ) — полный
// поток от входных данных до карточки: inputs → computeChain → buildView.
//
// Тест намеренно интеграционный (см. CLAUDE.md о границах test/): проверяется
// не арифметика ядра (она покрыта test/core/deduction.test.js на синтетических
// данных), а согласованность трёх слоёв — что основание из DEDUCTION_TYPES
// доезжает от поля ввода до подписи на карточке и что событие ч. 3.1 не
// попадает в ветвь перерыва и наоборот.
//
// ЧТО ИЗМЕНИЛОСЬ. Раньше узлов предъявления было шесть (пять копий на хвостах
// цепочек обжалования плюс приказное производство), и отдельный тест проверял,
// что вычет доезжает до каждого. Узел остался один — в ситуации
// «Исполнительное производство», на три типа исполнительного документа;
// проверки ниже идут через него, а тест на «шесть узлов» переформулирован в
// тест на типы документа (см. блок «Подключение к типам документа»). Сами
// числа не изменились: якорем служит та же дата вступления решения в силу,
// которую прежде вычисляла цепочка, — теперь она вводится напрямую.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildView,
  DEDUCTION_TYPE_LABELS,
  DEDUCTION_IGNORED_TEXT,
} from '../../src/views.js';
import {
  computeChain,
  computeIndependentTerms,
  computeSimplified,
  computeMirovoy,
  computeDefaultJudgment,
  computeDefaultJudgmentForeignState,
  DEDUCTION_TYPES,
  partitionEnforcementEvents,
} from '../../src/chain.js';

// Те же базовые ориентиры, что и раньше: вступление решения в силу
// 15.04.2025, предъявление без событий — 17.04.2028 (15.04.2028 — суббота).
const BASE = { resolution_date: '2025-03-11', reasoned_decision_date: '2025-03-12' };
const TODAY = { today: '2025-05-01' };
const ENF_BASE_ANCHOR = '2025-04-15';
const ENF_BASE_DEADLINE = '2028-04-17';
const NODE = 'enforcement_document_presentation';

// Карточка единственного узла предъявления: вариант «решение суда»
// (ч. 1 ст. 21) с той же датой-якорем, что прежде вычисляла общая цепочка.
const card = (inputs) =>
  buildView(
    {
      ...BASE,
      enforcement_document_type: 'court_decision',
      enforcement_decision_entry_into_force_date: ENF_BASE_ANCHOR,
      ...inputs,
    },
    TODAY,
  ).cards.find((c) => c.id === NODE);

// Период 01.05.2025 — 01.09.2025 = 123 дня.
const PERIOD = { type: 'creditor_request', from: '2025-05-01', to: '2025-09-01' };

test('базовые ориентиры ветви (страховка от молчаливого сдвига остальных тестов)', () => {
  const plain = card({});
  assert.equal(plain.deadline, ENF_BASE_DEADLINE);
  assert.equal(plain.deductions, undefined);
  assert.equal(plain.deducted_days, undefined);
  assert.equal(plain.deduction_assumption, undefined);
  assert.equal(plain.details.deduction_norm, undefined);
});

test('одно событие ч. 3.1 доезжает до карточки с подписью основания и длиной периода', () => {
  const c = card({ enforcement_interruptions: [PERIOD] });
  assert.equal(c.deducted_days, 123);
  assert.equal(c.deadline_before_deduction, ENF_BASE_DEADLINE);
  assert.equal(c.deadline, '2027-12-14');
  assert.equal(c.deductions.length, 1);
  assert.equal(c.deductions[0].label, DEDUCTION_TYPE_LABELS.creditor_request);
  assert.equal(c.deductions[0].days, 123);
  assert.equal(c.deductions[0].from, '2025-05-01');
  assert.equal(c.deductions[0].to, '2025-09-01');
  // Норма и логика ч. 3.1 — в раскрывающихся деталях, допущения — рядом с датой.
  assert.match(c.details.deduction_norm, /ч\. 3\.1 ст\. 22/);
  assert.match(c.details.deduction_logic, /вычитается/);
  assert.equal(c.deduction_assumption.code, 'deduction_assumptions');
  assert.match(c.deduction_assumption.norm, /ч\. 3\.1/);
});

test('оба основания ч. 3.1 считаются по одной формуле', () => {
  const request = card({ enforcement_interruptions: [PERIOD] });
  const obstruction = card({
    enforcement_interruptions: [{ ...PERIOD, type: 'creditor_obstruction' }],
  });
  assert.equal(obstruction.deadline, request.deadline);
  assert.equal(obstruction.deducted_days, request.deducted_days);
  // Различаются только подписью — пользователь должен видеть, что он выбрал.
  assert.notEqual(obstruction.deductions[0].label, request.deductions[0].label);
  assert.equal(obstruction.deductions[0].label, DEDUCTION_TYPE_LABELS.creditor_obstruction);
});

test('несколько периодов суммируются (ASSUMPTION), история отсортирована', () => {
  const c = card({
    enforcement_interruptions: [
      { type: 'creditor_obstruction', from: '2026-01-01', to: '2026-01-21' }, // 20
      PERIOD, // 123
    ],
  });
  assert.equal(c.deducted_days, 143);
  assert.deepEqual(
    c.deductions.map((e) => e.from),
    ['2025-05-01', '2026-01-01'],
  );
});

test('непригодный период виден на карточке с причиной и на срок не влияет', () => {
  const c = card({
    enforcement_interruptions: [{ type: 'creditor_request', from: '2025-09-01', to: '2025-05-01' }],
  });
  assert.equal(c.deducted_days, 0);
  assert.equal(c.deadline, ENF_BASE_DEADLINE);
  assert.equal(c.deductions[0].ignored, true);
  assert.equal(c.deductions[0].ignored_text, DEDUCTION_IGNORED_TEXT.negative_period);
});

test('период больше срока: дедлайн упирается в начало течения и помечен флагом', () => {
  const c = card({
    enforcement_interruptions: [{ type: 'creditor_request', from: '2015-01-01', to: '2025-01-01' }],
  });
  assert.equal(c.deduction_exhausts_term, true);
  // Дальше начала течения срока дедлайн не опускается.
  assert.ok(c.deadline >= ENF_BASE_ANCHOR);
  assert.ok(c.deadline < ENF_BASE_DEADLINE);
});

// --- Разделение двух ветвей ст. 22 ------------------------------------------

test('событие ч. 3.1 не попадает в ветвь перерыва, событие ч. 1–3 — в ветвь вычета', () => {
  const { interruptions, deductions } = partitionEnforcementEvents([
    PERIOD,
    { type: 'presentment', date: '2026-06-01' },
    { type: 'creditor_obstruction', from: '2026-01-01', to: '2026-01-21' },
  ]);
  assert.deepEqual(
    interruptions.map((e) => e.type),
    ['presentment'],
  );
  assert.deepEqual(
    deductions.map((e) => e.type),
    ['creditor_request', 'creditor_obstruction'],
  );
});

test('событие ч. 3.1 в одиночку не создаёт истории перерывов и не двигает якорь', () => {
  const c = card({ enforcement_interruptions: [PERIOD] });
  assert.equal(c.interruptions, undefined);
  assert.equal(c.restarted_from, undefined);
  // Точка отсчёта прежняя: ч. 3.1 меняет длину срока, а не отсчёт.
  assert.equal(c.base_anchor, undefined);
});

test('нераспознанное основание по-прежнему видно в истории перерывов', () => {
  // Разделение не должно ронять «чужие» события в никуда: они уходят в ветвь
  // перерыва и помечаются там как непонятое основание.
  const c = card({ enforcement_interruptions: [{ type: 'nonsense', date: '2026-06-01' }] });
  assert.equal(c.interruptions.length, 1);
  assert.equal(c.interruptions[0].ignored_reason, 'unknown_type');
  assert.equal(c.deductions, undefined);
});

test('перерыв и вычет вместе: рестарт даёт полный срок, из него вычитается сумма (ASSUMPTION)', () => {
  const c = card({
    enforcement_interruptions: [PERIOD, { type: 'presentment', date: '2026-06-01' }],
  });
  // Перерыв: три года от 01.06.2026 → 01.06.2029, без оглядки на вычет.
  assert.equal(c.restarted_from, '2026-06-01');
  assert.equal(c.deadline_before_deduction, '2029-06-01');
  // Затем из полученного срока вычитаются 123 дня — хотя период лежит ДО
  // перерыва. Это принятое допущение, а не вывод из текста нормы.
  assert.equal(c.deducted_days, 123);
  assert.equal(c.deadline, '2029-01-29');
  // Обе истории на карточке — они читаются по-разному и не заменяют друг друга.
  assert.equal(c.interruptions.length, 1);
  assert.equal(c.deductions.length, 1);
});

// --- Подключение к типам документа ------------------------------------------
//
// Прежде этот блок назывался «Подключение ко всем узлам предъявления» и
// перебирал шесть узлов: пять копий на хвостах цепочек (общая, упрощённое,
// мировой судья, заочное, заочное против иностранного государства) и судебный
// приказ. Узлов больше нет — остался один, и перебирать надо не узлы, а типы
// исполнительного документа, от которых зависят якорь и норма. Числа взяты из
// прежнего теста: 02.06.2025 — дата вступления в силу, которую в нём давали
// ветви, 12.04.2023 — дата выдачи судебного приказа.

test('вычет работает у обоих типов документа, к которым сведена ст. 22', () => {
  const events = [PERIOD];

  // Вступившее в силу решение (ч. 1 ст. 21) — прежде пять отдельных узлов,
  // различавшихся только тем, какая ветвь дала дату вступления в силу.
  const decision = computeIndependentTerms({
    enforcement_document_type: 'court_decision',
    enforcement_decision_entry_into_force_date: '2025-06-02',
    enforcement_interruptions: events,
  }).enforcement_document_presentation;
  assert.equal(decision.deducted_days, 123);
  assert.equal(decision.deadline_before_deduction, '2028-06-02');
  assert.equal(decision.deadline, '2028-01-31');

  // Судебный приказ (ч. 3 ст. 21) — прежде узел приказного производства.
  const order = computeIndependentTerms({
    enforcement_document_type: 'court_order',
    court_order_issued_date: '2023-04-12',
    enforcement_interruptions: events,
  }).enforcement_document_presentation;
  assert.equal(order.deducted_days, 123);
  assert.equal(order.deadline_before_deduction, '2026-04-13');
  assert.equal(order.deadline, '2025-12-10');
});

test('ни одна цепочка обжалования узла предъявления больше не отдаёт', () => {
  // Охранная проверка к переформулировке выше: вычет некуда доезжать в хвостах
  // цепочек, потому что хвостов нет. Если узел когда-нибудь вернётся в ветвь,
  // в модели снова окажется два расчёта одной нормы — ломается этот тест.
  const events = { enforcement_interruptions: [PERIOD] };
  assert.equal(computeChain({ ...BASE, ...events }, TODAY).enforcement, undefined);
  assert.equal(
    computeSimplified({ simplified_resolution_date: '2025-03-11', ...events }, '2025-07-01')
      .enforcement,
    undefined,
  );
  assert.equal(
    computeMirovoy({ mirovoy_resolution_date: '2025-03-11', ...events }, '2025-07-01').enforcement,
    undefined,
  );
  assert.equal(
    computeDefaultJudgment({ default_judgment_service_date: '2025-03-11', ...events }, '2025-07-01')
      .enforcement,
    undefined,
  );
  assert.equal(
    computeDefaultJudgmentForeignState(
      { foreign_state_default_judgment_service_date: '2025-01-10', ...events },
      '2025-07-01',
    ).enforcement,
    undefined,
  );
  assert.equal(
    computeIndependentTerms({ court_order_issued_date: '2023-04-12', ...events })
      .court_order_presentation,
    undefined,
  );
});

test('периодические платежи вычетом не затрагиваются (ст. 22 к ним не сведена)', () => {
  // Отдельного узла периодических платежей больше нет — это вариант документа
  // 'periodic_payments' узла enforcement_document_presentation, у которого
  // interruptible: false. Неприменимость ст. 22 сохранена при переносе, поэтому
  // проверка та же, только вход другой.
  const PERIODIC = { enforcement_document_type: 'periodic_payments' };
  const plain = computeIndependentTerms({
    ...PERIODIC,
    periodic_payment_period_end_date: '2023-04-12',
  }).enforcement_document_presentation;
  const withEvents = computeIndependentTerms({
    ...PERIODIC,
    periodic_payment_period_end_date: '2023-04-12',
    enforcement_interruptions: [PERIOD],
  }).enforcement_document_presentation;
  assert.deepEqual(withEvents, plain);
  assert.equal(withEvents.deductions, undefined);

  // Контроль: тот же узел с другим типом документа вычет получает — значит
  // причина не в том, что узел вообще разучился считать ч. 3.1.
  const order = computeIndependentTerms({
    enforcement_document_type: 'court_order',
    court_order_issued_date: '2023-04-12',
    enforcement_interruptions: [PERIOD],
  }).enforcement_document_presentation;
  assert.equal(order.deductions.length, 1);
});

// --- Проверка ввода: пересечение периодов -----------------------------------

test('пересекающиеся периоды дают предупреждение на карточке', () => {
  const c = card({
    enforcement_interruptions: [
      PERIOD, // 01.05.2025 — 01.09.2025
      { type: 'creditor_obstruction', from: '2025-07-01', to: '2025-11-01' },
    ],
  });
  assert.equal(c.deduction_overlap_warning.code, 'deduction_overlap');
  assert.match(c.deduction_overlap_warning.norm, /ч\. 3\.1 ст\. 22/);
  // Пары названы явно — иначе пользователю искать их среди всех периодов самому.
  assert.deepEqual(c.deduction_overlap_warning.pairs, [
    { a: { from: '2025-05-01', to: '2025-09-01' }, b: { from: '2025-07-01', to: '2025-11-01' } },
  ]);
});

test('предупреждение о пересечении расчёт не меняет', () => {
  // Валидация предотвращает неверный ввод, но арифметику под него не
  // подстраивает: 123 + 123 = 246 дней, общие дни вычитаются дважды.
  const c = card({
    enforcement_interruptions: [
      PERIOD,
      { type: 'creditor_obstruction', from: '2025-07-01', to: '2025-11-01' },
    ],
  });
  assert.equal(c.deducted_days, 246);
  assert.equal(c.deadline_before_deduction, ENF_BASE_DEADLINE);
  assert.equal(c.deadline, '2027-08-13');
});

test('непересекающиеся периоды предупреждения не дают', () => {
  const c = card({
    enforcement_interruptions: [
      PERIOD, // 01.05.2025 — 01.09.2025
      { type: 'creditor_obstruction', from: '2026-01-01', to: '2026-01-21' },
    ],
  });
  assert.equal(c.deduction_overlap_warning, undefined);
  assert.equal(c.deducted_days, 143);
});

test('одиночный период предупреждения не даёт', () => {
  assert.equal(card({ enforcement_interruptions: [PERIOD] }).deduction_overlap_warning, undefined);
});

// --- Согласованность списков оснований и подписей ---------------------------

test('у каждого основания ч. 3.1 есть подпись, и лишних подписей нет', () => {
  // Та же проверка, что защищает INTERRUPTION_TYPE_LABELS: id живут в chain.js,
  // подписи — в views.js, и разъехаться они не должны.
  const ids = DEDUCTION_TYPES.map((t) => t.id).sort();
  assert.deepEqual(Object.keys(DEDUCTION_TYPE_LABELS).sort(), ids);
  for (const type of DEDUCTION_TYPES) {
    assert.match(type.norm, /ч\. 3\.1 ст\. 22/);
    assert.ok(DEDUCTION_TYPE_LABELS[type.id].length > 0);
  }
});
