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
      // Конфликт с п. 12 ПП ВС РФ от 22.06.2021 № 17 существует только для этой редакции: до
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

// Копии кассационного узла для веток помимо общей цепочки: та же норма, та же
// механика и та же альтернатива по п. 12 ПП ВС РФ, но свой id (один id не может
// принадлежать двум ситуациям; .ics-реестр строится по экспортированным
// константам). Норма ст. 376.1 не различает порядок рассмотрения дела.
export const SIMPLIFIED_CASSATION_KSOYU = { ...CASSATION_KSOYU, id: 'simplified_cassation_ksoyu' };
export const DEFAULT_JUDGMENT_CASSATION_KSOYU = {
  ...CASSATION_KSOYU,
  id: 'default_judgment_cassation_ksoyu',
};

// --- Исчерпание способов обжалования (абз. 2 ч. 1 ст. 376, ч. 2 ст. 375.1) --
//
// Кассационная жалоба подаётся при условии, что иные способы обжалования
// исчерпаны до дня вступления постановления в законную силу. Применительно к
// решению суда первой инстанции «иные способы» — это апелляционное обжалование
// (п. 3 ПП ВС РФ от 22.06.2021 № 17, сверено дословно, см. раздел 9). Если решение не
// обжаловалось в апелляции, кассационная жалоба подлежит возврату без
// рассмотрения.
//
// Расчёт срока при этом остаётся: он верен для актов, не подлежащих
// апелляционному обжалованию, которые Пленум прямо называет в том же пункте.
const EXHAUSTION_WARNING = {
  code: 'appeal_not_exhausted',
  norm: 'абз. 2 ч. 1 ст. 376, ч. 2 ст. 375.1 ГПК РФ',
  clarification: 'п. 3 ПП ВС РФ от 22.06.2021 № 17',
  text:
    'Кассационная жалоба подаётся при условии, что иные способы обжалования ' +
    'исчерпаны до дня вступления постановления в законную силу. Для решения ' +
    'суда первой инстанции это апелляционное обжалование: если решение в ' +
    'апелляции не обжаловалось, кассационная жалоба подлежит возврату без ' +
    'рассмотрения.',
  calculation_note:
    'Срок рассчитан и верен для актов, которые не подлежат апелляционному ' +
    'обжалованию: судебный приказ, определение об утверждении мирового ' +
    'соглашения, определения по делам об оспаривании решений третейских судов.',
};

// Заочное решение, ветвь ответчика: до апелляции ответчик обязан обратиться с
// заявлением об отмене (ст. 237 ГПК в новой редакции). Позиция Верховного Суда
// (см. раздел 3.7 SPEC.md — сверено по цитирующей публикации, не по тексту
// определений). Текст для пользователя короткий, без реквизитов определений.
const DEFAULT_JUDGMENT_DEFENDANT_EXHAUSTION_WARNING = {
  code: 'appeal_not_exhausted',
  norm: 'абз. 2 ч. 1 ст. 376, ч. 2 ст. 375.1 ГПК РФ',
  text:
    'Кассационная жалоба ответчика на заочное решение подаётся при условии, ' +
    'что заявление об отмене (ст. 237 ГПК РФ) было подано и рассмотрено. Без ' +
    'этого жалоба подлежит возврату.',
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

// Кассационная жалоба в Судебную коллегию по гражданским делам ВС РФ (ст. 390.3).
// Те же две редакции ч. 1 ст. 390.3 (отсечка 01.09.2024, ФЗ № 135-ФЗ). ФЗ № 79-ФЗ
// от 09.04.2026 внёс только терминологическую правку («кассационным судом общей
// юрисдикции» → «судом кассационной инстанции») — расчёт не изменился, отдельной
// редакции не требует.
export const CASSATION_VS = {
  id: 'cassation_vs',
  title: 'Кассационная жалоба в Судебную коллегию ВС РФ',
  duration: { value: 3, unit: 'month' },
  condition: 'ksoyu_ruling_date', // узел доступен после определения КСОЮ
  weekend_shift: true,
  ics: true,
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ',
  norm_versions: [
    {
      id: 'before_135fz',
      from: null,
      to: '2024-08-31',
      anchor: { event: 'ksoyu_ruling', offset_start: 1 },
      logic: 'Три месяца со дня вынесения определения кассационного суда общей юрисдикции.',
      norm: {
        primary: 'ч. 1 ст. 390.3 ГПК РФ (в редакции до ФЗ № 135-ФЗ от 12.06.2024)',
        calculation: ['ч. 3 ст. 107', 'ч. 1, 2 ст. 108 ГПК РФ'],
      },
    },
    {
      id: 'from_135fz',
      from: '2024-09-01',
      to: null,
      anchor: { event: 'ksoyu_ruling_reasoned', offset_start: 1 },
      logic:
        'Три месяца со дня изготовления мотивированного определения кассационного ' +
        'суда общей юрисдикции.',
      norm: {
        primary:
          'ч. 1 ст. 390.3 ГПК РФ (ред. ФЗ № 135-ФЗ от 12.06.2024; ' +
          'ФЗ № 79-ФЗ от 09.04.2026 — терминологическая правка)',
        calculation: ['ч. 3 ст. 107', 'ч. 1, 2 ст. 108 ГПК РФ'],
      },
      alternative_calculation: {
        anchor: { event: 'ksoyu_ruling', offset_start: 1 },
        norm: 'п. 12 ПП ВС РФ от 22.06.2021 № 17',
        reason:
          'П. 12 ПП ВС РФ от 22.06.2021 № 17 исходит из того, что отложение изготовления ' +
          'мотивированного определения на исчисление срока не влияет (отсчёт от ' +
          'даты вынесения).',
        prefer: 'earliest',
        recommendation: 'Рекомендуем ориентироваться на более раннюю дату.',
      },
    },
  ],
};

/**
 * Редакция ч. 1 ст. 390.3 ГПК, действующая на дату (для UI и подсказок).
 * @param {string|null} dateISO — дата подачи жалобы в ВС или текущая дата.
 * @returns {object} версия из norm_versions; при null — последняя (действующая).
 */
export function vsCassationVersionFor(dateISO) {
  const versions = CASSATION_VS.norm_versions;
  return dateISO == null ? versions[versions.length - 1] : pickVersion(versions, dateISO);
}

// Предъявление исполнительного листа к исполнению (ст. 21 ФЗ № 229-ФЗ).
// Единица — год (ч. 1 ст. 108 ГПК). Редакций не заводим — норма в этой части не
// менялась (одна версия). Точка отсчёта — дата вступления решения в силу.
export const ENFORCEMENT_PRESENTATION = {
  id: 'enforcement_presentation',
  title: 'Предъявление исполнительного листа к исполнению',
  duration: { value: 3, unit: 'year' },
  anchor: { event: 'entry_into_force', offset_start: 1 },
  condition: 'entry_into_force.resolved',
  weekend_shift: true,
  ics: true,
  logic:
    'Три года со дня вступления судебного акта в законную силу. Срок прерывается ' +
    'предъявлением исполнительного листа к исполнению и частичным исполнением; ' +
    'после перерыва течение возобновляется, истёкшее время в новый срок не ' +
    'засчитывается (ст. 22 ФЗ № 229-ФЗ, ст. 432 ГПК).',
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ',
  norm_versions: [
    {
      id: 'current',
      from: null,
      to: null,
      anchor: { event: 'entry_into_force', offset_start: 1 },
      norm: {
        primary: 'ч. 1 ст. 21 ФЗ от 02.10.2007 № 229-ФЗ',
        calculation: ['ч. 1, 2 ст. 108 ГПК РФ'],
      },
    },
  ],
};

// Копии узла предъявления ИЛ для веток помимо общей цепочки: та же норма и та же
// механика (три года со дня вступления в силу, ч. 1 ст. 21 ФЗ № 229-ФЗ —
// безотносительно порядка рассмотрения дела), но свой id: один id не может
// принадлежать двум ситуациям (см. situations.js), и .ics-реестр (TERM_REGISTRY)
// собирается по экспортированным константам, поэтому их две.
export const SIMPLIFIED_ENFORCEMENT_PRESENTATION = {
  ...ENFORCEMENT_PRESENTATION,
  id: 'simplified_enforcement_presentation',
};
export const DEFAULT_JUDGMENT_ENFORCEMENT_PRESENTATION = {
  ...ENFORCEMENT_PRESENTATION,
  id: 'default_judgment_enforcement_presentation',
};

// Срок предъявления ИЛ — condition: узел появляется только когда вступление в
// силу разрешено (resolved); в ветви pending его нет. term — узел ветки (общий
// ENFORCEMENT_PRESENTATION либо его копия с иным id).
function computeEnforcement(entry, term = ENFORCEMENT_PRESENTATION) {
  if (!entry.resolved || entry.date == null) return null;
  const calc = computeDeadline(term, entry.date);
  return {
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
  };
}

// --- Сроки в рабочих днях (абз. 2 ч. 3 ст. 107 ГПК) -------------------------
//
// weekend_shift у этих сроков НЕ выставляется: последний день рабочий по
// построению, повторный перенос по ч. 2 ст. 108 сдвинул бы дату лишний раз.

export const PROTOCOL_REMARKS = {
  id: 'protocol_remarks',
  title: 'Замечания на протокол судебного заседания',
  duration: { value: 5, unit: 'working_day' },
  anchor: { event: 'protocol_signed_date', offset_start: 1 },
  condition: 'protocol_signed_date',
  ics: true,
  logic:
    'Пять дней со дня подписания протокола. Срок исчисляется днями — нерабочие ' +
    'дни не включаются (абз. 2 ч. 3 ст. 107 ГПК РФ); течение начинается со дня, ' +
    'следующего за подписанием, а если он нерабочий — с первого рабочего дня.',
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ',
  norm_versions: [
    {
      id: 'current',
      from: null,
      to: null,
      anchor: { event: 'protocol_signed_date', offset_start: 1 },
      norm: {
        primary: 'ч. 1 ст. 231 ГПК РФ',
        calculation: ['ч. 3 ст. 107 (абз. 2) ГПК РФ'],
      },
    },
  ],
};

export const PROTOCOL_REMARKS_REVIEW = {
  id: 'protocol_remarks_review',
  title: 'Рассмотрение замечаний судьёй',
  duration: { value: 5, unit: 'working_day' },
  anchor: { event: 'protocol_remarks_filed_date', offset_start: 1 },
  condition: 'protocol_signed_date',
  informational: true, // срок суда, не сторона его соблюдает
  ics: false,
  logic:
    'Пять дней со дня подачи замечаний. Срок исчисляется днями — нерабочие дни ' +
    'не включаются (абз. 2 ч. 3 ст. 107 ГПК РФ).',
  midnight_rule: null,
  norm_versions: [
    {
      id: 'current',
      from: null,
      to: null,
      anchor: { event: 'protocol_remarks_filed_date', offset_start: 1 },
      norm: {
        primary: 'ч. 2 ст. 232 ГПК РФ',
        calculation: ['ч. 3 ст. 107 (абз. 2) ГПК РФ'],
      },
    },
  ],
};

export const PRIVATE_COMPLAINT = {
  id: 'private_complaint',
  title: 'Частная жалоба на определение суда первой инстанции',
  duration: { value: 15, unit: 'working_day' },
  anchor: { event: 'interim_ruling_date', offset_start: 1 },
  condition: 'interim_ruling_date',
  ics: true,
  logic:
    'Пятнадцать дней со дня вынесения определения судом первой инстанции. Срок ' +
    'исчисляется днями — нерабочие дни не включаются (абз. 2 ч. 3 ст. 107 ГПК ' +
    'РФ); течение начинается со дня, следующего за вынесением, а если он ' +
    'нерабочий — с первого рабочего дня.',
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ — сдача на почту до 24:00 последнего дня',
  norm_versions: [
    {
      id: 'current',
      from: null,
      to: null,
      anchor: { event: 'interim_ruling_date', offset_start: 1 },
      norm: {
        primary: 'ст. 332 ГПК РФ',
        calculation: ['ч. 3 ст. 107 (абз. 2) ГПК РФ'],
      },
    },
  ],
};

// Расчёт одноредакционного срока от даты-якоря; null, если якоря нет.
function computeSimpleTerm(term, anchorDate, overrides = null) {
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
    // от входных данных (3/15 рабочих дней по явке, ч. 4 ст. 199). Нужна для
    // правил напоминаний .ics.
    duration: term.duration,
  };
  if (calc.first_working_day) result.first_working_day = calc.first_working_day;
  // overrides — для сроков, у которых норма и логика зависят не от редакции, а
  // от субъекта обжалования (заочное решение, ч. 2 ст. 237).
  return overrides ? { ...result, ...overrides } : result;
}

/**
 * Независимые сроки в рабочих днях: не зависят от цепочки обжалования, каждый
 * считается по своему input (замечания на протокол, частная жалоба). Поэтому
 * доступны и без даты мотивированного решения.
 * @param {object} inputs
 * @returns {{protocol_remarks:object|null, protocol_remarks_review:object|null, private_complaint:object|null}}
 */
export function computeIndependentTerms(inputs) {
  const { remarks, review } = computeProtocolRemarks(inputs ?? {});
  return {
    protocol_remarks: remarks,
    protocol_remarks_review: review,
    private_complaint: computeSimpleTerm(PRIVATE_COMPLAINT, inputs?.interim_ruling_date),
    supervision: computeSimpleTerm(SUPERVISION, inputs?.vs_ruling_date),
  };
}

// Надзорная жалоба в Президиум ВС РФ (глава 41.1 ГПК).
//
// Три месяца со дня вступления обжалуемых постановлений в законную силу
// (ч. 2 ст. 391.2). Редакций у этой части нет — одна версия.
//
// Точка отсчёта — дата ВЫНЕСЕНИЯ определения Судебной коллегии ВС: по
// ст. 390.17 оно вступает в законную силу со дня вынесения, поэтому отложение
// составления мотивированного определения на срок надзора не влияет. Этим
// надзор отличается от кассации в ВС (ст. 390.3), где действующая редакция
// считает срок от изготовления мотивированного определения КСОЮ.
//
// condition: узел появляется только после ввода даты определения коллегии —
// в Президиум ВС обжалуются именно определения Судебной коллегии по
// гражданским делам ВС, вынесенные в кассационном порядке (п. 6 ч. 2 ст. 391.1).
export const SUPERVISION = {
  id: 'supervision',
  title: 'Надзорная жалоба в Президиум ВС РФ',
  duration: { value: 3, unit: 'month' },
  anchor: { event: 'vs_ruling_date', offset_start: 1 },
  condition: 'vs_ruling_date',
  weekend_shift: true,
  ics: true,
  logic:
    'Три месяца со дня вступления обжалуемых судебных постановлений в законную ' +
    'силу (ч. 2 ст. 391.2 ГПК РФ). Определение Судебной коллегии ВС вступает в ' +
    'силу со дня его вынесения (ст. 390.17 ГПК РФ), поэтому отсчёт идёт от даты ' +
    'вынесения, а отложение составления мотивированного определения на срок не ' +
    'влияет. Этим надзорный срок отличается от кассационного срока в ВС ' +
    '(ч. 1 ст. 390.3 в редакции с 01.09.2024), который считается со дня ' +
    'изготовления мотивированного определения КСОЮ.',
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ — сдача на почту до 24:00 последнего дня',
  norm_versions: [
    {
      id: 'current',
      from: null,
      to: null,
      anchor: { event: 'vs_ruling_date', offset_start: 1 },
      norm: {
        primary: 'ч. 2 ст. 391.2 ГПК РФ',
        calculation: ['ч. 3 ст. 107', 'ч. 1, 2 ст. 108 ГПК РФ'],
        clarification: 'ст. 390.17 ГПК РФ (вступление в силу со дня вынесения)',
      },
    },
  ],
};

// Замечания на протокол (ч. 1 ст. 231) + рассмотрение судьёй (ч. 2 ст. 232).
// Рассмотрение считается от фактической даты подачи замечаний, если она введена;
// иначе — от последнего дня срока подачи (худший случай), это помечается.
function computeProtocolRemarks(inputs) {
  const remarks = computeSimpleTerm(PROTOCOL_REMARKS, inputs.protocol_signed_date);
  if (remarks == null) return { remarks: null, review: null };

  const filed = toISO(inputs.protocol_remarks_filed_date);
  const reviewAnchor = filed ?? remarks.deadline;
  const review = computeSimpleTerm(PROTOCOL_REMARKS_REVIEW, reviewAnchor);
  if (review != null) {
    review.anchor_is_assumed = filed == null;
    if (filed == null) {
      review.anchor_note =
        'Дата подачи замечаний не указана — срок рассмотрения показан от ' +
        'последнего дня срока подачи.';
    }
  }
  return { remarks, review };
}

// --- Упрощённое производство (глава 21.1 ГПК) -------------------------------
//
// Все сроки в днях — рабочие: п. 16 ПП ВС РФ от 22.06.2021 № 16 относит правило абз. 2 ч. 3
// ст. 107 к срокам апелляционного обжалования, п. 17 прямо называет
// пятнадцатидневный срок по делам упрощённого производства (сверено дословно,
// см. раздел 9 SPEC.md). weekend_shift не применяется — см. 3.1.
//
// Вступление в силу здесь — своё, по ст. 232.4, а не общее по ч. 1 ст. 209.

const SIMPLIFIED_CALC_NORMS = ['ч. 3 ст. 107 (абз. 2) ГПК РФ', 'п. 16, 17 ПП ВС РФ от 22.06.2021 № 16'];

export const SIMPLIFIED_REASONED_REQUEST = {
  id: 'simplified_reasoned_request',
  title: 'Заявление о составлении мотивированного решения',
  duration: { value: 5, unit: 'working_day' },
  anchor: { event: 'simplified_resolution_date', offset_start: 1 },
  condition: 'simplified_resolution_date',
  ics: true,
  logic:
    'Пять дней со дня подписания резолютивной части решения. Срок в рабочих ' +
    'днях (абз. 2 ч. 3 ст. 107 ГПК РФ, п. 16–17 ПП ВС РФ от 22.06.2021 № 16).',
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ',
  norm_versions: [
    {
      id: 'current',
      from: null,
      to: null,
      anchor: { event: 'simplified_resolution_date', offset_start: 1 },
      norm: { primary: 'ч. 3 ст. 232.4 ГПК РФ', calculation: SIMPLIFIED_CALC_NORMS },
    },
  ],
};

export const SIMPLIFIED_REASONED_MAKING = {
  id: 'simplified_reasoned_making',
  title: 'Изготовление мотивированного решения судом',
  duration: { value: 10, unit: 'working_day' },
  anchor: { event: 'simplified_reasoned_trigger', offset_start: 1 },
  informational: true, // срок суда, справочно
  ics: false,
  logic:
    'Десять дней со дня поступления заявления о составлении мотивированного ' +
    'решения либо со дня подачи апелляционной жалобы. Срок в рабочих днях.',
  midnight_rule: null,
  norm_versions: [
    {
      id: 'current',
      from: null,
      to: null,
      anchor: { event: 'simplified_reasoned_trigger', offset_start: 1 },
      norm: { primary: 'ч. 4 ст. 232.4 ГПК РФ', calculation: SIMPLIFIED_CALC_NORMS },
    },
  ],
};

export const SIMPLIFIED_APPEAL = {
  id: 'simplified_appeal',
  title: 'Апелляционная жалоба (упрощённое производство)',
  duration: { value: 15, unit: 'working_day' },
  anchor: { event: 'simplified_resolution_date', offset_start: 1 },
  condition: 'simplified_resolution_date',
  ics: true,
  logic:
    'Пятнадцать дней со дня принятия решения, а при составлении мотивированного ' +
    'решения — со дня принятия решения в окончательной форме. Срок в рабочих ' +
    'днях (п. 17 ПП ВС РФ от 22.06.2021 № 16).',
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ — сдача на почту до 24:00 последнего дня',
  norm_versions: [
    {
      id: 'current',
      from: null,
      to: null,
      anchor: { event: 'simplified_resolution_date', offset_start: 1 },
      norm: { primary: 'ч. 8 ст. 232.4 ГПК РФ', calculation: SIMPLIFIED_CALC_NORMS },
    },
  ],
};

const SIMPLIFIED_ENTRY_NORM = 'ст. 232.4 ГПК РФ';

// Событие вступления в силу по ст. 232.4 — три ветви (ч. 5, 6, 7).
// От текущей даты не зависит: ветвь определяется введёнными фактами.
function resolveSimplifiedEntry(appealFiled, reasoned, appealDeadline, appealRuling) {
  // ч. 7: подана апелляционная жалоба — со дня принятия определения
  // апелляционной инстанцией. Дата известна → событие разрешено; не введена →
  // показываем норму и чего не хватает, а не выдуманную дату.
  if (appealFiled != null) {
    const base = {
      branch: 'appealed',
      part: 'ч. 7 ст. 232.4 ГПК РФ',
      logic:
        'Апелляционная жалоба подана — решение вступает в силу со дня принятия ' +
        'определения судом апелляционной инстанции.',
    };
    if (appealRuling != null) {
      return { ...base, resolved: true, date: appealRuling };
    }
    return {
      ...base,
      resolved: false,
      date: null,
      message: 'Вступит в силу со дня принятия определения судом апелляционной инстанции',
      missing_inputs: ['simplified_appeal_ruling_date'],
      note: 'Укажите дату определения апелляционной инстанции — тогда дата будет рассчитана.',
    };
  }

  const date = toISO(addDays(appealDeadline, 1)); // по истечении срока обжалования

  // ч. 6: составлено мотивированное решение — по истечении срока по ч. 8
  // (пятнадцать рабочих дней со дня принятия решения в окончательной форме).
  if (reasoned != null) {
    return {
      branch: 'reasoned',
      part: 'ч. 6 ст. 232.4 ГПК РФ',
      resolved: true,
      date,
      logic:
        'Составлено мотивированное решение — вступает в силу по истечении срока ' +
        'апелляционного обжалования по ч. 8 ст. 232.4 (пятнадцать рабочих дней ' +
        'со дня принятия решения в окончательной форме).',
    };
  }

  // ч. 5: жалоба не подана — по истечении пятнадцати дней со дня принятия.
  return {
    branch: 'not_appealed',
    part: 'ч. 5 ст. 232.4 ГПК РФ',
    resolved: true,
    date,
    logic:
      'Жалоба не подана и мотивированное решение не составлялось — вступает в ' +
      'силу по истечении пятнадцати дней со дня принятия решения.',
  };
}

/**
 * Упрощённое производство (глава 21.1 ГПК). Независимая ветка: считается по
 * своим inputs, от цепочки общего порядка не зависит.
 * @param {object} inputs
 * @param {string|null} referenceDate — текущая дата (ISO) для выбора редакции
 *   кассационной нормы, если не введена дата подачи кассационной жалобы.
 * @returns {object|null} null, если не введена дата резолютивной части.
 */
export function computeSimplified(inputs, referenceDate = null) {
  const resolution = toISO(inputs?.simplified_resolution_date);
  if (resolution == null) return null;

  const reasonedRequest = toISO(inputs.simplified_reasoned_request_date);
  const reasoned = toISO(inputs.simplified_reasoned_date);
  const appealFiled = toISO(inputs.simplified_appeal_filed_date);

  // ч. 3 ст. 232.4 — 5 рабочих дней на заявление о мотивированном решении.
  const request = computeSimpleTerm(SIMPLIFIED_REASONED_REQUEST, resolution);

  // ч. 4 ст. 232.4 — 10 рабочих дней на изготовление, от поступления заявления
  // либо от подачи апелляционной жалобы; при обоих фактах — от более раннего.
  const triggers = [];
  if (reasonedRequest != null) triggers.push({ kind: 'request', date: reasonedRequest });
  if (appealFiled != null) triggers.push({ kind: 'appeal_filed', date: appealFiled });
  triggers.sort((a, b) => (a.date < b.date ? -1 : 1));
  const making = triggers.length
    ? computeSimpleTerm(SIMPLIFIED_REASONED_MAKING, triggers[0].date)
    : null;
  if (making) making.trigger = triggers[0].kind;

  // ч. 8 ст. 232.4 — 15 рабочих дней; при составлении мотивированного решения
  // точка отсчёта смещается на день принятия в окончательной форме.
  const appeal = computeSimpleTerm(SIMPLIFIED_APPEAL, reasoned ?? resolution);
  appeal.anchor_kind = reasoned != null ? 'reasoned' : 'resolution';

  const appealRuling = toISO(inputs.simplified_appeal_ruling_date);
  const entry = resolveSimplifiedEntry(appealFiled, reasoned, appeal.deadline, appealRuling);

  // Предъявление ИЛ — три года со дня вступления решения в силу (ч. 1 ст. 21
  // ФЗ № 229-ФЗ). Норма не различает порядок рассмотрения, поэтому узел тот же,
  // что в общей цепочке, привязанный к событию ст. 232.4 (все три ветви).
  const enforcement = computeEnforcement(entry, SIMPLIFIED_ENFORCEMENT_PRESENTATION);

  // Кассация в КСОЮ (ст. 376.1). Исчерпание способов обжалования (3.7)
  // применяется как в общей цепочке — упрощённое решение обжалуется в апелляцию
  // по ч. 8 ст. 232.4.
  const cassation = computeCassationTerm(
    SIMPLIFIED_CASSATION_KSOYU,
    inputs,
    entry,
    'simplified',
    referenceDate,
    { exhaustion: generalExhaustion },
  );

  return {
    reasoned_request: request,
    reasoned_making: making,
    appeal,
    entry_into_force: { norm: SIMPLIFIED_ENTRY_NORM, ...entry },
    enforcement,
    cassation,
  };
}

// --- Заочное решение (ст. 237 ГПК) ------------------------------------------
//
// Семидневный срок на заявление об отмене — в рабочих днях (абз. 2 ч. 3
// ст. 107). Апелляционные сроки — месячные. Точка отсчёта апелляции зависит от
// субъекта (ответчик / иные лица) и от того, подавал ли ответчик заявление.
//
// Вступление в силу — своё событие по ч. 1 ст. 244 с тремя ветвями. Общее
// правило ч. 1 ст. 209 к заочному решению не применяется.

export const DEFAULT_JUDGMENT_SUBJECTS = ['defendant', 'other_persons'];

const DEFAULT_JUDGMENT_CANCELLED_NOTE =
  'Если заявление об отмене удовлетворено, заочное решение отменяется и ' +
  'производство по делу возобновляется — срока апелляционного обжалования не ' +
  'возникает.';

// Основание, по которому при удовлетворении заявления срок не исчисляется
// вовсе. Ч. 2 ст. 237 отсчитывает месяц от определения об ОТКАЗЕ в
// удовлетворении заявления: при удовлетворении такого определения нет, а само
// заочное решение отменено.
const DEFAULT_JUDGMENT_CANCELLED_REASON =
  'Ч. 2 ст. 237 отсчитывает месячный срок от определения об отказе в ' +
  'удовлетворении заявления об отмене. При удовлетворении заявления такого ' +
  'определения нет: заочное решение отменено, рассмотрение дела возобновляется ' +
  'по существу (ч. 1 ст. 241 ГПК РФ) — срока апелляционного обжалования ' +
  'заочного решения не возникает.';

export const DEFAULT_JUDGMENT_CANCELLATION_REQUEST = {
  id: 'default_judgment_cancellation_request',
  title: 'Заявление об отмене заочного решения',
  duration: { value: 7, unit: 'working_day' },
  anchor: { event: 'default_judgment_service_date', offset_start: 1 },
  condition: 'default_judgment_service_date',
  ics: true,
  logic:
    'Семь дней со дня вручения ответчику копии заочного решения. Срок ' +
    'исчисляется днями — нерабочие дни не включаются (абз. 2 ч. 3 ст. 107 ГПК РФ). ' +
    DEFAULT_JUDGMENT_CANCELLED_NOTE,
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ',
  norm_versions: [
    {
      id: 'current',
      from: null,
      to: null,
      anchor: { event: 'default_judgment_service_date', offset_start: 1 },
      norm: {
        primary: 'ч. 1 ст. 237 ГПК РФ',
        calculation: ['ч. 3 ст. 107 (абз. 2) ГПК РФ'],
      },
    },
  ],
};

// Один срок с двумя наборами нормы/логики — по субъекту обжалования.
export const DEFAULT_JUDGMENT_APPEAL = {
  id: 'default_judgment_appeal',
  title: 'Апелляционная жалоба (заочное решение)',
  duration: { value: 1, unit: 'month' },
  anchor: { offset_start: 1 },
  weekend_shift: true,
  ics: true,
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ — сдача на почту до 24:00 последнего дня',
  norm_versions: [
    {
      id: 'current',
      from: null,
      to: null,
      anchor: { offset_start: 1 },
      norm: { primary: 'ч. 2 ст. 237 ГПК РФ', calculation: ['ч. 1, 2 ст. 108 ГПК РФ'] },
    },
  ],
};

const DEFAULT_JUDGMENT_APPEAL_MODES = {
  // Ответчик: месяц со дня вынесения определения об отказе в удовлетворении
  // заявления об отмене.
  defendant: {
    anchor_kind: 'refusal',
    norm: {
      primary: 'абз. 1 ч. 2 ст. 237 ГПК РФ',
      calculation: ['ч. 3 ст. 107', 'ч. 1, 2 ст. 108 ГПК РФ'],
    },
    logic:
      'Месяц со дня вынесения определения об отказе в удовлетворении заявления ' +
      'об отмене заочного решения. ' + DEFAULT_JUDGMENT_CANCELLED_NOTE,
  },
  // Иные лица, заявление ответчиком не подавалось: месяц по истечении срока
  // подачи заявления об отмене.
  other_persons_no_request: {
    anchor_kind: 'request_deadline',
    norm: {
      primary: 'абз. 2 ч. 2 ст. 237 ГПК РФ',
      calculation: ['ч. 3 ст. 107', 'ч. 1, 2 ст. 108 ГПК РФ'],
    },
    logic:
      'Месяц по истечении срока подачи ответчиком заявления об отмене заочного ' +
      'решения (семь рабочих дней со дня вручения копии).',
  },
  // Иные лица, заявление подано: месяц со дня определения об отказе.
  other_persons_after_request: {
    anchor_kind: 'refusal',
    norm: {
      primary: 'абз. 2 ч. 2 ст. 237 ГПК РФ',
      calculation: ['ч. 3 ст. 107', 'ч. 1, 2 ст. 108 ГПК РФ'],
    },
    logic:
      'Ответчик подал заявление об отмене — месяц со дня вынесения определения ' +
      'об отказе в его удовлетворении. ' + DEFAULT_JUDGMENT_CANCELLED_NOTE,
  },
};

export const DEFAULT_JUDGMENT_ENTRY_NORM = 'ч. 1 ст. 244 ГПК РФ';

// Событие вступления заочного решения в силу — ч. 1 ст. 244, три ветви. От
// текущей даты не зависит: ветвь определяется введёнными фактами.
//
// Отдельным состоянием стоит удовлетворение заявления об отмене: решение
// отменяется, рассмотрение дела возобновляется — вступления в силу не
// наступает, считать нечего.
function resolveDefaultJudgmentEntry(facts) {
  const { cancelled, appealFiled, appealRuling, requestFiled, refusal, appealDeadline } = facts;

  if (cancelled != null) {
    return {
      branch: 'cancellation_granted',
      resolved: false,
      applicable: false,
      date: null,
      message: 'Не наступает — заочное решение отменено',
      logic:
        'Заявление об отмене заочного решения удовлетворено, решение отменено и ' +
        'рассмотрение дела по существу возобновляется. Правило ч. 1 ст. 244 о ' +
        'вступлении заочного решения в законную силу к отменённому решению не ' +
        'применяется — даты вступления в силу не возникает.',
    };
  }

  // Ветвь 3: решение обжаловано в апелляции — вступает в силу после
  // рассмотрения жалобы судом апелляционной инстанции, если не отменено.
  // Дата известна → событие разрешено; не введена → показываем норму и правило
  // без даты (как в ч. 7 ст. 232.4), а не выдуманную дату.
  if (appealFiled != null) {
    const base = {
      branch: 'appealed',
      applicable: true,
      logic:
        'Заочное решение обжаловано в апелляционном порядке — вступает в законную ' +
        'силу после рассмотрения жалобы судом апелляционной инстанции, если оно не ' +
        'отменено. Если апелляционная инстанция решение отменит, вступления в силу ' +
        'не наступит.',
    };
    if (appealRuling != null) return { ...base, resolved: true, date: appealRuling };
    return {
      ...base,
      resolved: false,
      date: null,
      message: 'Вступит в силу после рассмотрения апелляционной жалобы, если не будет отменено',
      missing_inputs: ['default_judgment_appeal_ruling_date'],
      note: 'Укажите дату определения апелляционной инстанции — тогда дата будет рассчитана.',
    };
  }

  // Ветви 1 и 2 дают одну и ту же дату — по истечении срока обжалования по
  // ч. 2 ст. 237. Различаются составом фактов и точкой отсчёта самого срока,
  // которая уже учтена в нём (для ответчика и для иных лиц она разная).
  const base =
    requestFiled != null || refusal != null
      ? {
          branch: 'refused_not_appealed',
          applicable: true,
          logic:
            'Заявление об отмене заочного решения подано, в его удовлетворении ' +
            'отказано, апелляционная жалоба не подавалась — решение вступает в ' +
            'законную силу по истечении срока апелляционного обжалования.',
        }
      : {
          branch: 'not_appealed',
          applicable: true,
          logic:
            'Заочное решение не обжаловано — вступает в законную силу по истечении ' +
            'срока обжалования, предусмотренного ч. 2 ст. 237 ГПК РФ.',
        };

  // Срока может не быть: для ответчика он считается от определения об отказе
  // (абз. 1 ч. 2 ст. 237), и без этой даты рассчитать его не от чего.
  if (appealDeadline == null) {
    return {
      ...base,
      resolved: false,
      date: null,
      message: 'Вступит в силу по истечении срока апелляционного обжалования',
      missing_inputs: ['default_judgment_refusal_date'],
      note:
        'Срок обжалования по абз. 1 ч. 2 ст. 237 считается со дня определения об ' +
        'отказе в отмене заочного решения — нужна его дата.',
    };
  }

  return { ...base, resolved: true, date: toISO(addDays(appealDeadline, 1)) };
}

/**
 * Заочное решение (ст. 237 ГПК). Независимая ветка по своим inputs.
 * @param {object} inputs
 * @param {string|null} referenceDate — текущая дата (ISO) для выбора редакции
 *   кассационной нормы, если не введена дата подачи кассационной жалобы.
 * @returns {object|null} null, если не введена дата вручения копии решения.
 */
export function computeDefaultJudgment(inputs, referenceDate = null) {
  const service = toISO(inputs?.default_judgment_service_date);
  if (service == null) return null;

  const requestFiled = toISO(inputs.default_judgment_cancellation_request_date);
  const refusal = toISO(inputs.default_judgment_refusal_date);
  const cancelled = toISO(inputs.default_judgment_cancellation_date);
  const subject = DEFAULT_JUDGMENT_SUBJECTS.includes(inputs.default_judgment_subject)
    ? inputs.default_judgment_subject
    : 'defendant'; // по умолчанию — ответчик (ч. 1 ст. 237)

  // ч. 1 ст. 237 — 7 рабочих дней на заявление об отмене (срок ответчика).
  const request = computeSimpleTerm(DEFAULT_JUDGMENT_CANCELLATION_REQUEST, service);

  // Какой режим апелляции применим и какая дата нужна.
  let modeKey;
  if (subject === 'defendant') modeKey = 'defendant';
  else modeKey = requestFiled != null ? 'other_persons_after_request' : 'other_persons_no_request';
  const mode = DEFAULT_JUDGMENT_APPEAL_MODES[modeKey];

  let appeal = null;
  let appealBlocked = null;
  let appealNotApplicable = null;
  if (cancelled != null) {
    // Заявление об отмене удовлетворено — срока апелляционного обжалования
    // заочного решения не возникает, и это не «не хватает данных», а отсутствие
    // самого срока. Дату не показываем.
    appealNotApplicable = {
      norm: mode.norm.primary,
      message: 'Не исчисляется — заочное решение отменено',
      reason: DEFAULT_JUDGMENT_CANCELLED_REASON,
    };
  } else if (mode.anchor_kind === 'refusal') {
    if (refusal != null) {
      appeal = computeSimpleTerm(DEFAULT_JUDGMENT_APPEAL, refusal, {
        norm: mode.norm,
        logic: mode.logic,
        anchor_kind: mode.anchor_kind,
        subject,
      });
    } else {
      appealBlocked = {
        reason:
          'Срок считается со дня вынесения определения об отказе в удовлетворении ' +
          'заявления об отмене заочного решения — нужна его дата.',
        missing: ['default_judgment_refusal_date'],
        norm: mode.norm.primary,
      };
    }
  } else {
    // request_deadline: месяц по истечении срока подачи заявления об отмене.
    appeal = computeSimpleTerm(DEFAULT_JUDGMENT_APPEAL, request.deadline, {
      norm: mode.norm,
      logic: mode.logic,
      anchor_kind: mode.anchor_kind,
      subject,
    });
  }

  const entry = resolveDefaultJudgmentEntry({
    cancelled,
    appealFiled: toISO(inputs.default_judgment_appeal_filed_date),
    appealRuling: toISO(inputs.default_judgment_appeal_ruling_date),
    requestFiled,
    refusal,
    appealDeadline: appeal ? appeal.deadline : null,
  });

  // Предъявление ИЛ — три года со дня вступления заочного решения в силу
  // (ч. 1 ст. 21 ФЗ № 229-ФЗ). Привязано к событию ч. 1 ст. 244; в состоянии
  // cancellation_granted вступления в силу не наступает (entry.resolved === false),
  // и computeEnforcement возвращает null — узла нет.
  const enforcement = computeEnforcement(entry, DEFAULT_JUDGMENT_ENFORCEMENT_PRESENTATION);

  // Кассация в КСОЮ (ст. 376.1). Условие исчерпания у заочного зависит от
  // субъекта: у ответчика нужно ещё и рассмотренное заявление об отмене
  // (ст. 237, позиция ВС РФ), у иных лиц — как в общем порядке (3.7).
  const cassation = computeCassationTerm(
    DEFAULT_JUDGMENT_CASSATION_KSOYU,
    inputs,
    entry,
    'default_judgment',
    referenceDate,
    { exhaustion: defaultJudgmentExhaustion(subject, refusal != null) },
  );

  return {
    subject,
    cancellation_request: request,
    appeal,
    appeal_blocked: appealBlocked,
    appeal_not_applicable: appealNotApplicable,
    entry_into_force: { norm: DEFAULT_JUDGMENT_ENTRY_NORM, ...entry },
    enforcement,
    cassation,
  };
}

// --- Мировой судья без мотивированного решения (ч. 3–5 ст. 199 ГПК) ---------
//
// Мировой судья вправе не составлять мотивированное решение (ч. 3 ст. 199).
// Сроки на заявление — в рабочих днях; длительность зависит от того,
// присутствовал ли участник в заседании (ч. 4 ст. 199).

export const MIROVOY_ATTENDANCE_VALUES = ['present', 'absent'];

const MIROVOY_NO_REASONED_NOTE =
  'Мировой судья вправе не составлять мотивированное решение (ч. 3 ст. 199 ГПК РФ). ' +
  'Если заявление о его составлении не подавалось, апелляционный срок считается ' +
  'от даты объявления резолютивной части.';

export const MIROVOY_REASONED_REQUEST = {
  id: 'mirovoy_reasoned_request',
  title: 'Заявление о составлении мотивированного решения (мировой судья)',
  duration: { value: 3, unit: 'working_day' }, // переопределяется по явке
  anchor: { event: 'mirovoy_resolution_date', offset_start: 1 },
  condition: 'mirovoy_resolution_date',
  ics: true,
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ',
  norm_versions: [
    {
      id: 'current',
      from: null,
      to: null,
      anchor: { event: 'mirovoy_resolution_date', offset_start: 1 },
      norm: { primary: 'ч. 4 ст. 199 ГПК РФ', calculation: ['ч. 3 ст. 107 (абз. 2) ГПК РФ'] },
    },
  ],
};

// Длительность и норма зависят от явки участника в заседание (ч. 4 ст. 199).
const MIROVOY_REQUEST_MODES = {
  present: {
    days: 3,
    norm: {
      primary: 'п. 1 ч. 4 ст. 199 ГПК РФ',
      calculation: ['ч. 3 ст. 107 (абз. 2) ГПК РФ'],
    },
    logic:
      'Три дня со дня объявления резолютивной части решения — участник ' +
      'присутствовал в судебном заседании. Срок в рабочих днях (абз. 2 ч. 3 ' +
      'ст. 107 ГПК РФ). ' + MIROVOY_NO_REASONED_NOTE,
  },
  absent: {
    days: 15,
    norm: {
      primary: 'п. 2 ч. 4 ст. 199 ГПК РФ',
      calculation: ['ч. 3 ст. 107 (абз. 2) ГПК РФ'],
    },
    logic:
      'Пятнадцать дней со дня объявления резолютивной части решения — участник ' +
      'в судебном заседании не присутствовал. Срок в рабочих днях (абз. 2 ч. 3 ' +
      'ст. 107 ГПК РФ). ' + MIROVOY_NO_REASONED_NOTE,
  },
};

export const MIROVOY_REASONED_MAKING = {
  id: 'mirovoy_reasoned_making',
  title: 'Составление мотивированного решения мировым судьёй',
  duration: { value: 10, unit: 'working_day' },
  anchor: { event: 'mirovoy_request_date', offset_start: 1 },
  informational: true, // срок суда, справочно
  ics: false,
  logic:
    'Десять дней со дня поступления заявления о составлении мотивированного ' +
    'решения. Срок в рабочих днях.',
  midnight_rule: null,
  norm_versions: [
    {
      id: 'current',
      from: null,
      to: null,
      anchor: { event: 'mirovoy_request_date', offset_start: 1 },
      norm: { primary: 'ч. 5 ст. 199 ГПК РФ', calculation: ['ч. 3 ст. 107 (абз. 2) ГПК РФ'] },
    },
  ],
};

export const MIROVOY_APPEAL = {
  id: 'mirovoy_appeal',
  title: 'Апелляционная жалоба на решение мирового судьи',
  duration: { value: 1, unit: 'month' },
  anchor: { offset_start: 1 },
  condition: 'mirovoy_resolution_date',
  weekend_shift: true,
  ics: true,
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ — сдача на почту до 24:00 последнего дня',
  norm_versions: [
    {
      id: 'current',
      from: null,
      to: null,
      anchor: { offset_start: 1 },
      norm: {
        primary: 'ч. 2 ст. 321 ГПК РФ',
        calculation: ['ч. 3 ст. 107', 'ч. 1, 2 ст. 108 ГПК РФ'],
        clarification: 'п. 17 ПП ВС РФ от 22.06.2021 № 16',
      },
    },
  ],
};

// Точка отсчёта апелляции — по п. 17 ПП ВС РФ от 22.06.2021 № 16 (сверено дословно, раздел 9):
// со дня, следующего за днём принятия решения, а при составлении мотивированного
// решения по заявлению — со дня, следующего за днём его составления.
const MIROVOY_APPEAL_MODES = {
  resolution: {
    logic:
      'Месяц со дня, следующего за днём принятия решения (объявления ' +
      'резолютивной части): мотивированное решение не составлялось. ' +
      MIROVOY_NO_REASONED_NOTE,
  },
  reasoned: {
    logic:
      'Мотивированное решение составлено по заявлению — месяц со дня, ' +
      'следующего за днём его составления (п. 17 ПП ВС РФ от 22.06.2021 № 16).',
  },
};

/**
 * Мировой судья без мотивированного решения (ч. 3–5 ст. 199 ГПК).
 * Независимая ветка по своим inputs.
 * @param {object} inputs
 * @returns {object|null} null, если не введена дата объявления резолютивной части.
 */
export function computeMirovoy(inputs, referenceDate = null) {
  const resolution = toISO(inputs?.mirovoy_resolution_date);
  if (resolution == null) return null;

  const requestFiled = toISO(inputs.mirovoy_request_date);
  const reasoned = toISO(inputs.mirovoy_reasoned_date);
  const attendance = MIROVOY_ATTENDANCE_VALUES.includes(inputs.mirovoy_attendance)
    ? inputs.mirovoy_attendance
    : 'present'; // по умолчанию — присутствовал (более короткий срок, 3 дня)

  // ч. 4 ст. 199 — 3 или 15 рабочих дней на заявление, в зависимости от явки.
  const requestMode = MIROVOY_REQUEST_MODES[attendance];
  const request = computeSimpleTerm(
    { ...MIROVOY_REASONED_REQUEST, duration: { value: requestMode.days, unit: 'working_day' } },
    resolution,
    { norm: requestMode.norm, logic: requestMode.logic, attendance },
  );

  // ч. 5 ст. 199 — 10 рабочих дней на составление, от поступления заявления.
  const making = requestFiled != null
    ? computeSimpleTerm(MIROVOY_REASONED_MAKING, requestFiled)
    : null;

  // Апелляция: от мотивированного решения, если оно составлено, иначе от
  // объявления резолютивной части (п. 17 ПП ВС РФ от 22.06.2021 № 16).
  const appealAnchorKind = reasoned != null ? 'reasoned' : 'resolution';
  const appeal = computeSimpleTerm(MIROVOY_APPEAL, reasoned ?? resolution, {
    logic: MIROVOY_APPEAL_MODES[appealAnchorKind].logic,
    anchor_kind: appealAnchorKind,
  });

  return {
    attendance,
    reasoned_request: request,
    reasoned_making: making,
    appeal,
    cassation: computeMirovoyCassation(inputs, appeal, toISO(referenceDate)),
  };
}

// --- Кассация по делам мировых судей (глава 40.1 ГПК) -----------------------
//
// Глава 40.1 введена ФЗ № 79-ФЗ от 09.04.2026 и вступила в силу 10.05.2026
// (опубликован на pravo.gov.ru 09.04.2026, тридцать дней по ч. 1 ст. 3 закона).
// Объекты по ч. 1 ст. 375.1: судебные приказы, решения и определения мировых
// судей, апелляционные и иные определения районных судов как суда
// апелляционной инстанции.
//
// Маршрут зависит от ДАТЫ ПОДАЧИ жалобы (переходное положение ч. 2 ст. 3
// ФЗ № 79-ФЗ): поданные с 10.05.2026 — в президиум областного суда по главе
// 40.1; поданные в КСОЮ до 10.05.2026 — по прежним правилам (ст. 376.1).
// При планировании (дата подачи не введена) — по текущей дате.
export const MIROVOY_CASSATION_CUTOFF = '2026-05-10';

const MIROVOY_CASSATION_CALC = ['ч. 3 ст. 107', 'ч. 1, 2 ст. 108 ГПК РФ'];

export const MIROVOY_CASSATION = {
  id: 'mirovoy_cassation',
  title: 'Кассационная жалоба (дела мировых судей)',
  duration: { value: 3, unit: 'month' },
  anchor: { offset_start: 1 },
  condition: 'mirovoy_resolution_date',
  weekend_shift: true,
  ics: true,
  midnight_rule: 'ч. 3 ст. 108 ГПК РФ — сдача на почту до 24:00 последнего дня',
  norm_versions: [
    {
      id: 'ksoyu_before_79fz',
      from: null,
      to: '2026-05-09', // включительно
      court: 'Кассационный суд общей юрисдикции',
      title: 'Кассационная жалоба в КСОЮ (дела мировых судей)',
      norm: {
        primary: 'ч. 1 ст. 376.1 ГПК РФ',
        calculation: MIROVOY_CASSATION_CALC,
        clarification: 'ч. 2 ст. 3 ФЗ № 79-ФЗ от 09.04.2026 (переходное положение)',
      },
      transitional_note:
        'Жалоба подаётся до 10.05.2026, поэтому действует прежний маршрут: ' +
        'кассация в кассационный суд общей юрисдикции по ст. 376.1 ГПК РФ. ' +
        'По ч. 2 ст. 3 ФЗ № 79-ФЗ жалобы на акты мировых судей и на акты ' +
        'районных судов как суда апелляционной инстанции, поданные в КСОЮ до ' +
        'этой даты, рассматриваются по прежним правилам.',
    },
    {
      id: 'presidium_from_79fz',
      from: '2026-05-10',
      to: null,
      court: 'Президиум областного (и равного ему) суда',
      title: 'Кассационная жалоба в президиум областного суда',
      norm: {
        primary: 'ч. 1 ст. 375.2 ГПК РФ (глава 40.1, ФЗ № 79-ФЗ от 09.04.2026)',
        calculation: MIROVOY_CASSATION_CALC,
        clarification: 'ч. 1 ст. 375.1 ГПК РФ (объекты обжалования)',
      },
    },
  ],
};

// Точки отсчёта по ч. 1 ст. 375.2 — та же структура, что у ст. 376.1:
// со дня вступления обжалуемого постановления в силу, а если оно обжаловалось
// в апелляции — со дня изготовления мотивированного апелляционного определения.
const MIROVOY_CASSATION_ANCHORS = {
  appeal_reasoned: {
    logic:
      'Три месяца со дня изготовления мотивированного апелляционного определения ' +
      'районного суда: постановление мирового судьи обжаловалось в апелляции.',
  },
  entry_into_force: {
    logic:
      'Три месяца со дня вступления обжалуемого постановления в законную силу: ' +
      'в апелляции оно не обжаловалось, срок апелляционного обжалования истёк.',
  },
};

// referenceDate — текущая дата (ISO); нужна и для выбора маршрута, и чтобы
// понять, истёк ли срок апелляционного обжалования при отсутствии апелляции.
function computeMirovoyCassation(inputs, mirovoyAppeal, referenceDate) {
  const appealReasoned = toISO(inputs.mirovoy_appeal_ruling_reasoned_date);

  // Точка отсчёта. Апелляция была → мотивированное определение районного суда.
  // Апелляции не было → вступление в силу (дедлайн апелляции + 1 день), но об
  // этом можно говорить только когда срок апелляционного обжалования истёк.
  let anchor = null;
  let anchorKind = null;
  if (appealReasoned != null) {
    anchor = appealReasoned;
    anchorKind = 'appeal_reasoned';
  } else if (referenceDate != null && referenceDate > mirovoyAppeal.deadline) {
    anchor = toISO(addDays(mirovoyAppeal.deadline, 1));
    anchorKind = 'entry_into_force';
  } else {
    // Данных об апелляции районного суда нет: срок обжалования ещё не истёк и
    // мотивированное определение не введено — узел не показываем.
    return null;
  }

  // Маршрут по дате подачи кассационной жалобы, иначе по текущей дате.
  const effectiveDate = toISO(inputs.cassation_filed_date) ?? referenceDate;
  if (effectiveDate == null) return null;
  const version = pickVersion(MIROVOY_CASSATION.norm_versions, effectiveDate);
  if (version == null) return null;

  const result = computeSimpleTerm(MIROVOY_CASSATION, anchor, {
    title: version.title,
    norm: version.norm,
    logic: MIROVOY_CASSATION_ANCHORS[anchorKind].logic,
    anchor_kind: anchorKind,
    version_id: version.id,
    court: version.court,
    effective_date: effectiveDate,
  });
  if (version.transitional_note) result.transitional_note = version.transitional_note;
  // Апелляции не было (отсчёт от вступления в силу) — то же предупреждение.
  const warn = exhaustionWarningFor(anchorKind === 'entry_into_force');
  if (warn) result.exhaustion_warning = warn;
  return result;
}

// --- Валидация даты мотивированного решения (ч. 2 ст. 199 ГПК) --------------
//
// Темпоральная модель (раздел 10): ФЗ № 135-ФЗ от 12.06.2024 увеличил срок
// отложения составления мотивированного решения с пяти до десяти дней; в силе с
// 01.09.2024. Редакция выбирается по дате окончания судебного разбирательства.
export const REASONED_DECISION_DELAY = {
  norm_versions: [
    {
      id: 'before_135fz',
      from: null,
      to: '2024-08-31',
      days: 5,
      norm: 'ч. 2 ст. 199 ГПК РФ (в редакции до ФЗ № 135-ФЗ от 12.06.2024)',
    },
    {
      id: 'from_135fz',
      from: '2024-09-01',
      to: null,
      days: 10,
      norm: 'ч. 2 ст. 199 ГПК РФ (ред. ФЗ № 135-ФЗ от 12.06.2024)',
    },
  ],
};

/**
 * Редакция ч. 2 ст. 199 на дату окончания разбирательства.
 * @param {string|null} hearingEndISO
 * @returns {{id:string, days:number, norm:string}}
 */
export function reasonedDelayVersionFor(hearingEndISO) {
  const versions = REASONED_DECISION_DELAY.norm_versions;
  return hearingEndISO == null
    ? versions[versions.length - 1]
    : pickVersion(versions, hearingEndISO);
}

const ENTRY_INTO_FORCE_NORM = 'ч. 1 ст. 209 ГПК РФ';

// --- Вспомогательные --------------------------------------------------------

// Приводит Date | 'YYYY-MM-DD' | null/undefined к ISO-строке или null.
//
// Пустая строка и неполные/битые даты дают null, а не «NaN-NaN-NaN»: иначе
// проверки вида `toISO(x) != null` ложно срабатывают на пустом поле. Так пустое
// поле «определение об отказе» переставало гасить предупреждение об исчерпании
// для ответчика по заочному решению.
function toISO(value) {
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

// Поля с датами апелляционного определения по веткам. reasoned — изготовление
// мотивированного (точка отсчёта новой редакции при обжаловании); ruling —
// принятие (точка отсчёта альтернативы по п. 12 ПП ВС РФ). Общая цепочка и две
// ветки читают разные поля, механика — одна.
const CASSATION_ANCHOR_FIELDS = {
  general: { reasoned: 'appeal_ruling_reasoned_date', ruling: 'appeal_ruling_date' },
  simplified: {
    reasoned: 'simplified_appeal_ruling_reasoned_date',
    ruling: 'simplified_appeal_ruling_date',
  },
  default_judgment: {
    reasoned: 'default_judgment_appeal_ruling_reasoned_date',
    ruling: 'default_judgment_appeal_ruling_date',
  },
};

// Точка отсчёта кассационного срока в ВС (ст. 390.3) для выбранной редакции.
function resolveVsAnchor(version, inputs) {
  if (version.anchor.event === 'ksoyu_ruling_reasoned') {
    // Новая редакция — от изготовления мотивированного определения КСОЮ.
    return toISO(inputs.ksoyu_ruling_reasoned_date);
  }
  // 'ksoyu_ruling' — со дня вынесения определения КСОЮ (прежняя редакция).
  return toISO(inputs.ksoyu_ruling_date);
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
// подачи), но по прежней срок истёк ещё до отсечки (её вступления в силу), а по
// действующей — уже после, отсечка попадает между датами. Переходных положений
// у ФЗ № 135-ФЗ нет — вопрос о применимой редакции спорный. Расчёт остаётся по
// действующей редакции, но показываются обе даты (раздел 10 SPEC.md).
// resolveAnchorFor(version) → дата точки отсчёта или null.
function boundaryWarning(term, version, resolveAnchorFor, currentDeadline) {
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
      reason:
        'ФЗ № 135-ФЗ не содержит переходных положений — вопрос о применимой ' +
        'редакции спорный.',
    };
  }
  return null;
}

// Обобщённый расчёт срока с темпоральными редакциями (кассация в КСОЮ и в ВС).
//   resolveAnchorFor(version) → дата точки отсчёта или null;
//   altDates — { ruling, reasoned } для alternative_calculation, или null.
function computeVersionedTerm(term, effectiveDate, resolveAnchorFor, altDates) {
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

  // alternative_calculation — только у редакции, где она задана (from_135fz), при
  // расхождении даты вынесения и даты мотивированного определения (раздел 6).
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

  // Пограничное окно редакций (раздел 10 SPEC.md) — расчёт не меняем.
  const bw = boundaryWarning(term, version, resolveAnchorFor, primary.deadline);
  if (bw) result.boundary_warning = bw;

  return result;
}

// Предупреждение об исчерпании способов обжалования — показывается, когда акт
// первой инстанции в апелляции не обжаловался. Расчёт не меняется.
function exhaustionWarningFor(notAppealed) {
  return notAppealed ? EXHAUSTION_WARNING : null;
}

// Кассация в КСОЮ — обобщённый расчёт для общей цепочки и веток упрощённого
// производства / заочного решения. Норма ст. 376.1 одна и та же; ветки
// различаются лишь именами полей с датами апелляционного определения и тем,
// показывать ли предупреждение об исчерпании (3.7).
//
// term — узел ветки (CASSATION_KSOYU или его копия с иным id);
// branch — ключ CASSATION_ANCHOR_FIELDS; referenceDate — текущая дата (ISO) для
// выбора редакции, если не введена дата подачи жалобы; exhaustion —
// функция-резолвер `({ appealed }) => предупреждение | null`: условие исчерпания
// у веток разное (у заочного оно зависит ещё и от заявления об отмене, 3.7).
//
// Точка отсчёта: не обжаловалось — со дня вступления в силу; обжаловалось — со
// дня изготовления мотивированного апелляционного определения (новая редакция).
function computeCassationTerm(term, inputs, entry, branch, referenceDate, { exhaustion } = {}) {
  // condition: событие вступления в силу разрешено — иначе не считаем.
  if (!entry.resolved) return null;
  const fields = CASSATION_ANCHOR_FIELDS[branch];
  const appealed = entry.branch === 'appealed';
  const effectiveDate = toISO(inputs.cassation_filed_date) ?? referenceDate;
  const altDates = appealed
    ? { ruling: inputs[fields.ruling], reasoned: inputs[fields.reasoned] }
    : null;
  const resolveAnchor = (version) => {
    // Новая редакция при обжаловании — от мотивированного определения; иначе
    // (не обжаловалось либо прежняя редакция) — со дня вступления в силу.
    if (version.anchor.event === 'appeal_ruling_reasoned' && appealed) {
      return toISO(inputs[fields.reasoned]);
    }
    return entry.date;
  };
  const result = computeVersionedTerm(term, effectiveDate, resolveAnchor, altDates);
  if (result && typeof exhaustion === 'function') {
    const warn = exhaustion({ appealed });
    if (warn) result.exhaustion_warning = warn;
  }
  return result;
}

// Условие исчерпания общего порядка: не обжаловалось в апелляции → предупреждение.
const generalExhaustion = ({ appealed }) => exhaustionWarningFor(!appealed);

// Кассация в КСОЮ для общей цепочки.
function computeCassation(inputs, entry, referenceDate) {
  return computeCassationTerm(CASSATION_KSOYU, inputs, entry, 'general', referenceDate, {
    exhaustion: generalExhaustion,
  });
}

// Условие исчерпания для заочного решения (3.7). У ответчика перед апелляцией
// обязательно заявление об отмене (ст. 237, позиция ВС РФ): исчерпание — только
// когда заявление рассмотрено (есть определение об отказе) И решение обжаловано
// в апелляции. Без рассмотренного заявления — специальное предупреждение о
// заявлении об отмене, даже если апелляция подана; заявление рассмотрено, но
// апелляции нет — общее предупреждение об апелляции. Иным лицам заявление об
// отмене недоступно — условие как в общем порядке.
function defaultJudgmentExhaustion(subject, requestReviewed) {
  return ({ appealed }) => {
    if (subject === 'defendant' && !requestReviewed) {
      return DEFAULT_JUDGMENT_DEFENDANT_EXHAUSTION_WARNING;
    }
    return exhaustionWarningFor(!appealed);
  };
}

// Кассация в Судебную коллегию ВС РФ (ст. 390.3).
function computeVsCassation(inputs, referenceDate) {
  // condition: узел доступен только после ввода даты определения КСОЮ.
  if (toISO(inputs.ksoyu_ruling_date) == null) return null;
  const effectiveDate = toISO(inputs.vs_cassation_filed_date) ?? referenceDate;
  return computeVersionedTerm(
    CASSATION_VS,
    effectiveDate,
    (version) => resolveVsAnchor(version, inputs),
    { ruling: inputs.ksoyu_ruling_date, reasoned: inputs.ksoyu_ruling_reasoned_date },
  );
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
  const cassationVs = computeVsCassation(inputs, toISO(options.today));
  const enforcement = computeEnforcement(entry);

  return {
    appeal,
    entry_into_force: { norm: ENTRY_INTO_FORCE_NORM, ...entry },
    cassation,
    cassation_vs: cassationVs,
    enforcement,
    // Сроки в рабочих днях — независимые узлы, каждый по своему input.
    ...computeIndependentTerms(inputs),
    // Упрощённое производство — своя ветка со своим вступлением в силу.
    simplified: computeSimplified(inputs, toISO(options.today)),
    // Заочное решение — своя ветка со своим вступлением в силу.
    default_judgment: computeDefaultJudgment(inputs, toISO(options.today)),
    // Мировой судья без мотивированного решения — своя ветка.
    mirovoy: computeMirovoy(inputs, toISO(options.today)),
  };
}
