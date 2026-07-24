// Календарный модуль (раздел 5 SPEC.md).
//
// Определяет рабочие и нерабочие дни РФ по производственному календарю и
// переносит дату на следующий рабочий день (ч. 2 ст. 108 ГПК РФ,
// ч. 2 ст. 112 ТК РФ).
//
// Источник истины — calendar_data.json (переносы Правительства + контрольные
// суммы). Алгоритм — шаги 1–6 из п. 5.1 SPEC.md.

import { readFileSync } from 'node:fs';

const calendarData = JSON.parse(
  readFileSync(new URL('../calendar_data.json', import.meta.url), 'utf8'),
);

// Нерабочие праздничные дни — ст. 112 ТК РФ ([месяц, день]).
// Январь 1–8 (новогодние каникулы + Рождество 7 января), 23 февраля,
// 8 марта, 1 и 9 мая, 12 июня, 4 ноября.
const FIXED_HOLIDAYS = [
  [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8],
  [2, 23], [3, 8], [5, 1], [5, 9], [6, 12], [11, 4],
];

const DAY_MS = 86_400_000;

function pad(n) {
  return String(n).padStart(2, '0');
}

// 'YYYY-MM-DD' для даты в UTC-полночь.
function toKey(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// Разбор 'YYYY-MM-DD' в Date (UTC-полночь) без влияния часового пояса.
function parseKey(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// Принимает Date или 'YYYY-MM-DD', возвращает Date (UTC-полночь).
function normalize(date) {
  if (date instanceof Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
  if (typeof date === 'string') {
    return parseKey(date);
  }
  throw new TypeError('Ожидается Date или строка формата YYYY-MM-DD');
}

function isWeekend(date) {
  const dow = date.getUTCDay(); // 0 — воскресенье, 6 — суббота
  return dow === 0 || dow === 6;
}

// Кэш множеств нерабочих дней по годам.
const cache = new Map();

// Построение множества нерабочих дней года по шагам 1–6 (п. 5.1 SPEC.md).
function buildYear(year) {
  const holidays = new Set(
    FIXED_HOLIDAYS.map(([m, d]) => `${year}-${pad(m)}-${pad(d)}`),
  );
  const nonWorking = new Set();

  // Шаг 1: все субботы и воскресенья (ст. 111 ТК РФ).
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year, 11, 31);
  for (let t = start; t <= end; t += DAY_MS) {
    const dt = new Date(t);
    if (isWeekend(dt)) nonWorking.add(toKey(dt));
  }

  // Шаг 2: праздники (ст. 112 ТК РФ).
  for (const h of holidays) nonWorking.add(h);

  // Шаги 3–4 и 6: переносы Правительства на конкретный год.
  const yearData = calendarData[String(year)];
  const preliminary = !yearData; // года без постановления (п. 5.4 SPEC.md)
  const donors = new Set();
  if (yearData && Array.isArray(yearData.transfers)) {
    for (const { from, to } of yearData.transfers) {
      donors.add(from);
      // День-приёмник становится нерабочим.
      nonWorking.add(to);
      // День-донор теряет статус выходного, НО если он сам праздничный
      // (правило-ловушка № 1) — остаётся нерабочим как праздник.
      if (!holidays.has(from)) nonWorking.delete(from);
    }
  }

  // Шаг 5: автоперенос ч. 2 ст. 112 ТК РФ. Праздник вне 1–8 января,
  // совпавший с субботой/воскресеньем и не упомянутый как донор,
  // переносит выходной на следующий рабочий день.
  for (const h of holidays) {
    const [, m, d] = h.split('-').map(Number);
    if (m === 1 && d >= 1 && d <= 8) continue; // новогодние — через постановление
    const dt = parseKey(h);
    if (!isWeekend(dt)) continue;
    if (donors.has(h)) continue;
    let next = new Date(dt.getTime() + DAY_MS);
    while (nonWorking.has(toKey(next))) {
      next = new Date(next.getTime() + DAY_MS);
    }
    nonWorking.add(toKey(next));
  }

  return { nonWorking, preliminary };
}

function getYear(year) {
  let entry = cache.get(year);
  if (!entry) {
    entry = buildYear(year);
    cache.set(year, entry);
  }
  return entry;
}

/**
 * Является ли день рабочим.
 * @param {Date|string} date — Date или 'YYYY-MM-DD'.
 * @returns {boolean}
 */
export function isWorkingDay(date) {
  const dt = normalize(date);
  const { nonWorking } = getYear(dt.getUTCFullYear());
  return !nonWorking.has(toKey(dt));
}

/**
 * Является ли день нерабочим (выходной или праздник с учётом переносов).
 * @param {Date|string} date
 * @returns {boolean}
 */
export function isNonWorkingDay(date) {
  return !isWorkingDay(date);
}

/**
 * Перенос последнего дня срока на следующий рабочий (ч. 2 ст. 108 ГПК РФ).
 * Если день рабочий — возвращается он же.
 * Тип результата совпадает с типом аргумента (Date → Date, строка → строка).
 * @param {Date|string} date
 * @returns {Date|string}
 */
export function shiftIfNonWorking(date) {
  let dt = normalize(date);
  while (!isWorkingDay(dt)) {
    dt = new Date(dt.getTime() + DAY_MS);
  }
  return typeof date === 'string' ? toKey(dt) : dt;
}

/**
 * Сведения о календаре года.
 * @param {number} year
 * @returns {{ preliminary: boolean }} preliminary=true — постановление о
 *   переносах на этот год не издано (расчёт по шагам 1, 2, 5), см. п. 5.4.
 */
export function getYearInfo(year) {
  const { preliminary } = getYear(year);
  return { preliminary };
}

export { toKey as toISODate };
