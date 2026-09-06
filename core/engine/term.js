// Расчёт одноредакционного срока и вспомогательные утилиты дат.
// Предметно-независимо: не знает ни о ГПК, ни о какой-либо конкретной норме —
// работает с term (duration/anchor/weekend_shift/norm_versions) как с данными.

import { computeDeadline } from './engine.js';
import { toISODate } from '../calendar/calendar.js';

// Приводит Date | 'YYYY-MM-DD' | null/undefined к ISO-строке или null.
//
// Пустая строка и неполные/битые даты дают null, а не «NaN-NaN-NaN»: иначе
// проверки вида `toISO(x) != null` ложно срабатывают на пустом поле ввода.
export function toISO(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const parts = value.split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    const [y, m, d] = parts;
    const date = new Date(Date.UTC(y, m - 1, d));
    return Number.isNaN(date.getTime()) ? null : toISODate(date);
  }
  const iso = toISODate(value);
  return iso === 'NaN-NaN-NaN' ? null : iso;
}

// Сортировка по дате по возрастанию; записи без даты — в конец.
export function compareInterruptions(a, b) {
  if (a.date == null) return b.date == null ? 0 : 1;
  if (b.date == null) return -1;
  if (a.date < b.date) return -1;
  return a.date > b.date ? 1 : 0;
}

/**
 * Расчёт срока с ровно одной действующей редакцией нормы; null, если якоря нет.
 *
 * Контракт: term.norm_versions должен содержать один элемент — `.norm` в
 * результате читается по индексу [0] без проверки, какая редакция действует на
 * нужную дату. Срок с несколькими редакциями, действующими в разные периоды,
 * должен считаться через computeVersionedTerm (versioning.js), а не эту
 * функцию.
 *
 * Контракт не проверяется рантаймом. На момент переноса в ядро в модуле ГПК
 * есть один узел (кассация по делам мировых судей, глава 40.1), который имеет
 * две редакции и всё же вызывает computeSimpleTerm: он остаётся корректным,
 * потому что caller передаёт итоговую норму явно через overrides.norm, и она
 * перекрывает значение, прочитанное здесь по индексу [0]. Это единственный
 * известный случай, где условие «ровно одна редакция» нарушено технически, но
 * не по результату; смотри открытый вопрос в истории изменений о том, стоит
 * ли добавлять рантайм-проверку с явным исключением для такого паттерна или
 * переводить подобные узлы на computeVersionedTerm.
 *
 * @param {object} term
 * @param {Date|string|null} anchorDate
 * @param {object|null} [overrides] — поля, которые полностью заменяют
 *   одноимённые поля результата (например, когда норма и логика зависят не от
 *   редакции, а от какого-то другого признака дела).
 * @returns {object|null}
 */
export function computeSimpleTerm(term, anchorDate, overrides = null) {
  const anchor = toISO(anchorDate);
  if (anchor == null) return null;
  const calc = computeDeadline(term, anchor);
  const result = {
    id: term.id,
    title: term.title,
    anchor: calc.anchor,
    offset_start: calc.offset_start,
    raw_deadline: calc.raw_deadline,
    deadline: calc.deadline,
    shifted: calc.shifted,
    logic: term.logic,
    midnight_rule: term.midnight_rule,
    norm: term.norm_versions[0].norm,
    // Фактическая длительность: у части сроков она зависит не от константы, а
    // от входных данных. Нужна вызывающему коду для правил напоминаний .ics.
    duration: term.duration,
  };
  if (term.interruptible) result.interruptible = true;
  if (calc.first_working_day) result.first_working_day = calc.first_working_day;
  return overrides ? { ...result, ...overrides } : result;
}
