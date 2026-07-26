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
  // Три уровня достоверности (п. 5.4 SPEC.md): постановление принято →
  // окончательно; draft: true → переносы из проекта постановления; данных нет
  // → предварительно по ст. 111–112 ТК без переносов.
  const preliminary = !yearData;
  const draft = !!(yearData && yearData.draft);
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

  return { nonWorking, preliminary, draft };
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
 * Перенос назад, к предыдущему рабочему дню. Если день рабочий — возвращается
 * он же. Используется для дат напоминаний .ics: сдвиг вперёд съедал бы запас,
 * поэтому нерабочий день переносится на более раннюю дату (раздел 8 SPEC.md).
 * Тип результата совпадает с типом аргумента (Date → Date, строка → строка).
 * @param {Date|string} date
 * @returns {Date|string}
 */
export function shiftBackIfNonWorking(date) {
  let dt = normalize(date);
  while (!isWorkingDay(dt)) {
    dt = new Date(dt.getTime() - DAY_MS);
  }
  return typeof date === 'string' ? toKey(dt) : dt;
}

/**
 * Отступ назад на N рабочих дней от даты. Нерабочие дни не считаются; результат
 * — рабочий день по построению, дополнительный сдвиг не нужен. Используется для
 * дат напоминаний по срокам, исчисляемым в рабочих днях (раздел 8 SPEC.md):
 * смещение считается в рабочих днях, потому что и сам срок в них исчисляется.
 * @param {Date|string} date — отсчётная дата (обычно дедлайн).
 * @param {number} n — сколько рабочих дней отступить назад.
 * @returns {Date|string} тип результата совпадает с типом аргумента.
 */
export function subtractWorkingDays(date, n) {
  let dt = normalize(date);
  for (let i = 0; i < n; i += 1) {
    dt = new Date(dt.getTime() - DAY_MS);
    while (!isWorkingDay(dt)) {
      dt = new Date(dt.getTime() - DAY_MS);
    }
  }
  return typeof date === 'string' ? toKey(dt) : dt;
}

/**
 * Уровень достоверности календаря года (три уровня, п. 5.4 SPEC.md).
 * @param {number} year
 * @returns {{ level: 'final'|'draft'|'preliminary', preliminary: boolean, draft: boolean }}
 *   final — постановление принято; draft — расчёт по проекту постановления
 *   (флаг draft в данных); preliminary — данных нет (ст. 111–112 ТК без переносов).
 */
export function getYearInfo(year) {
  const { preliminary, draft } = getYear(year);
  const level = preliminary ? 'preliminary' : draft ? 'draft' : 'final';
  return { level, preliminary, draft };
}

// Зона риска переносов (п. 5.4 SPEC.md). Для окончательного календаря — нет
// зоны (расчёт точный). Для предварительного — окрестности январских каникул и
// майских праздников. Для draft-года зона шире: проект добавляет переносы в
// начало ноября (02.01 → 05.11) и конец декабря (03.01 → 31.12).
function isInRiskZone(month, day, draft) {
  const januaryVicinity = (month === 1 && day <= 15) || (month === 12 && day >= 25);
  const mayVicinity = (month === 5 && day <= 15) || (month === 4 && day >= 25);
  if (januaryVicinity || mayVicinity) return true;
  if (draft) {
    const novemberVicinity = month === 11 && day <= 10;
    const decemberVicinity = month === 12 && day >= 20;
    if (novemberVicinity || decemberVicinity) return true;
  }
  return false;
}

/**
 * Примечание о достоверности расчёта для итоговой даты (зональное правило 5.4).
 * Возвращает null, если год окончательный или дата вне зоны возможных переносов.
 * @param {Date|string} date
 * @returns {{ level:'draft'|'preliminary', year:number, text:string } | null}
 */
export function calendarNote(date) {
  const dt = normalize(date);
  const year = dt.getUTCFullYear();
  const { preliminary, draft } = getYear(year);
  if (!preliminary && !draft) return null; // окончательный календарь
  if (!isInRiskZone(dt.getUTCMonth() + 1, dt.getUTCDate(), draft)) return null;
  if (draft) {
    return {
      level: 'draft',
      year,
      text:
        `Предварительно: расчёт по проекту постановления Правительства о ` +
        `переносах выходных на ${year} год. Постановление не принято — даты ` +
        `переносов, а с ними и этот срок, могут измениться.`,
    };
  }
  return {
    level: 'preliminary',
    year,
    text:
      `Предварительно: постановление о переносах выходных на ${year} год не ` +
      `издано. Расчёт по ст. 111–112 ТК без переносов — итоговая дата может измениться.`,
  };
}

export { toKey as toISODate };
