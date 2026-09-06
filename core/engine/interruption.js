// Механика перерыва срока: событие → отсев непригодных → сдвиг якоря на
// последнее по хронологии учтённое событие. Предметно-независимо: не знает
// ни оснований перерыва (допустимые типы событий передаются параметром), ни
// текста нормы или предупреждения, которым помечается результат (тоже
// параметр) — у разных процессуальных законов правила предъявления и
// перерыва могут различаться, поэтому конкретика сюда не зашивается.

import { toISO, compareInterruptions, computeSimpleTerm } from './term.js';

/**
 * События-перерывы в расчётной форме, отсортированные по дате по возрастанию.
 * Порядок ввода хронологии не гарантирован (перерывы вспоминают вразнобой),
 * поэтому сортировка обязательна.
 *
 * Событие помечается ignored, если учесть его нельзя: не указана дата,
 * неизвестное основание либо дата раньше базового якоря — прерывать ещё не
 * начавшийся срок нечем, а сдвиг якоря назад дал бы дедлайн раньше базового.
 * Такие события не выбрасываются молча: они остаются в истории с причиной,
 * чтобы было видно, что именно не принято в расчёт.
 *
 * @param {Date|string|null} baseAnchorDate — базовая точка отсчёта срока.
 * @param {Array<{type:string, date:string}>|null|undefined} interruptions
 * @param {Set<string>} validTypeIds — допустимые основания перерыва.
 * @returns {Array<{type:string|null, date:string|null, ignored?:boolean, ignored_reason?:string}>}
 */
export function interruptionEvents(baseAnchorDate, interruptions, validTypeIds) {
  if (!Array.isArray(interruptions) || interruptions.length === 0) return [];
  const base = toISO(baseAnchorDate);
  return interruptions
    .map((raw) => {
      const type = raw?.type ?? null;
      const date = toISO(raw?.date);
      if (date == null) return { type, date: null, ignored: true, ignored_reason: 'no_date' };
      if (!validTypeIds.has(type)) {
        return { type, date, ignored: true, ignored_reason: 'unknown_type' };
      }
      if (base != null && date < base) {
        return { type, date, ignored: true, ignored_reason: 'before_anchor' };
      }
      return { type, date };
    })
    .sort(compareInterruptions);
}

/**
 * Точка отсчёта срока с учётом перерывов: дата последнего по хронологии
 * учтённого события. Без событий — базовый якорь без изменений.
 * @param {Date|string|null} baseAnchorDate
 * @param {Array<{type:string, date:string}>|null|undefined} interruptions
 * @param {Set<string>} validTypeIds — допустимые основания перерыва.
 * @returns {Date|string|null} тот же baseAnchorDate либо ISO-дата перерыва.
 */
export function applyInterruptions(baseAnchorDate, interruptions, validTypeIds) {
  const applied = interruptionEvents(baseAnchorDate, interruptions, validTypeIds).filter(
    (e) => !e.ignored,
  );
  if (applied.length === 0) return baseAnchorDate;
  return applied[applied.length - 1].date;
}

// Исходный якорь на посчитанном сроке: в calc.anchor лежит уже сдвинутая дата,
// а история перерывов без точки, от которой срок шёл изначально, не читается.
//
// config — { norm, logic, warning }: текст нормы, логики и (опционально)
// предупреждения об области применения, которыми помечается результат.
// Предметный модуль решает, что туда положить — здесь только сборка объекта.
export function withInterruptions(result, baseAnchorISO, events, config) {
  if (result == null || events.length === 0) return result;
  return {
    ...result,
    base_anchor: baseAnchorISO,
    interruptions: events,
    interruption_norm: config.norm,
    interruption_logic: config.logic,
    interruption_warning: config.warning,
  };
}

// Срок, который может быть прерван внешним событием: тот же расчёт, что и у
// computeSimpleTerm, но якорь сдвигается на последнее по хронологии событие
// (applyInterruptions), а исходный сохраняется в base_anchor для истории.
export function computeInterruptibleTerm(term, baseAnchorDate, interruptions, validTypeIds, config) {
  const base = toISO(baseAnchorDate);
  if (base == null) return null;
  const events = interruptionEvents(base, interruptions, validTypeIds);
  const result = computeSimpleTerm(term, applyInterruptions(base, interruptions, validTypeIds));
  return withInterruptions(result, base, events, config);
}
