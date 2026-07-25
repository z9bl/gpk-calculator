// Тест календарного модуля: 96/96 контрольных месяца (п. 5.3 SPEC.md) —
// 2020–2026 (постановления приняты) + 2027 (draft, по проекту постановления).
// Любое расхождение с checksums в calendar_data.json — ошибка алгоритма
// или данных, релиз блокируется.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  isWorkingDay,
  shiftIfNonWorking,
  toISODate,
  getYearInfo,
  calendarNote,
} from '../src/calendar.js';

const calendarData = JSON.parse(
  readFileSync(new URL('../calendar_data.json', import.meta.url), 'utf8'),
);

test('96/96 контрольных месяца совпадают с checksums', () => {
  let monthsChecked = 0;

  for (const year of Object.keys(calendarData)) {
    const y = Number(year);
    const { checksums } = calendarData[year];

    for (const [mm, expected] of Object.entries(checksums)) {
      const m = Number(mm);
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

      let work = 0;
      let off = 0;
      for (let d = 1; d <= daysInMonth; d += 1) {
        if (isWorkingDay(new Date(Date.UTC(y, m - 1, d)))) work += 1;
        else off += 1;
      }

      const where = `${year}-${mm}`;
      assert.equal(daysInMonth, expected.cal, `${where}: календарных дней`);
      assert.equal(work, expected.work, `${where}: рабочих дней`);
      assert.equal(off, expected.off, `${where}: нерабочих дней`);
      assert.equal(work + off, expected.cal, `${where}: сумма дней`);

      monthsChecked += 1;
    }
  }

  assert.equal(monthsChecked, 96, 'должно быть проверено ровно 96 месяцев');
});

test('isWorkingDay принимает и Date, и строку', () => {
  // 12.06.2021 (Россия) — суббота, праздник.
  assert.equal(isWorkingDay('2021-06-12'), false);
  assert.equal(isWorkingDay(new Date(Date.UTC(2021, 5, 12))), false);
  // 15.06.2021 — обычный вторник.
  assert.equal(isWorkingDay('2021-06-15'), true);
});

test('shiftIfNonWorking переносит на следующий рабочий день (ч. 2 ст. 108)', () => {
  // 12.06.2021 (сб, праздник) → 13 вс → 15.06 вт (14.06 — перенос за 12-е).
  assert.equal(shiftIfNonWorking('2021-06-12'), '2021-06-15');
  // Рабочий день не сдвигается.
  assert.equal(shiftIfNonWorking('2021-06-15'), '2021-06-15');
  // Перенос через границу года: 31.12.2021 — нерабочий (донор → 03.01→31.12),
  // 01–08.01.2022 — праздники → первый рабочий день 10.01.2022.
  assert.equal(shiftIfNonWorking('2021-12-31'), '2022-01-10');
  // Тип результата совпадает с типом аргумента.
  const shifted = shiftIfNonWorking(new Date(Date.UTC(2021, 5, 12)));
  assert.ok(shifted instanceof Date);
  assert.equal(toISODate(shifted), '2021-06-15');
});

test('три уровня достоверности календаря (п. 5.4)', () => {
  assert.equal(getYearInfo(2025).level, 'final'); // постановление принято
  assert.equal(getYearInfo(2027).level, 'draft'); // проект постановления
  assert.equal(getYearInfo(2028).level, 'preliminary'); // данных нет
});

test('calendarNote: окончательный год — примечания нет', () => {
  assert.equal(calendarNote('2025-01-05'), null);
  assert.equal(calendarNote('2025-05-04'), null);
});

test('calendarNote draft (2027): зона включает янв./май + начало ноября и конец декабря', () => {
  assert.equal(calendarNote('2027-01-10').level, 'draft'); // январские каникулы
  assert.equal(calendarNote('2027-05-05').level, 'draft'); // майские
  assert.equal(calendarNote('2027-11-05').level, 'draft'); // перенос 02.01 → 05.11
  assert.equal(calendarNote('2027-12-22').level, 'draft'); // расширенная зона конца декабря
  assert.equal(calendarNote('2027-12-31').level, 'draft'); // перенос 03.01 → 31.12
  assert.match(calendarNote('2027-01-10').text, /проект/);
  assert.equal(calendarNote('2027-07-15'), null); // вне зоны
});

test('calendarNote preliminary (2028+): зона уже — без начала ноября и середины декабря', () => {
  assert.equal(calendarNote('2028-01-10').level, 'preliminary');
  assert.equal(calendarNote('2028-05-05').level, 'preliminary');
  assert.match(calendarNote('2028-01-10').text, /не издано/);
  // draft-специфичные окрестности (начало ноября, 20–24 декабря) — вне зоны:
  assert.equal(calendarNote('2028-11-05'), null);
  assert.equal(calendarNote('2028-12-22'), null);
});
