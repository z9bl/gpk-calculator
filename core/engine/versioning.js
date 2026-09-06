// Норм-версионирование: выбор редакции нормы, действующей на дату
// процессуального действия. Предметно-независим: правило «применяется
// редакция, действующая на момент процессуального действия» — общее для
// процессуальных кодексов (сверено для ГПК ч. 3 ст. 1 и АПК ч. 4 ст. 3).
//
// Модель: у срока вместо одной нормы — norm_versions (список редакций с
// границами from/to, включительно, null = без границы), у каждой — своя
// точка отсчёта и текст нормы. Резолвинг точки отсчёта под конкретную
// редакцию — дело вызывающего кода (resolveAnchorFor), сам механизм не
// знает, что означает та или иная точка отсчёта.

import { computeDeadline } from './engine.js';
import { toISO } from './term.js';

// Редакция нормы по дате: границы включительны, null = без границы.
export function pickVersion(versions, dateISO) {
  return versions.find(
    (v) => (v.from == null || dateISO >= v.from) && (v.to == null || dateISO <= v.to),
  );
}

// Расчёт по конкретной редакции (offset_start + месяцы + перенос выходного).
function termDeadline(term, anchorSpec, anchorDate) {
  return computeDeadline(
    {
      duration: term.duration,
      anchor: { offset_start: anchorSpec.offset_start },
      weekend_shift: term.weekend_shift,
    },
    anchorDate,
  );
}

// Пограничное окно редакций. Если действует более поздняя редакция (по дате
// подачи), но по прежней срок истёк ещё до отсечки (даты вступления новой
// редакции в силу), а по действующей — уже после, отсечка попадает между
// датами. Расчёт остаётся по действующей редакции, но показываются обе даты.
// Пояснение конкретной причины окна (например, что у закона, вводящего
// редакцию, нет переходных положений) — в поле boundary_note самой
// действующей редакции; без этого поля предупреждение не формируется.
// resolveAnchorFor(version) → дата точки отсчёта или null.
function boundaryWarning(term, version, resolveAnchorFor, currentDeadline) {
  if (version.boundary_note == null) return null; // нечего показывать
  const versions = term.norm_versions;
  const idx = versions.indexOf(version);
  if (idx <= 0) return null; // действует самая ранняя редакция — окна нет
  const prev = versions[idx - 1];
  const cutoff = version.from; // граница = дата вступления редакции в силу
  if (cutoff == null) return null;

  const prevAnchor = resolveAnchorFor(prev);
  if (prevAnchor == null) return null;
  const prevDeadline = termDeadline(term, prev.anchor, prevAnchor).deadline;

  // Отсечка между датами: прежняя истекла до неё, действующая — на/после.
  if (prevDeadline < cutoff && currentDeadline >= cutoff) {
    return {
      cutoff,
      prev_version_id: prev.id,
      prev_redaction_deadline: prevDeadline,
      current_deadline: currentDeadline,
      reason: version.boundary_note,
    };
  }
  return null;
}

// Обобщённый расчёт срока с темпоральными редакциями нормы: несколько
// редакций, действующих в разные периоды, с разными точками отсчёта или иным
// расчётом.
//   resolveAnchorFor(version) → дата точки отсчёта или null;
//   altDates — { ruling, reasoned } для alternative_calculation, или null.
export function computeVersionedTerm(term, effectiveDate, resolveAnchorFor, altDates) {
  if (effectiveDate == null) return null;
  const version = pickVersion(term.norm_versions, effectiveDate);
  if (version == null) return null;

  const anchor = resolveAnchorFor(version);
  // Нет точки отсчёта (напр. новая редакция без даты мотивированного
  // определения): срок ещё не считается.
  if (anchor == null) return null;

  const primary = termDeadline(term, version.anchor, anchor);

  const result = {
    id: term.id,
    title: term.title,
    anchor,
    offset_start: primary.offset_start,
    raw_deadline: primary.raw_deadline,
    deadline: primary.deadline,
    shifted: primary.shifted,
    version_id: version.id,
    effective_date: effectiveDate,
    logic: version.logic,
    midnight_rule: term.midnight_rule,
    norm: version.norm,
  };

  // alternative_calculation — только у редакции, где она задана в данных, при
  // расхождении дат, которые описывает вызывающий код (altDates).
  const altSpec = version.alternative_calculation;
  if (altSpec && altDates) {
    const ruling = toISO(altDates.ruling);
    const reasoned = toISO(altDates.reasoned);
    if (ruling != null && reasoned != null && reasoned > ruling) {
      const alt = termDeadline(term, altSpec.anchor, ruling);
      const recommended =
        alt.deadline < primary.deadline ? alt.deadline : primary.deadline; // prefer: earliest
      result.alternative = {
        anchor: ruling,
        raw_deadline: alt.raw_deadline,
        deadline: alt.deadline,
        shifted: alt.shifted,
        norm: altSpec.norm,
        reason: altSpec.reason,
        prefer: altSpec.prefer,
        recommended_deadline: recommended,
        recommendation: altSpec.recommendation,
      };
    }
  }

  // Пограничное окно редакций — расчёт не меняем, только предупреждение.
  const bw = boundaryWarning(term, version, resolveAnchorFor, primary.deadline);
  if (bw) result.boundary_warning = bw;

  return result;
}
