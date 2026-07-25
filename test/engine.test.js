// Тест движка сроков (раздел 8, задача 2 SPEC.md).

import test from 'node:test';
import assert from 'node:assert/strict';

import { addMonths, computeDeadline } from '../src/engine.js';
import { toISODate } from '../src/calendar.js';

// Срок как в модели п. 4.2: 1 месяц, течение со следующего дня (ч. 3 ст. 107),
// перенос выходного (ч. 2 ст. 108).
function monthTerm(value, offsetStart = 1, weekendShift = true) {
  return {
    duration: { value, unit: 'month' },
    anchor: { offset_start: offsetStart },
    weekend_shift: weekendShift,
  };
}

test('1. Пример п. 12 ПП ВС № 17: 02.06.2021 + 3 месяца → 02.09.2021', () => {
  const r = computeDeadline(monthTerm(3), '2021-06-02');
  // offset_start (ч. 3 ст. 107) + расчёт месяца дают 02.09, а НЕ 03.09.
  assert.equal(r.raw_deadline, '2021-09-02');
  assert.equal(r.deadline, '2021-09-02'); // 02.09.2021 — четверг, рабочий
  assert.notEqual(r.deadline, '2021-09-03');
  assert.equal(r.shifted, false);
});

test('offset_start действительно участвует в расчёте', () => {
  // При offset_start = 2 начало течения сдвигается на день → 03.09.2021.
  const r = computeDeadline(monthTerm(3, 2), '2021-06-02');
  assert.equal(r.raw_deadline, '2021-09-03');
});

test('2. 31.01 + 1 месяц → последний день февраля (28 или 29 в високосный)', () => {
  // ч. 1 ст. 108: нет соответствующего числа → последний день месяца.
  assert.equal(toISODate(addMonths('2023-01-31', 1)), '2023-02-28'); // невисокосный
  assert.equal(toISODate(addMonths('2024-01-31', 1)), '2024-02-29'); // високосный
});

test('3. 31.12.2025 + 1 месяц → 31.01.2026 (переход через год)', () => {
  assert.equal(toISODate(addMonths('2025-12-31', 1)), '2026-01-31');
});

test('4. Последний день выпадает на выходной и сдвигается (ч. 2 ст. 108)', () => {
  // 11.06.2021 + 1 месяц = 11.07.2021 (воскресенье) → 12.07.2021 (понедельник).
  const r = computeDeadline(monthTerm(1), '2021-06-11');
  assert.equal(r.raw_deadline, '2021-07-11');
  assert.equal(r.deadline, '2021-07-12');
  assert.equal(r.shifted, true);
});

test('5. Сдвиг пересекает границу года', () => {
  // 31.08.2025 + 4 месяца = 31.12.2025 (нерабочий, перенос 05.01→31.12).
  // Далее янв. 2026: 01–08 праздники, 09 — перенос, 10–11 выходные →
  // первый рабочий день 12.01.2026.
  const r = computeDeadline(monthTerm(4), '2025-08-31');
  assert.equal(r.raw_deadline, '2025-12-31');
  assert.equal(r.deadline, '2026-01-12');
  assert.equal(r.shifted, true);
  assert.equal(r.deadline.slice(0, 4), '2026');
});

test('weekend_shift: false отключает перенос', () => {
  const r = computeDeadline(
    { duration: { value: 1, unit: 'month' }, anchor: { offset_start: 1 }, weekend_shift: false },
    '2021-06-11',
  );
  assert.equal(r.deadline, '2021-07-11'); // остаётся на воскресенье
  assert.equal(r.shifted, false);
});

test('единица в днях в MVP не считается (принцип заглушек)', () => {
  assert.throws(
    () => computeDeadline({ duration: { value: 15, unit: 'day' } }, '2021-06-02'),
    /вторая версия/,
  );
});

// --- Единица year (ч. 1 ст. 108: соответствующие месяц и число последнего года) ---

function yearTerm(value, weekendShift = true) {
  return {
    duration: { value, unit: 'year' },
    anchor: { offset_start: 1 },
    weekend_shift: weekendShift,
  };
}

test('unit year: 15.03.2024 + 3 года = 15.03.2027', () => {
  const r = computeDeadline(yearTerm(3), '2024-03-15');
  assert.equal(r.raw_deadline, '2027-03-15');
  assert.equal(r.deadline, '2027-03-15'); // 15.03.2027 — рабочий день
});

test('unit year: 29.02.2024 + 3 года → 28.02.2027 (нет такого числа)', () => {
  const r = computeDeadline(yearTerm(3), '2024-02-29');
  assert.equal(r.raw_deadline, '2027-02-28'); // клампинг к последнему дню февраля
});

test('unit year: последний день на нерабочий → перенос вперёд (ч. 2 ст. 108)', () => {
  // 12.06.2021 + 3 года = 12.06.2024 (День России, нерабочий) → 13.06.2024.
  const r = computeDeadline(yearTerm(3), '2021-06-12');
  assert.equal(r.raw_deadline, '2024-06-12');
  assert.equal(r.deadline, '2024-06-13');
  assert.equal(r.shifted, true);
});
