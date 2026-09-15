// Механика вычитания периода из срока: событие с двумя датами (начало и конец
// отрезка) → отсев непригодных → сдвиг дедлайна назад на суммарную длину
// учтённых отрезков. Предметно-независимо: не знает ни оснований вычета
// (допустимые типы событий передаются параметром), ни текста нормы, которым
// помечается результат (тоже параметр).
//
// Отличие от core/engine/interruption.js (перерыв): там точка отсчёта
// СДВИГАЕТСЯ ВПЕРЁД на дату события и срок начинается заново во всю длину;
// здесь длина самого срока УМЕНЬШАЕТСЯ на измеренный отрезок, а точка отсчёта
// не трогается. Две разные арифметики — поэтому и два разных модуля.

import { shiftIfNonWorking, toISODate } from '../calendar/calendar.js';
import { addDays } from './engine.js';
import { toISO } from './term.js';

const DAY_MS = 86_400_000;

// Длина отрезка в календарных днях между двумя ISO-датами.
//
// ASSUMPTION (границы отрезка). Отрезок «со дня A до дня B» измеряется как
// разность B − A, то есть день начала в длину входит, а день окончания — нет
// (A === B даёт ноль дней). Включающий счёт (B − A + 1) дал бы на каждом
// отрезке лишний день. Выбор не следует из текста нормы дословно и подлежит
// проверке по первоисточнику — см. раздел 9 SPEC.md.
function periodDays(fromISO, toISOValue) {
  const [fy, fm, fd] = fromISO.split('-').map(Number);
  const [ty, tm, td] = toISOValue.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
}

// Сортировка отрезков по дате начала по возрастанию; записи без начала — в
// конец (по тому же правилу, что compareInterruptions в term.js).
function comparePeriods(a, b) {
  if (a.from == null) return b.from == null ? 0 : 1;
  if (b.from == null) return -1;
  if (a.from < b.from) return -1;
  return a.from > b.from ? 1 : 0;
}

/**
 * События-вычеты в расчётной форме, отсортированные по дате начала отрезка.
 *
 * Событие помечается ignored, если учесть его нельзя: не указана одна из двух
 * дат, неизвестное основание либо конец отрезка раньше его начала. Такие
 * события не выбрасываются молча — они остаются в истории с причиной, чтобы
 * было видно, что именно не принято в расчёт (как у перерывов).
 *
 * Отрезок нулевой длины (from === to) непригодным НЕ считается: он корректен и
 * просто не уменьшает срок.
 *
 * @param {Array<{type:string, from:string, to:string}>|null|undefined} deductions
 * @param {Set<string>} validTypeIds — допустимые основания вычета.
 * @returns {Array<{type:string|null, from:string|null, to:string|null, days?:number,
 *   ignored?:boolean, ignored_reason?:string}>}
 */
export function deductionEvents(deductions, validTypeIds) {
  if (!Array.isArray(deductions) || deductions.length === 0) return [];
  return deductions
    .map((raw) => {
      const type = raw?.type ?? null;
      const from = toISO(raw?.from);
      const to = toISO(raw?.to);
      if (!validTypeIds.has(type)) {
        return { type, from, to, ignored: true, ignored_reason: 'unknown_type' };
      }
      if (from == null || to == null) {
        return { type, from, to, ignored: true, ignored_reason: 'no_date' };
      }
      if (to < from) {
        return { type, from, to, ignored: true, ignored_reason: 'negative_period' };
      }
      return { type, from, to, days: periodDays(from, to) };
    })
    .sort(comparePeriods);
}

/**
 * Суммарная длина учтённых отрезков в днях.
 *
 * ASSUMPTION (несколько отрезков). Отрезки складываются все без исключения:
 * пересечение двух отрезков во времени не схлопывается, и ни один отрезок не
 * отбрасывается по хронологии относительно других событий. Норма говорит об
 * одном отрезке и о том, как считать несколько, умалчивает. См. раздел 9
 * SPEC.md.
 *
 * @param {Array<{days?:number, ignored?:boolean}>} events
 * @returns {number}
 */
export function totalDeductedDays(events) {
  return events.reduce((sum, e) => (e.ignored ? sum : sum + e.days), 0);
}

/**
 * Уменьшение посчитанного срока на суммарную длину отрезков.
 *
 * Сдвигается сырой дедлайн (raw_deadline), а перенос последнего дня на рабочий
 * применяется ЗАНОВО к полученной дате: перенос — свойство последнего дня
 * срока, а не константа, и после сдвига последний день другой.
 *
 * Граничный случай «вычет не меньше самого срока»: дедлайн не опускается ниже
 * дня, в который срок начал течь (anchor + offset_start). Дальше опускать
 * некуда — отрицательный срок не имеет смысла, а дата раньше начала течения
 * читалась бы как «срок истёк до того, как начался». Такой результат
 * помечается флагом deduction_exhausts_term: срок выбран вычетом полностью.
 *
 * Флаг ставится и при точном равенстве (вычет ровно во всю длину срока):
 * остатка нет и там, а «истекает в день, когда начал течь» без пометки
 * читалось бы как обычный расчёт.
 *
 * @param {object|null} result — результат расчёта срока (anchor, offset_start,
 *   raw_deadline, deadline, shifted).
 * @param {{weekend_shift?:boolean}} term — определение срока: нужен только
 *   признак переноса последнего дня.
 * @param {Array} events — события из deductionEvents().
 * @param {{norm:string, logic:string, assumption?:object}} config — тексты,
 *   которыми помечается результат; предметный модуль решает, что туда положить.
 * @returns {object|null}
 */
export function withDeductions(result, term, events, config) {
  if (result == null || events.length === 0) return result;
  const days = totalDeductedDays(events);

  // Пол: день, в который срок начал течь. offset_start у посчитанного срока
  // уже нормализован движком (computeDeadline), брать его из term не нужно.
  const floor = toISODate(addDays(result.anchor, result.offset_start));
  let raw = toISODate(addDays(result.raw_deadline, -days));
  const exhausts = raw <= floor;
  if (exhausts) raw = floor;

  // shiftIfNonWorking сохраняет тип аргумента: на ISO-строке возвращает строку.
  const deadline = term.weekend_shift === false ? raw : shiftIfNonWorking(raw);
  const deducted = {
    ...result,
    // Что было до вычета — иначе на карточке не видно, из чего вычитали.
    deadline_before_deduction: result.deadline,
    raw_deadline_before_deduction: result.raw_deadline,
    raw_deadline: raw,
    deadline,
    shifted: deadline !== raw,
    deductions: events,
    deducted_days: days,
    deduction_norm: config.norm,
    deduction_logic: config.logic,
    deduction_assumption: config.assumption,
  };
  if (exhausts) deducted.deduction_exhausts_term = true;
  return deducted;
}
