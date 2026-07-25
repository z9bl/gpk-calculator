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
  ics: true,
  logic:
    'Месяц со дня принятия решения в окончательной форме. Течение — со дня, ' +
    'следующего за днём составления мотивированного решения; истекает в ' +
    'соответствующее число следующего месяца.',
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ — сдача на почту до 24:00 последнего дня',
  // Одна редакция за весь период (см. темпоральную модель, раздел 10 SPEC.md).
  norm_versions: [
    {
      id: 'current',
      from: null,
      to: null,
      anchor: { event: 'reasoned_decision_date', offset_start: 1 },
      norm: {
        primary: 'ч. 1 ст. 321 ГПК РФ',
        calculation: ['ч. 3 ст. 107', 'ч. 1, 2 ст. 108 ГПК РФ'],
        clarification: 'п. 16 ПП ВС РФ от 22.06.2021 № 16',
      },
    },
  ],
};

export const CASSATION_KSOYU = {
  id: 'cassation_ksoyu',
  title: 'Кассационная жалоба в КСОЮ',
  duration: { value: 3, unit: 'month' },
  condition: 'entry_into_force.resolved',
  weekend_shift: true,
  ics: true,
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ',
  // Темпоральная модель нормы (ч. 3 ст. 1 ГПК — раздел 10 SPEC.md): применяется
  // редакция, действующая на момент подачи кассационной жалобы (иначе — на
  // текущую дату). Отсечка — 01.09.2024, вступление в силу ФЗ № 135-ФЗ.
  norm_versions: [
    {
      id: 'before_135fz',
      from: null,
      to: '2024-08-31', // включительно
      anchor: { event: 'entry_into_force', offset_start: 1 },
      logic: 'Три месяца со дня вступления судебного постановления в законную силу.',
      norm: {
        primary: 'ч. 1 ст. 376.1 ГПК РФ (в редакции до ФЗ № 135-ФЗ от 12.06.2024)',
        calculation: ['ч. 3 ст. 107', 'ч. 1, 2 ст. 108 ГПК РФ'],
      },
    },
    {
      id: 'from_135fz',
      from: '2024-09-01',
      to: null,
      anchor: { event: 'appeal_ruling_reasoned', offset_start: 1 },
      logic: 'Три месяца со дня изготовления мотивированного апелляционного определения.',
      norm: {
        primary: 'абз. 2 ч. 1 ст. 376.1 ГПК РФ (ред. ФЗ № 135-ФЗ от 12.06.2024)',
        calculation: ['ч. 3 ст. 107', 'ч. 1, 2 ст. 108 ГПК РФ'],
      },
      // Конфликт с п. 12 ПП ВС № 17 существует только для этой редакции: до
      // 01.09.2024 разъяснение Пленума совпадало с законом (раздел 6 SPEC.md).
      alternative_calculation: {
        anchor: { event: 'appeal_ruling_date', offset_start: 1 },
        norm: 'п. 12 ПП ВС РФ от 22.06.2021 № 17',
        reason: 'Разъяснение Пленума исходит из редакции нормы до ФЗ № 135-ФЗ от 12.06.2024.',
        prefer: 'earliest',
        recommendation: 'Рекомендуем ориентироваться на более раннюю дату.',
      },
    },
  ],
};

// Редакция нормы по дате (ч. 3 ст. 1 ГПК): границы включительны, null = без границы.
function pickVersion(versions, dateISO) {
  return versions.find(
    (v) => (v.from == null || dateISO >= v.from) && (v.to == null || dateISO <= v.to),
  );
}

/**
 * Редакция ч. 1 ст. 376.1 ГПК, действующая на дату (для UI и подсказок).
 * @param {string|null} dateISO — дата подачи кассации или текущая дата.
 * @returns {object} версия из norm_versions; при null — последняя (действующая).
 */
export function cassationVersionFor(dateISO) {
  const versions = CASSATION_KSOYU.norm_versions;
  return dateISO == null ? versions[versions.length - 1] : pickVersion(versions, dateISO);
}

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
  // Дата события — дата принятия апелляционного определения (appeal_ruling_date);
  // событие считается разрешённым, как только она известна. Точка отсчёта
  // кассации (cassation_anchor) — дата изготовления мотивированного определения,
  // она может отсутствовать: тогда кассация не считается, но событие разрешено.
  if (appealFiled != null) {
    const ruling = toISO(inputs.appeal_ruling_date);
    const reasoned = toISO(inputs.appeal_ruling_reasoned_date);
    return {
      branch: 'appealed',
      resolved: ruling != null,
      date: ruling,
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

// Точка отсчёта кассационного срока для выбранной редакции.
function resolveCassationAnchor(version, inputs, entry) {
  if (version.anchor.event === 'appeal_ruling_reasoned') {
    // Новая редакция — от мотивированного апелляционного определения. Если дело
    // не обжаловалось, такого определения нет — считаем от вступления в силу.
    if (entry.branch === 'appealed') return toISO(inputs.appeal_ruling_reasoned_date);
    return entry.date;
  }
  // 'entry_into_force' — со дня вступления судебного постановления в силу.
  return entry.date;
}

// Расчёт по конкретной редакции (offset_start + месяцы + перенос выходного).
function cassationDeadline(anchorSpec, anchorDate) {
  return computeDeadline(
    {
      duration: CASSATION_KSOYU.duration,
      anchor: { offset_start: anchorSpec.offset_start },
      weekend_shift: CASSATION_KSOYU.weekend_shift,
    },
    anchorDate,
  );
}

// referenceDate — текущая дата (ISO) для выбора редакции, если не введена дата
// подачи кассационной жалобы.
function computeCassation(inputs, entry, referenceDate) {
  // condition: entry_into_force.resolved — пока событие не разрешено, не считаем.
  if (!entry.resolved) return null;

  // Выбор редакции — по дате подачи кассационной жалобы, иначе по текущей дате.
  const effectiveDate = toISO(inputs.cassation_filed_date) ?? referenceDate;
  if (effectiveDate == null) return null;
  const version = pickVersion(CASSATION_KSOYU.norm_versions, effectiveDate);
  if (version == null) return null;

  const anchor = resolveCassationAnchor(version, inputs, entry);
  // Нет точки отсчёта (напр. новая редакция при обжаловании без даты
  // мотивированного определения): событие разрешено, но срок ещё не считается.
  if (anchor == null) return null;

  const primary = cassationDeadline(version.anchor, anchor);

  const result = {
    title: CASSATION_KSOYU.title,
    anchor,
    offset_start: primary.offset_start,
    raw_deadline: primary.raw_deadline,
    deadline: primary.deadline,
    shifted: primary.shifted,
    version_id: version.id,
    effective_date: effectiveDate,
    logic: version.logic,
    norm: version.norm,
  };

  // alternative_calculation — только у редакции, где она задана (from_135fz), при
  // обжаловании и расхождении дат определения (п. 6 SPEC.md — конфликт норм).
  const altSpec = version.alternative_calculation;
  if (altSpec && entry.branch === 'appealed') {
    const ruling = toISO(inputs.appeal_ruling_date);
    const reasoned = toISO(inputs.appeal_ruling_reasoned_date);
    if (ruling != null && reasoned != null && reasoned > ruling) {
      const alt = cassationDeadline(altSpec.anchor, ruling);
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

  return result;
}

// --- Публичный расчёт цепочки -----------------------------------------------

/**
 * Расчёт цепочки: апелляция → вступление в силу → кассация.
 * @param {object} inputs — данные из п. 4.1 (reasoned_decision_date обязательна;
 *   appeal_filed_date, appeal_ruling_date, appeal_ruling_reasoned_date,
 *   cassation_filed_date — опционально).
 * @param {{today?: Date|string}} [options] — текущая дата для ветвей
 *   not_appealed/pending и для выбора редакции кассационной нормы, если не
 *   введена дата подачи кассации. Передаётся явно, из системных часов не берётся.
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
    norm: APPEAL_GENERAL.norm_versions[0].norm,
  };

  const entry = resolveEntryIntoForce(inputs, appeal.deadline, options.today);
  const cassation = computeCassation(inputs, entry, toISO(options.today));

  return {
    appeal,
    entry_into_force: { norm: ENTRY_INTO_FORCE_NORM, ...entry },
    cassation,
  };
}
