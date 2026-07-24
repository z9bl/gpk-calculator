// Цепочка обжалования (раздел 8, задача 3 SPEC.md).
//
// inputs (п. 4.1) → event entry_into_force с тремя ветвями (п. 4.3) → terms
// (п. 4.2). Ключевой механизм — поле `sets` ветви: ввод даты подачи жалобы
// переключает cassation_anchor, и кассационный срок считается от другой точки
// (п. 4.3, финальный абзац).
//
// Текущая дата (для ветвей not_appealed/pending) передаётся параметром, а не
// берётся из системных часов — иначе расчёт был бы недетерминированным.

import { computeDeadline, addDays } from './engine.js';
import { toISODate } from './calendar.js';

// --- Определения сроков (п. 4.2 SPEC.md) --------------------------------------

export const APPEAL_GENERAL = {
  id: 'appeal_general',
  title: 'Апелляционная жалоба',
  duration: { value: 1, unit: 'month' },
  anchor: { event: 'reasoned_decision_date', offset_start: 1 },
  weekend_shift: true,
  logic:
    'Месяц со дня принятия решения в окончательной форме. Течение — со дня, ' +
    'следующего за днём составления мотивированного решения; истекает в ' +
    'соответствующее число следующего месяца.',
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ — сдача на почту до 24:00 последнего дня',
  norm: {
    primary: 'ч. 1 ст. 321 ГПК РФ',
    calculation: ['ч. 3 ст. 107', 'ч. 1, 2 ст. 108 ГПК РФ'],
    clarification: 'п. 16 ПП ВС РФ от 22.06.2021 № 16',
  },
};

export const CASSATION_KSOYU = {
  id: 'cassation_ksoyu',
  title: 'Кассационная жалоба в КСОЮ',
  duration: { value: 3, unit: 'month' },
  anchor: { event: 'cassation_anchor', offset_start: 1 },
  condition: 'entry_into_force.resolved',
  weekend_shift: true,
  logic:
    'Три месяца. Точка отсчёта (cassation_anchor) — дата вступления решения в ' +
    'силу либо, при обжаловании, дата изготовления мотивированного ' +
    'апелляционного определения.',
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ',
  norm: {
    primary: 'ч. 1 ст. 376.1 ГПК РФ (ред. ФЗ от 12.06.2024 № 135-ФЗ)',
    calculation: ['ч. 3 ст. 107', 'ч. 1, 2 ст. 108 ГПК РФ'],
  },
  alternative_calculation: {
    // applies_when: branch == 'appealed' && appeal_ruling_reasoned_date > appeal_ruling_date
    anchor_event: 'appeal_ruling_date',
    norm: 'п. 12 ПП ВС РФ от 22.06.2021 № 17',
    reason: 'Разъяснение Пленума исходит из редакции нормы до ФЗ № 135-ФЗ от 12.06.2024.',
    prefer: 'earliest',
    recommendation: 'Рекомендуем ориентироваться на более раннюю дату.',
  },
};

const ENTRY_INTO_FORCE_NORM = 'ч. 1 ст. 209 ГПК РФ';

// --- Вспомогательные --------------------------------------------------------

// Приводит Date | 'YYYY-MM-DD' | null/undefined к ISO-строке или null.
function toISO(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const [y, m, d] = value.split('-').map(Number);
    return toISODate(new Date(Date.UTC(y, m - 1, d)));
  }
  return toISODate(value);
}

// --- Событие: вступление решения в силу (п. 4.3) ----------------------------

// Возвращает разрешённую ветвь события со значением cassation_anchor из `sets`.
function resolveEntryIntoForce(inputs, appealDeadline, today) {
  const appealFiled = toISO(inputs.appeal_filed_date);

  // Ветвь appealed: when = appeal_filed_date != null. От текущей даты не зависит.
  if (appealFiled != null) {
    const reasoned = toISO(inputs.appeal_ruling_reasoned_date);
    if (reasoned == null) {
      throw new Error(
        'Для обжалованного решения нужна дата изготовления мотивированного ' +
          'апелляционного определения (appeal_ruling_reasoned_date)',
      );
    }
    return {
      branch: 'appealed',
      resolved: true,
      date: toISO(inputs.appeal_ruling_date),
      // sets: { cassation_anchor: appeal_ruling_reasoned_date }
      cassation_anchor: reasoned,
      logic:
        'Обжаловано и оставлено в силе — вступает в силу после рассмотрения жалобы.',
      note:
        'Если апелляция отменила решение и приняла новое — новое вступает в силу немедленно.',
    };
  }

  // Ветви not_appealed / pending различаются по текущей дате.
  const t = toISO(today);
  if (t == null) {
    throw new Error(
      'Для ветвей not_appealed/pending нужна текущая дата (параметр today)',
    );
  }

  // not_appealed: when = appeal_filed_date == null && today > appeal_general.deadline
  if (t > appealDeadline) {
    const entryDate = toISO(addDays(appealDeadline, 1)); // deadline + 1 день
    return {
      branch: 'not_appealed',
      resolved: true,
      date: entryDate,
      // sets: { cassation_anchor: entry_into_force.date }
      cassation_anchor: entryDate,
      logic:
        'Не обжаловано — вступает в силу по истечении срока апелляционного обжалования.',
    };
  }

  // pending: when = appeal_filed_date == null && today <= appeal_general.deadline
  const notEarlierThan = toISO(addDays(appealDeadline, 1));
  return {
    branch: 'pending',
    resolved: false,
    date: null,
    cassation_anchor: null,
    not_earlier_than: notEarlierThan,
    message: `Вступит в силу не ранее ${notEarlierThan}`,
    logic: 'Срок апелляционного обжалования не истёк.',
  };
}

// --- Срок кассации (п. 4.2, п. 6) -------------------------------------------

function computeCassation(inputs, entry) {
  // condition: entry_into_force.resolved — пока событие не разрешено, не считаем.
  if (!entry.resolved) return null;

  const anchor = entry.cassation_anchor;
  const primary = computeDeadline(CASSATION_KSOYU, anchor);

  const result = {
    title: CASSATION_KSOYU.title,
    anchor,
    offset_start: primary.offset_start,
    raw_deadline: primary.raw_deadline,
    deadline: primary.deadline,
    shifted: primary.shifted,
    norm: CASSATION_KSOYU.norm,
  };

  // alternative_calculation: только appealed И мотивированное определение
  // изготовлено позже принятия (п. 6 SPEC.md — конфликт норм).
  if (entry.branch === 'appealed') {
    const ruling = toISO(inputs.appeal_ruling_date);
    const reasoned = toISO(inputs.appeal_ruling_reasoned_date);
    if (ruling != null && reasoned != null && reasoned > ruling) {
      const alt = computeDeadline(
        { ...CASSATION_KSOYU, anchor: { event: 'appeal_ruling_date', offset_start: 1 } },
        ruling,
      );
      const recommended =
        alt.deadline < primary.deadline ? alt.deadline : primary.deadline; // prefer: earliest
      result.alternative = {
        anchor: ruling,
        raw_deadline: alt.raw_deadline,
        deadline: alt.deadline,
        shifted: alt.shifted,
        norm: CASSATION_KSOYU.alternative_calculation.norm,
        reason: CASSATION_KSOYU.alternative_calculation.reason,
        prefer: CASSATION_KSOYU.alternative_calculation.prefer,
        recommended_deadline: recommended,
        recommendation: CASSATION_KSOYU.alternative_calculation.recommendation,
      };
    }
  }

  return result;
}

// --- Публичный расчёт цепочки -----------------------------------------------

/**
 * Расчёт цепочки: апелляция → вступление в силу → кассация.
 * @param {object} inputs — данные из п. 4.1 (reasoned_decision_date обязательна;
 *   appeal_filed_date, appeal_ruling_date, appeal_ruling_reasoned_date — опционально).
 * @param {{today?: Date|string}} [options] — текущая дата для ветвей
 *   not_appealed/pending. Передаётся явно, из системных часов не берётся.
 * @returns {{appeal:object, entry_into_force:object, cassation:object|null}}
 */
export function computeChain(inputs, options = {}) {
  if (inputs?.reasoned_decision_date == null) {
    throw new Error('Обязательна дата мотивированного решения (reasoned_decision_date)');
  }

  const appealRaw = computeDeadline(APPEAL_GENERAL, inputs.reasoned_decision_date);
  const appeal = {
    title: APPEAL_GENERAL.title,
    anchor: appealRaw.anchor,
    offset_start: appealRaw.offset_start,
    raw_deadline: appealRaw.raw_deadline,
    deadline: appealRaw.deadline,
    shifted: appealRaw.shifted,
    norm: APPEAL_GENERAL.norm,
  };

  const entry = resolveEntryIntoForce(inputs, appeal.deadline, options.today);
  const cassation = computeCassation(inputs, entry);

  return {
    appeal,
    entry_into_force: { norm: ENTRY_INTO_FORCE_NORM, ...entry },
    cassation,
  };
}
