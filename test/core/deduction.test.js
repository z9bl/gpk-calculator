// Арифметика вычитания периода из срока (core/engine/deduction.js) — на
// синтетических типах событий и синтетическом сроке, без привязки к ФЗ
// № 229-ФЗ и к какому-либо узлу ГПК: предметная часть (основания ч. 3.1,
// подключение к узлам предъявления ИЛ) проверяется на стороне предметного
// модуля, см. test/chain.test.js и test/integration/.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deductionEvents,
  overlappingDeductions,
  totalDeductedDays,
  withDeductions,
} from '../../core/engine/deduction.js';

// Два синтетических основания: механизм не знает, что они значат.
const TYPES = new Set(['alpha', 'beta']);

// Синтетический посчитанный срок: три года от 12.04.2025 → 12.04.2028.
// 12.04.2028 — среда, переносить нечего, поэтому сырой дедлайн равен итоговому.
const TERM = { weekend_shift: true };
const RESULT = {
  anchor: '2025-04-12',
  offset_start: 1,
  raw_deadline: '2028-04-12',
  deadline: '2028-04-12',
  shifted: false,
};
const CONFIG = { norm: 'норма', logic: 'логика', assumption: { code: 'a', text: 'т' } };

const apply = (deductions, term = TERM, result = RESULT) =>
  withDeductions(result, term, deductionEvents(deductions, TYPES), CONFIG);

// --- Нормализация событий ---------------------------------------------------

test('без событий результат не меняется вовсе', () => {
  assert.equal(withDeductions(RESULT, TERM, [], CONFIG), RESULT);
  assert.deepEqual(deductionEvents(undefined, TYPES), []);
  assert.deepEqual(deductionEvents(null, TYPES), []);
  assert.deepEqual(deductionEvents([], TYPES), []);
});

test('null-результат (срока нет) вычет не создаёт', () => {
  assert.equal(withDeductions(null, TERM, deductionEvents([{ type: 'alpha', from: 'x' }], TYPES), CONFIG), null);
});

test('события сортируются по дате начала периода, а не по порядку ввода', () => {
  const events = deductionEvents(
    [
      { type: 'alpha', from: '2026-05-01', to: '2026-06-01' },
      { type: 'beta', from: '2025-05-01', to: '2025-06-01' },
    ],
    TYPES,
  );
  assert.deepEqual(
    events.map((e) => e.from),
    ['2025-05-01', '2026-05-01'],
  );
});

test('непригодные события не выбрасываются молча, а помечаются причиной', () => {
  const events = deductionEvents(
    [
      { type: 'alpha', from: '2025-05-01', to: null }, // нет второй даты
      { type: 'gamma', from: '2025-05-01', to: '2025-06-01' }, // не наше основание
      { type: 'beta', from: '2025-06-01', to: '2025-05-01' }, // конец раньше начала
    ],
    TYPES,
  );
  assert.deepEqual(
    events.map((e) => e.ignored_reason).sort(),
    ['negative_period', 'no_date', 'unknown_type'],
  );
  assert.ok(events.every((e) => e.ignored === true));
  assert.equal(totalDeductedDays(events), 0);
});

test('непригодные события на срок не влияют, но остаются в истории', () => {
  const deducted = apply([{ type: 'gamma', from: '2025-05-01', to: '2025-06-01' }]);
  assert.equal(deducted.deadline, RESULT.deadline);
  assert.equal(deducted.deducted_days, 0);
  assert.equal(deducted.deductions.length, 1);
  assert.equal(deducted.deductions[0].ignored_reason, 'unknown_type');
});

// --- Длина периода ----------------------------------------------------------

test('длина периода — разность дат: день начала входит, день окончания нет', () => {
  const [event] = deductionEvents([{ type: 'alpha', from: '2025-05-01', to: '2025-05-11' }], TYPES);
  assert.equal(event.days, 10);
});

test('период нулевой длины допустим и срок не уменьшает', () => {
  const deducted = apply([{ type: 'alpha', from: '2025-05-01', to: '2025-05-01' }]);
  assert.equal(deducted.deductions[0].ignored, undefined);
  assert.equal(deducted.deductions[0].days, 0);
  assert.equal(deducted.deducted_days, 0);
  assert.equal(deducted.deadline, '2028-04-12'); // дедлайн тот же
  // Но история на карточке есть: пользователь ввёл период и должен его видеть.
  assert.equal(deducted.deductions.length, 1);
});

test('период длиной в один день уменьшает срок ровно на день', () => {
  const deducted = apply([{ type: 'alpha', from: '2025-05-01', to: '2025-05-02' }]);
  assert.equal(deducted.deducted_days, 1);
  assert.equal(deducted.raw_deadline, '2028-04-11');
});

// --- Один период ------------------------------------------------------------

test('один период: дедлайн уезжает назад на его длину, точка отсчёта не меняется', () => {
  const deducted = apply([{ type: 'alpha', from: '2025-05-01', to: '2025-09-01' }]); // 123 дня
  assert.equal(deducted.deducted_days, 123);
  assert.equal(deducted.raw_deadline, '2027-12-11');
  assert.equal(deducted.deadline, '2027-12-13'); // 11.12.2027 — суббота
  assert.equal(deducted.shifted, true);
  // Якорь и начало течения — прежние: ч. 3.1 меняет длину срока, а не отсчёт.
  assert.equal(deducted.anchor, RESULT.anchor);
  assert.equal(deducted.offset_start, RESULT.offset_start);
  // Что было до вычета — сохранено для карточки.
  assert.equal(deducted.deadline_before_deduction, '2028-04-12');
  assert.equal(deducted.raw_deadline_before_deduction, '2028-04-12');
  assert.equal(deducted.deduction_exhausts_term, undefined);
});

test('перенос последнего дня считается заново от даты после вычета', () => {
  // Исходный дедлайн 12.04.2028 переноса не требовал. После вычета 10 дней
  // последний день — 02.04.2028, воскресенье: перенос нужен, и это именно
  // свойство НОВОГО последнего дня, а не унаследованный флаг.
  const deducted = apply([{ type: 'alpha', from: '2025-05-01', to: '2025-05-11' }]);
  assert.equal(deducted.raw_deadline, '2028-04-02');
  assert.equal(deducted.deadline, '2028-04-03');
  assert.equal(deducted.shifted, true);
});

test('weekend_shift: false — перенос не применяется и после вычета', () => {
  const deducted = apply([{ type: 'alpha', from: '2025-05-01', to: '2025-05-11' }], {
    weekend_shift: false,
  });
  assert.equal(deducted.raw_deadline, '2028-04-02');
  assert.equal(deducted.deadline, '2028-04-02'); // воскресенье, но переноса нет
  assert.equal(deducted.shifted, false);
});

// --- Несколько периодов -----------------------------------------------------

test('несколько периодов складываются все', () => {
  const deducted = apply([
    { type: 'alpha', from: '2025-05-01', to: '2025-05-11' }, // 10
    { type: 'beta', from: '2026-01-01', to: '2026-01-21' }, // 20
    { type: 'alpha', from: '2026-06-01', to: '2026-06-06' }, // 5
  ]);
  assert.equal(deducted.deducted_days, 35);
  assert.equal(deducted.raw_deadline, '2028-03-08');
});

test('несколько периодов: непригодный в сумму не попадает', () => {
  const deducted = apply([
    { type: 'alpha', from: '2025-05-01', to: '2025-05-11' }, // 10
    { type: 'beta', from: '2026-01-21', to: '2026-01-01' }, // конец раньше начала
  ]);
  assert.equal(deducted.deducted_days, 10);
  assert.equal(deducted.deductions.filter((e) => e.ignored).length, 1);
});

test('пересекающиеся периоды складываются как есть, не схлопываясь (ASSUMPTION)', () => {
  // Норма говорит об одном периоде; правила для пересечения нет. Принято:
  // складывать все. Тест фиксирует именно это поведение, чтобы смена решения
  // по итогам юридической проверки была видна как падение теста, а не как
  // молчаливое изменение чисел.
  const deducted = apply([
    { type: 'alpha', from: '2025-05-01', to: '2025-05-11' }, // 10
    { type: 'beta', from: '2025-05-01', to: '2025-05-11' }, // те же 10 дней
  ]);
  assert.equal(deducted.deducted_days, 20);
});

// --- Граничный случай: вычет больше срока ------------------------------------

test('вычет ровно во весь срок упирается в день начала течения', () => {
  // Срок течёт с 13.04.2025 (anchor + offset_start) по 12.04.2028 — это
  // 1095 дней. Вычет ровно на 1095 дней опускает дедлайн ровно до начала
  // течения: пол достигнут, но не пробит.
  const deducted = apply([{ type: 'alpha', from: '2025-01-01', to: '2028-01-01' }]);
  assert.equal(deducted.deducted_days, 1095);
  assert.equal(deducted.raw_deadline, '2025-04-13');
  assert.equal(deducted.deduction_exhausts_term, true);
});

test('вычет больше срока: дедлайн не опускается ниже дня начала течения', () => {
  const deducted = apply([{ type: 'alpha', from: '2020-01-01', to: '2028-01-01' }]); // 2922 дня
  assert.equal(deducted.deducted_days, 2922);
  // Пол — день, в который срок начал течь: отрицательный срок и дата раньше
  // начала течения смысла не имеют.
  assert.equal(deducted.raw_deadline, '2025-04-13');
  assert.equal(deducted.deduction_exhausts_term, true);
  // Перенос последнего дня применяется и к «полу»: 13.04.2025 — воскресенье.
  assert.equal(deducted.deadline, '2025-04-14');
});

test('вычет на день меньше срока границы ещё не достигает', () => {
  const deducted = apply([{ type: 'alpha', from: '2025-01-01', to: '2027-12-31' }]); // 1094
  assert.equal(deducted.deducted_days, 1094);
  assert.equal(deducted.raw_deadline, '2025-04-14');
  assert.equal(deducted.deduction_exhausts_term, undefined);
});

test('сумма нескольких периодов тоже упирается в пол', () => {
  const deducted = apply([
    { type: 'alpha', from: '2025-01-01', to: '2027-01-01' }, // 730
    { type: 'beta', from: '2025-01-01', to: '2027-01-01' }, // 730 → 1460 > 1095
  ]);
  assert.equal(deducted.deducted_days, 1460);
  assert.equal(deducted.raw_deadline, '2025-04-13');
  assert.equal(deducted.deduction_exhausts_term, true);
});

// --- Пересечение отрезков (проверка ввода, не правило расчёта) ---------------

const events = (list) => deductionEvents(list, TYPES);

test('непересекающиеся отрезки пар не дают', () => {
  assert.deepEqual(
    overlappingDeductions(
      events([
        { type: 'alpha', from: '2025-01-01', to: '2025-03-01' },
        { type: 'beta', from: '2025-06-01', to: '2025-09-01' },
      ]),
    ),
    [],
  );
  assert.deepEqual(overlappingDeductions(events([])), []);
  assert.deepEqual(
    overlappingDeductions(events([{ type: 'alpha', from: '2025-01-01', to: '2025-03-01' }])),
    [],
  );
});

test('смыкание встык пересечением не считается', () => {
  // По ст. 191 ГК РФ день начала в длину отрезка не входит, поэтому общий день
  // принадлежит только одному из двух отрезков — перекрытия нет.
  assert.deepEqual(
    overlappingDeductions(
      events([
        { type: 'alpha', from: '2025-01-01', to: '2025-06-01' },
        { type: 'beta', from: '2025-06-01', to: '2025-09-01' },
      ]),
    ),
    [],
  );
});

test('частичное перекрытие и вложение отрезков обнаруживаются', () => {
  const partial = overlappingDeductions(
    events([
      { type: 'alpha', from: '2025-01-01', to: '2025-06-01' },
      { type: 'beta', from: '2025-03-01', to: '2025-09-01' },
    ]),
  );
  assert.equal(partial.length, 1);
  assert.equal(partial[0].a.from, '2025-01-01');
  assert.equal(partial[0].b.from, '2025-03-01');

  const nested = overlappingDeductions(
    events([
      { type: 'alpha', from: '2025-01-01', to: '2025-12-01' },
      { type: 'beta', from: '2025-03-01', to: '2025-04-01' },
    ]),
  );
  assert.equal(nested.length, 1);
});

test('три взаимно пересекающихся отрезка дают три пары', () => {
  const pairs = overlappingDeductions(
    events([
      { type: 'alpha', from: '2025-01-01', to: '2025-12-01' },
      { type: 'beta', from: '2025-02-01', to: '2025-11-01' },
      { type: 'alpha', from: '2025-03-01', to: '2025-10-01' },
    ]),
  );
  assert.equal(pairs.length, 3);
});

test('непригодные отрезки на пересечение не проверяются', () => {
  // Они и в сумму не идут — предупреждать о них как о пересечении значило бы
  // требовать исправить то, что на расчёт уже не влияет.
  assert.deepEqual(
    overlappingDeductions(
      events([
        { type: 'alpha', from: '2025-01-01', to: '2025-06-01' },
        { type: 'gamma', from: '2025-03-01', to: '2025-09-01' }, // не наше основание
      ]),
    ),
    [],
  );
});

test('обнаружение пересечения на арифметику не влияет', () => {
  // Ключевое разделение: проверка ввода отдельно, формула сложения отдельно.
  // Пересекающиеся отрезки складываются целиком, как и любые другие.
  const overlapping = events([
    { type: 'alpha', from: '2025-01-01', to: '2025-01-11' }, // 10
    { type: 'beta', from: '2025-01-06', to: '2025-01-16' }, // 10, из них 5 общих
  ]);
  assert.equal(overlappingDeductions(overlapping).length, 1);
  assert.equal(totalDeductedDays(overlapping), 20); // не 15 — общие дни не схлопываются
  const deducted = withDeductions(RESULT, TERM, overlapping, CONFIG);
  assert.equal(deducted.deducted_days, 20);
  // withDeductions о пересечении ничего не знает и полей о нём не добавляет.
  assert.equal(deducted.deduction_overlap_warning, undefined);
});

// --- Тексты, которыми помечается результат ----------------------------------

test('норма, логика и допущения берутся из config, а не зашиты в механизм', () => {
  const deducted = apply([{ type: 'alpha', from: '2025-05-01', to: '2025-05-11' }]);
  assert.equal(deducted.deduction_norm, 'норма');
  assert.equal(deducted.deduction_logic, 'логика');
  assert.deepEqual(deducted.deduction_assumption, { code: 'a', text: 'т' });
});
