// Годичный потолок восстановления пропущенного кассационного/надзорного
// срока (ч. 7 ст. 112 ГПК РФ) — на синтетических датах, без привязки к
// конкретному узлу ГПК: полнота подключения к реальным узлам проверяется
// на стороне предметного модуля (см. test/chain.test.js).

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkRestorationOneYearCap } from '../../core/engine/restoration.js';

test('обстоятельство в пределах года — потолок не блокирует', () => {
  const result = checkRestorationOneYearCap('2024-01-10', '2024-06-15');
  assert.equal(result.within_cap, true);
  assert.equal(result.cap_deadline, '2025-01-10');
});

test('обстоятельство ровно на границе года — «не позднее одного года» включительно', () => {
  const result = checkRestorationOneYearCap('2024-01-10', '2025-01-10');
  assert.equal(result.within_cap, true);
  assert.equal(result.cap_deadline, '2025-01-10');
});

test('обстоятельство на следующий день после границы — потолок блокирует', () => {
  const result = checkRestorationOneYearCap('2024-01-10', '2025-01-11');
  assert.equal(result.within_cap, false);
  assert.equal(result.cap_deadline, '2025-01-10');
});

test('обстоятельство далеко за пределами года — потолок блокирует', () => {
  const result = checkRestorationOneYearCap('2020-03-01', '2023-03-01');
  assert.equal(result.within_cap, false);
});

test('граница года от 29 февраля високосного года — клампинг на 28.02', () => {
  // Тот же приём, что и у core/engine/engine.js (addMonths): нет 29 февраля
  // в невисокосном 2025-м — граница на последнем дне месяца.
  const result = checkRestorationOneYearCap('2024-02-29', '2025-02-28');
  assert.equal(result.within_cap, true);
  assert.equal(result.cap_deadline, '2025-02-28');
});

test('дата вступления в силу не задана — null, а не ложное «в пределах»', () => {
  assert.equal(checkRestorationOneYearCap(null, '2024-06-15'), null);
});

test('дата обстоятельства не задана — null, а не ложное «в пределах»', () => {
  assert.equal(checkRestorationOneYearCap('2024-01-10', null), null);
});

test('принимает Date наравне со строкой ISO', () => {
  const entry = new Date(Date.UTC(2024, 0, 10));
  const circumstance = new Date(Date.UTC(2025, 0, 10));
  const result = checkRestorationOneYearCap(entry, circumstance);
  assert.equal(result.within_cap, true);
});
