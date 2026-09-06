// Движок сроков (раздел 8, задача 2 SPEC.md). Предметно-независим: правило
// начала течения срока, правило «соответствующего числа» для месяцев/лет и
// правило переноса последнего дня на рабочий совпадают по существу между
// ГПК (ст. 107–108) и АПК (ст. 113–114) — сверено по текстам обоих кодексов.
//
// Единицы:
//   month / year — истекает в соответствующее число; нет такого числа —
//     последний день месяца, с переносом последнего дня на рабочий
//     (weekend_shift → shiftIfNonWorking);
//   working_day — нерабочие дни не включаются; weekend_shift к таким срокам
//     НЕ применяется — последний день рабочий по построению.
// Начало течения во всех случаях — со дня, следующего за днём события,
// через offset_start.

import { shiftIfNonWorking, toISODate } from '../calendar/calendar.js';

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
 * Прибавить месяцы: сохраняется число месяца; если в целевом месяце такого
 * числа нет (31-е в коротком месяце, 29-е февраля в невисокосный год) —
 * берётся последний день месяца.
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
 *   - течение начинается на offset_start-й день после события;
 *   - срок истекает в «соответствующее число» последнего месяца — число,
 *     равное дню, предшествующему началу течения. При offset_start = 1 это
 *     совпадает с числом самого события (пример:
 *     02.06.2021 + 3 месяца → 02.09.2021, а не 03.09.2021);
 *   - если weekend_shift не выключен, последний день переносится на
 *     следующий рабочий через shiftIfNonWorking.
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
    // Месяцы и годы: год = 12 месяцев, срок истекает в соответствующие месяц
    // и число последнего года; нет числа (29.02 в невисокосный) — последний
    // день месяца.
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
    // Сроки, исчисляемые днями: нерабочие дни не включаются (нерабочие —
    // определяются календарным модулем).
    //
    // day и working_day обрабатываются идентично; это подтверждено для ГПК и
    // АПК, но при добавлении кодекса с иной семантикой календарных дней это
    // нужно будет пересмотреть.
    //
    // Течение начинается со следующего дня после события; если этот день
    // нерабочий, отсчёт начинается с первого рабочего. Считаются только
    // рабочие дни; срок истекает в конце N-го рабочего дня.
    //
    // weekend_shift к таким срокам НЕ применяется: последний день рабочий по
    // построению, повторный перенос сдвинул бы дату лишний раз.
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
      shifted: false, // weekend_shift не применяется (см. выше)
    };
  }

  throw new Error(`Неизвестная единица срока: ${duration.unit}`);
}
