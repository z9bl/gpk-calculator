// Движок сроков (раздел 8, задача 2 SPEC.md).
//
// Реализует единицу `month` по ч. 1 ст. 108 ГПК РФ (срок истекает в
// соответствующее число последнего месяца; нет такого числа — последний день
// месяца) с учётом начала течения по ч. 3 ст. 107 (offset_start) и переноса
// последнего дня на рабочий по ч. 2 ст. 108 (weekend_shift → shiftIfNonWorking).

import { shiftIfNonWorking, toISODate } from './calendar.js';

const DAY_MS = 86_400_000;

// Принимает Date или 'YYYY-MM-DD', возвращает Date (UTC-полночь).
function toDate(date) {
  if (date instanceof Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
  if (typeof date === 'string') {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  throw new TypeError('Ожидается Date или строка формата YYYY-MM-DD');
}

/**
 * Прибавить дни к дате.
 * @param {Date|string} date
 * @param {number} days
 * @returns {Date}
 */
export function addDays(date, days) {
  return new Date(toDate(date).getTime() + days * DAY_MS);
}

/**
 * Прибавить месяцы по ч. 1 ст. 108 ГПК РФ: сохраняется число месяца; если в
 * целевом месяце такого числа нет (31-е в коротком месяце, 29-е февраля в
 * невисокосный год) — берётся последний день месяца.
 * @param {Date|string} date
 * @param {number} months
 * @returns {Date}
 */
export function addMonths(date, months) {
  const dt = toDate(date);
  const monthIndex = dt.getUTCMonth() + months;
  const targetYear = dt.getUTCFullYear() + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  // День 0 следующего месяца = последний день целевого месяца.
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(dt.getUTCDate(), lastDay);
  return new Date(Date.UTC(targetYear, targetMonth, day));
}

/**
 * Расчёт дедлайна по сроку (term из п. 4.2 SPEC.md).
 *
 * Для unit: month:
 *   - течение начинается на offset_start-й день после события (ч. 3 ст. 107);
 *   - срок истекает в «соответствующее число» последнего месяца (ч. 1 ст. 108) —
 *     число, равное дню, предшествующему началу течения. При offset_start = 1
 *     это совпадает с числом самого события (пример п. 12 ПП ВС № 17:
 *     02.06.2021 + 3 месяца → 02.09.2021, а не 03.09.2021);
 *   - если weekend_shift не выключен, последний день переносится на следующий
 *     рабочий (ч. 2 ст. 108) через shiftIfNonWorking.
 *
 * @param {{duration:{value:number,unit:string}, anchor?:{offset_start?:number}, weekend_shift?:boolean}} term
 * @param {Date|string} anchorDate — дата события-якоря.
 * @returns {{anchor:string, offset_start:number, raw_deadline:string, deadline:string, shifted:boolean}}
 */
export function computeDeadline(term, anchorDate) {
  const { duration } = term;
  const offsetStart = term.anchor?.offset_start ?? 1;
  const anchor = toDate(anchorDate);

  if (duration.unit === 'month') {
    // Начало течения = событие + offset_start; «соответствующее число» — на день
    // раньше начала течения, т.е. событие + (offset_start − 1).
    const base = addDays(anchor, offsetStart - 1);
    const raw = addMonths(base, duration.value);
    const doShift = term.weekend_shift !== false;
    const shifted = doShift ? toDate(shiftIfNonWorking(raw)) : raw;
    return {
      anchor: toISODate(anchor),
      offset_start: offsetStart,
      raw_deadline: toISODate(raw),
      deadline: toISODate(shifted),
      shifted: toISODate(shifted) !== toISODate(raw),
    };
  }

  if (duration.unit === 'day' || duration.unit === 'working_day') {
    // Сроки в днях = рабочие дни (абз. 2 ч. 3 ст. 107 ГПК РФ) — вторая версия.
    throw new Error(
      'Сроки в днях (рабочие дни, абз. 2 ч. 3 ст. 107 ГПК РФ) — вторая версия, не MVP',
    );
  }

  throw new Error(`Неизвестная единица срока: ${duration.unit}`);
}
