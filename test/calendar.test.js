// Тест календарного модуля: 84/84 контрольных месяца (п. 5.3 SPEC.md).
// Любое расхождение с checksums в calendar_data.json — ошибка алгоритма
// или данных, релиз блокируется.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isWorkingDay, shiftIfNonWorking, toISODate } from '../src/calendar.js';

const calendarData = JSON.parse(
  readFileSync(new URL('../calendar_data.json', import.meta.url), 'utf8'),
);

test('84/84 контрольных месяца совпадают с checksums', () => {
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

  assert.equal(monthsChecked, 84, 'должно быть проверено ровно 84 месяца');
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
