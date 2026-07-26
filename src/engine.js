// Движок сроков (раздел 8, задача 2 SPEC.md).
//
// Единицы:
//   month / year — ч. 1 ст. 108 ГПК РФ (истекает в соответствующее число; нет
//     такого числа — последний день месяца), с переносом последнего дня на
//     рабочий по ч. 2 ст. 108 (weekend_shift → shiftIfNonWorking);
//   working_day — абз. 2 ч. 3 ст. 107 ГПК РФ (нерабочие дни не включаются);
//     weekend_shift к таким срокам НЕ применяется — последний день рабочий по
//     построению.
// Начало течения во всех случаях — по ч. 3 ст. 107 через offset_start.

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

  if (duration.unit === 'month' || duration.unit === 'year') {
    // Месяцы (ч. 1 ст. 108) и годы: год = 12 месяцев, срок истекает в
    // соответствующие месяц и число последнего года; нет числа (29.02 в
    // невисокосный) — последний день месяца.
    const months = duration.unit === 'year' ? duration.value * 12 : duration.value;
    // Начало течения = событие + offset_start; «соответствующее число» — на день
    // раньше начала течения, т.е. событие + (offset_start − 1).
    const base = addDays(anchor, offsetStart - 1);
    const raw = addMonths(base, months);
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

  if (duration.unit === 'working_day' || duration.unit === 'day') {
    // Сроки, исчисляемые днями: нерабочие дни не включаются
    // (абз. 2 ч. 3 ст. 107 ГПК РФ; нерабочие — по ст. 111–112 ТК РФ через
    // календарный модуль, п. 16 ПП ВС № 16, п. 22 ПП ВС № 17).
    //
    // Течение начинается со следующего дня после события (ч. 3 ст. 107); если
    // этот день нерабочий, отсчёт начинается с первого рабочего. Считаются
    // только рабочие дни; срок истекает в конце N-го рабочего дня.
    //
    // weekend_shift (ч. 2 ст. 108) к таким срокам НЕ применяется: последний
    // день рабочий по построению, повторный перенос сдвинул бы дату лишний раз.
    const firstDay = toDate(shiftIfNonWorking(addDays(anchor, offsetStart)));
    let cursor = firstDay;
    for (let counted = 1; counted < duration.value; counted += 1) {
      cursor = toDate(shiftIfNonWorking(addDays(cursor, 1)));
    }
    const deadlineISO = toISODate(cursor);
    return {
      anchor: toISODate(anchor),
      offset_start: offsetStart,
      first_working_day: toISODate(firstDay),
      raw_deadline: deadlineISO, // переноса нет — сырая и итоговая дата совпадают
      deadline: deadlineISO,
      shifted: false, // ч. 2 ст. 108 не применяется (см. выше)
    };
  }

  throw new Error(`Неизвестная единица срока: ${duration.unit}`);
}
