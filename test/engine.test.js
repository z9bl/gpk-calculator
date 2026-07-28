// Тест движка сроков (раздел 8, задача 2 SPEC.md).

import test from 'node:test';
import assert from 'node:assert/strict';

import { addDays, addMonths, computeDeadline } from '../src/engine.js';
import { toISODate, isWorkingDay, shiftIfNonWorking } from '../src/calendar.js';

// Срок как в модели п. 4.2: 1 месяц, течение со следующего дня (ч. 3 ст. 107),
// перенос выходного (ч. 2 ст. 108).
function monthTerm(value, offsetStart = 1, weekendShift = true) {
  return {
    duration: { value, unit: 'month' },
    anchor: { offset_start: offsetStart },
    weekend_shift: weekendShift,
  };
}

test('1. Пример п. 12 ПП ВС РФ от 22.06.2021 № 17: 02.06.2021 + 3 месяца → 02.09.2021', () => {
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

test('неизвестная единица срока — явная ошибка', () => {
  assert.throws(
    () => computeDeadline({ duration: { value: 2, unit: 'week' } }, '2021-06-02'),
    /Неизвестная единица/,
  );
});

// --- unit: working_day (абз. 2 ч. 3 ст. 107 ГПК) -----------------------------

function wdTerm(value, weekendShift) {
  const term = { duration: { value, unit: 'working_day' }, anchor: { offset_start: 1 } };
  if (weekendShift !== undefined) term.weekend_shift = weekendShift;
  return term;
}

// Независимый от реализации счётчик: N-й рабочий день, начиная со дня после
// события. Используется как перекрёстная проверка результата движка.
function nthWorkingDayAfter(anchorISO, n) {
  let cursor = new Date(anchorISO + 'T00:00:00Z');
  let counted = 0;
  while (counted < n) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    if (isWorkingDay(toISODate(cursor))) counted += 1;
  }
  return toISODate(cursor);
}

test('1. 5 рабочих дней от 28.12.2025 — срок уезжает за январские каникулы', () => {
  const r = computeDeadline(wdTerm(5), '2025-12-28');
  // 28.12 — воскресенье, течение начинается с 29.12 (первый рабочий).
  assert.equal(r.first_working_day, '2025-12-29');
  // Рабочие: 29.12, 30.12 → каникулы 31.12–11.01 → 12.01, 13.01, 14.01.
  assert.equal(r.deadline, '2026-01-14');
  assert.ok(r.deadline > '2026-01-11', 'срок должен уехать за январские праздники');
  assert.equal(r.deadline, nthWorkingDayAfter('2025-12-28', 5)); // перекрёстная проверка
});

test('2. 15 рабочих дней от конца декабря vs 15 календарных — разница больше недели', () => {
  const working = computeDeadline(wdTerm(15), '2025-12-26');
  assert.equal(working.deadline, '2026-01-28');
  assert.equal(working.deadline, nthWorkingDayAfter('2025-12-26', 15));

  // 15 календарных дней от той же даты (с переносом последнего дня по ч. 2 ст. 108).
  const calendarRaw = toISODate(addDays('2025-12-26', 15)); // 10.01.2026
  const calendarShifted = shiftIfNonWorking(calendarRaw); // 12.01.2026
  assert.equal(calendarShifted, '2026-01-12');

  const diffDays = Math.round(
    (Date.parse(working.deadline) - Date.parse(calendarShifted)) / 86_400_000,
  );
  assert.equal(diffDays, 16);
  assert.ok(diffDays > 7, 'на новогодних каникулах разница превышает неделю');
});

test('3. событие в пятницу — отсчёт начинается с понедельника', () => {
  // 13.02.2026 — пятница; 14–15.02 выходные.
  const r = computeDeadline(wdTerm(5), '2026-02-13');
  assert.equal(r.first_working_day, '2026-02-16'); // понедельник
  assert.equal(r.deadline, '2026-02-20');
  assert.equal(r.deadline, nthWorkingDayAfter('2026-02-13', 5));
});

test('4. событие накануне праздника — первый день отсчёта после него', () => {
  // 11.06.2026 — четверг; 12.06 (пт) — День России, 13–14 — выходные.
  const r = computeDeadline(wdTerm(5), '2026-06-11');
  assert.equal(r.first_working_day, '2026-06-15'); // понедельник после праздника
  assert.ok(!isWorkingDay('2026-06-12'));
  assert.equal(r.deadline, '2026-06-19');
  assert.equal(r.deadline, nthWorkingDayAfter('2026-06-11', 5));
});

test('5. к сроку в рабочих днях НЕ применяется перенос по ч. 2 ст. 108', () => {
  const r = computeDeadline(wdTerm(5), '2025-12-28');
  // Последний день рабочий по построению — переносить нечего.
  assert.equal(r.shifted, false);
  assert.equal(r.raw_deadline, r.deadline);
  assert.ok(isWorkingDay(r.deadline));
  // Повторный перенос ничего бы не изменил — то есть лишних суток нет.
  assert.equal(shiftIfNonWorking(r.deadline), r.deadline);
  // Явный флаг weekend_shift на таком сроке не меняет результат: движок его
  // игнорирует, двойного применения нет.
  assert.equal(computeDeadline(wdTerm(5, true), '2025-12-28').deadline, r.deadline);
  assert.equal(computeDeadline(wdTerm(5, false), '2025-12-28').deadline, r.deadline);
});

test('working_day: 1 рабочий день = первый рабочий день течения', () => {
  const r = computeDeadline(wdTerm(1), '2026-02-13'); // пятница
  assert.equal(r.deadline, '2026-02-16');
  assert.equal(r.first_working_day, r.deadline);
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
