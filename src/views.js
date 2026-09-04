// Сборка карточек для отображения (раздел 8, задача 4а SPEC.md).
//
// Берёт входные данные, считает цепочку и возвращает готовую структуру данных
// для UI: карточки видимых узлов, список неполных узлов («что ещё уточнить») и
// статические заглушки. Никакой вёрстки — только данные.
//
// Прогрессивное раскрытие (вариант А): полностью показываются только узлы, для
// которых достаточно введённых данных; остальные попадают в `incomplete` с
// причиной и названиями недостающих input, а не пустыми полями.

import {
  computeChain,
  APPEAL_GENERAL,
  CASSATION_KSOYU,
  CASSATION_VS,
  cassationVersionFor,
  vsCassationVersionFor,
  computeIndependentTerms,
  computeSimplified,
  computeDefaultJudgment,
  computeMirovoy,
  reasonedDelayVersionFor,
} from './chain.js';

// Заглушки рядом с узлом предъявления ИЛ (ст. 21–22 ФЗ № 229-ФЗ). Судебный
// приказ раскрыт отдельным узлом (court_order_presentation, своя ситуация в
// situations.js) и здесь больше не заглушка.
const ENFORCEMENT_STUBS = [
  {
    id: 'periodic_payments',
    title: 'Периодические платежи',
    explanation:
      'Исполнительный лист можно предъявить в течение всего срока, на который ' +
      'присуждены платежи, плюс три года после его окончания.',
    norm: 'ч. 4 ст. 21 ФЗ № 229-ФЗ',
  },
  {
    id: 'interruption',
    title: 'Перерыв срока',
    explanation:
      'Расчёт с учётом перерыва не поддерживается — требуется дата предъявления ' +
      'исполнительного листа или частичного исполнения.',
    norm: 'ст. 22 ФЗ № 229-ФЗ',
  },
];
import { computeDeadline, addDays } from './engine.js';
import { toISODate, calendarNote, isWorkingDay } from './calendar.js';

// Названия input (п. 4.1 SPEC.md) для списка «что ещё можно уточнить».
const INPUT_LABELS = {
  reasoned_decision_date: 'Дата изготовления мотивированного решения',
  hearing_end_date: 'Дата окончания разбирательства дела',
  appeal_filed_date: 'Дата подачи апелляционной жалобы',
  appeal_ruling_date: 'Дата принятия апелляционного определения',
  appeal_ruling_reasoned_date: 'Дата изготовления мотивированного апелляционного определения',
  cassation_filed_date: 'Дата подачи кассационной жалобы',
  ksoyu_ruling_date: 'Дата вынесения определения КСОЮ',
  ksoyu_ruling_reasoned_date: 'Дата изготовления мотивированного определения КСОЮ',
  vs_cassation_filed_date: 'Дата подачи кассационной жалобы в ВС РФ',
  protocol_signed_date: 'Дата подписания протокола судебного заседания',
  protocol_remarks_filed_date: 'Дата подачи замечаний на протокол',
  interim_ruling_date: 'Дата вынесения определения судом первой инстанции',
  simplified_resolution_date: 'Дата подписания резолютивной части решения (упрощённое производство)',
  simplified_reasoned_request_date: 'Дата подачи заявления о составлении мотивированного решения',
  simplified_reasoned_date: 'Дата составления мотивированного решения',
  simplified_appeal_filed_date: 'Дата подачи апелляционной жалобы (упрощённое производство)',
  simplified_appeal_ruling_date: 'Дата определения апелляционной инстанции (упрощённое производство)',
  default_judgment_service_date: 'Дата вручения ответчику копии заочного решения',
  default_judgment_cancellation_request_date: 'Дата подачи заявления об отмене заочного решения',
  default_judgment_refusal_date: 'Дата определения об отказе в отмене заочного решения',
  default_judgment_cancellation_date: 'Дата определения об отмене заочного решения (заявление удовлетворено)',
  default_judgment_appeal_filed_date: 'Дата подачи апелляционной жалобы (заочное решение)',
  default_judgment_appeal_ruling_date: 'Дата определения апелляционной инстанции (заочное решение)',
  default_judgment_subject: 'Кто обжалует заочное решение',
  mirovoy_resolution_date: 'Дата объявления резолютивной части (мировой судья)',
  mirovoy_attendance: 'Участник присутствовал в судебном заседании',
  mirovoy_request_date: 'Дата подачи заявления о составлении мотивированного решения',
  mirovoy_reasoned_date: 'Дата составления мотивированного решения мировым судьёй',
  mirovoy_appeal_ruling_reasoned_date:
    'Дата изготовления мотивированного апелляционного определения районного суда',
  vs_ruling_date: 'Дата вынесения определения Судебной коллегии ВС РФ',
  court_order_issued_date: 'Дата выдачи судебного приказа',
};

// Заглушки (п. 4.4 SPEC.md) — статические карточки. Все раскрыты (см. 3.1–3.4),
// список пуст: неподдерживаемых ветвей в модели больше нет.
const STUBS = [];

// --- Вспомогательные --------------------------------------------------------

function toISO(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const [y, m, d] = value.split('-').map(Number);
    return toISODate(new Date(Date.UTC(y, m - 1, d)));
  }
  return toISODate(value);
}

// Разница в календарных днях: bIso − aIso.
function daysBetween(aIso, bIso) {
  const [ay, am, ad] = aIso.split('-').map(Number);
  const [by, bm, bd] = bIso.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

// Насколько фактическая дата вышла за последний допустимый день — в рабочих
// днях. Порог задан в рабочих днях, поэтому и расхождение считаем в них: по
// календарным новогодние каникулы раздували бы цифру втрое.
function workingDaysAfter(allowedISO, actualISO) {
  let count = 0;
  let cursor = allowedISO;
  while (cursor < actualISO) {
    cursor = toISODate(addDays(cursor, 1));
    if (isWorkingDay(cursor)) count += 1;
  }
  return count;
}

// Недостающие input из списка ids → [{id, label}].
function missingInputs(ids, inputs) {
  return ids
    .filter((id) => inputs[id] == null)
    .map((id) => ({ id, label: INPUT_LABELS[id] }));
}

function incompleteNode(id, kind, title, reason, missing) {
  return { id, kind, title, status: 'not_computed', reason, missing_inputs: missing };
}

// --- Карточки узлов ---------------------------------------------------------

function termCard(term, calc) {
  const version = term.norm_versions[0]; // одноверсионный срок (апелляция)
  const card = {
    id: term.id,
    kind: 'term',
    title: term.title,
    status: 'computed',
    deadline: calc.deadline,
    norm: version.norm.primary,
    details: {
      collapsed: true, // блок «подробнее» свёрнут по умолчанию
      logic: term.logic,
      calculation: version.norm.calculation,
      midnight_rule: term.midnight_rule,
    },
  };
  attachCalendarWarning(card);
  return card;
}

// Примечание о достоверности календаря (draft/preliminary год + зона переносов).
// Для карточек-событий дату надо передать явно: у них поле date, а не deadline.
function attachCalendarWarning(card, date = card.deadline) {
  if (date == null) return;
  const note = calendarNote(date);
  if (note) card.calendar_warning = note;
}

function buildAppealCard(inputs) {
  const calc = computeDeadline(APPEAL_GENERAL, inputs.reasoned_decision_date);
  const card = termCard(APPEAL_GENERAL, calc);

  // Предупреждение: мотивированное решение изготовлено позже срока отложения
  // по ч. 2 ст. 199. Порог темпоральный (раздел 10): до 31.08.2024 — 5 дней,
  // с 01.09.2024 — 10 дней (ФЗ № 135-ФЗ). Редакция — по дате окончания
  // разбирательства. warn_not_block: считаем от фактической даты (п. 16 ПП ВС РФ от 22.06.2021 № 16).
  if (inputs.hearing_end_date != null) {
    const hearingEnd = toISO(inputs.hearing_end_date);
    const version = reasonedDelayVersionFor(hearingEnd);
    // Порог — срок в днях, значит в рабочих (абз. 2 ч. 3 ст. 107; изъятия для
    // этого срока ГПК не устанавливает). Считаем тем же движком, что и сроки:
    // последний допустимый день = N-й рабочий день после окончания разбирательства.
    const allowed = computeDeadline(
      { duration: { value: version.days, unit: 'working_day' }, anchor: { offset_start: 1 } },
      hearingEnd,
    ).deadline;
    if (calc.anchor > allowed) {
      card.warnings = [
        {
          code: 'reasoned_over_delay',
          version_id: version.id,
          threshold_days: version.days,
          threshold_unit: 'working_day',
          allowed_deadline: allowed,
          actual_date: calc.anchor,
          text:
            `Мотивированное решение изготовлено позже срока отложения — ` +
            `${version.days} рабочих дней после окончания разбирательства ` +
            `(${version.norm}). Срок обжалования считается от фактической даты ` +
            '(п. 16 ПП ВС РФ от 22.06.2021 № 16).',
        },
      ];
    }
  }

  // Проверка «уже подали?» — общая для всех узлов, см. markExpired ниже.

  return { card, calc };
}

function eventCard(entry) {
  const card = {
    id: 'entry_into_force',
    kind: 'event',
    title: 'Вступление решения в законную силу',
    // Подлежащее для строки события: она рендерится без карточки, и при
    // выделении/копировании должна читаться сама по себе («Решение суда …»).
    subject: 'Решение суда',
    status: entry.resolved ? 'resolved' : 'pending',
    norm: entry.norm,
    date: entry.date,
    details: { collapsed: true, logic: entry.logic },
  };
  if (entry.note) card.note = entry.note;
  if (!entry.resolved) {
    card.not_earlier_than = entry.not_earlier_than;
    card.message = entry.message;
  }
  return card;
}

// Карточка кассационного срока (КСОЮ и ВС — одинаковая структура).
function cassationCard(cassation) {
  const card = {
    id: cassation.id,
    kind: 'term',
    title: cassation.title,
    status: 'computed',
    deadline: cassation.deadline,
    norm: cassation.norm.primary, // текст действующей редакции
    version_id: cassation.version_id,
    details: {
      collapsed: true,
      logic: cassation.logic, // логика той же редакции
      calculation: cassation.norm.calculation,
      midnight_rule: cassation.midnight_rule,
    },
  };
  if (cassation.alternative) card.alternative = cassation.alternative;
  if (cassation.boundary_warning) card.boundary_warning = cassation.boundary_warning;
  if (cassation.exhaustion_warning) card.exhaustion_warning = cassation.exhaustion_warning;
  attachCalendarWarning(card);
  return card;
}

// Карточка срока предъявления ИЛ. Рядом — заглушки по смежным случаям (в card.stubs).
function enforcementCard(enf) {
  const card = {
    id: enf.id,
    kind: 'term',
    title: enf.title,
    status: 'computed',
    deadline: enf.deadline,
    norm: enf.norm.primary,
    details: {
      collapsed: true,
      logic: enf.logic,
      calculation: enf.norm.calculation,
      midnight_rule: enf.midnight_rule,
    },
    stubs: ENFORCEMENT_STUBS,
  };
  attachCalendarWarning(card);
  return card;
}

// Карточка срока в рабочих днях (абз. 2 ч. 3 ст. 107). Показывает первый день
// течения — иначе непонятно, почему дата такая далёкая после каникул.
function workingDayCard(term, extra = {}) {
  const card = {
    id: term.id,
    kind: 'term',
    title: term.title,
    status: 'computed',
    deadline: term.deadline,
    norm: term.norm.primary,
    unit: 'working_day',
    duration: term.duration,
    first_working_day: term.first_working_day,
    details: {
      collapsed: true,
      logic: term.logic,
      calculation: term.norm.calculation,
      midnight_rule: term.midnight_rule,
    },
    ...extra,
  };
  if (term.anchor_note) card.note = term.anchor_note;
  attachCalendarWarning(card);
  return card;
}

// Карточки упрощённого производства (глава 21.1): три срока + своё событие
// вступления в силу по ст. 232.4.
function simplifiedCards(simplified) {
  const cards = [];

  cards.push(workingDayCard(simplified.reasoned_request));

  if (simplified.reasoned_making) {
    const making = workingDayCard(simplified.reasoned_making, { informational: true });
    making.note =
      simplified.reasoned_making.trigger === 'appeal_filed'
        ? 'Отсчёт от даты подачи апелляционной жалобы (ч. 4 ст. 232.4).'
        : 'Отсчёт от даты поступления заявления о составлении мотивированного решения.';
    cards.push(making);
  }

  const appeal = workingDayCard(simplified.appeal);
  appeal.note =
    simplified.appeal.anchor_kind === 'reasoned'
      ? 'Мотивированное решение составлено — отсчёт со дня принятия решения в окончательной форме.'
      : 'Мотивированное решение не составлялось — отсчёт со дня принятия решения.';

  // Предупреждение: мотивированное решение составлено позже срока по ч. 4
  // ст. 232.4 (10 рабочих дней со дня поступления заявления либо со дня подачи
  // апелляционной жалобы). По образцу валидации ч. 2 ст. 199 в общем порядке:
  // warn_not_block — расчёт апелляционного срока не меняем, он идёт от
  // фактической даты составления.
  //
  // Без срока изготовления (не введён ни один запускающий факт) сравнивать не с
  // чем — предупреждения нет.
  if (
    simplified.reasoned_making &&
    simplified.appeal.anchor_kind === 'reasoned' &&
    simplified.appeal.anchor > simplified.reasoned_making.deadline
  ) {
    const allowed = simplified.reasoned_making.deadline;
    const actual = simplified.appeal.anchor;
    const trigger =
      simplified.reasoned_making.trigger === 'appeal_filed'
        ? 'дня подачи апелляционной жалобы'
        : 'дня поступления заявления о составлении мотивированного решения';
    appeal.warnings = [
      {
        code: 'simplified_reasoned_over_delay',
        threshold_days: simplified.reasoned_making.duration.value,
        threshold_unit: 'working_day',
        allowed_deadline: allowed,
        actual_date: actual,
        // Здесь это срок изготовления решения, а не отложения его составления:
        // подпись к датам своя, иначе она читалась бы как про ч. 2 ст. 199.
        dates_label: 'Срок изготовления истекал',
        overdue_working_days: workingDaysAfter(allowed, actual),
        text:
          'Мотивированное решение составлено позже срока — ' +
          `${simplified.reasoned_making.duration.value} рабочих дней со ${trigger} ` +
          `(${simplified.reasoned_making.norm.primary}). Срок апелляционного ` +
          'обжалования считается от фактической даты составления.',
      },
    ];
  }
  cards.push(appeal);

  const entry = simplified.entry_into_force;
  const entryCard = {
    id: 'simplified_entry_into_force',
    kind: 'event',
    title: 'Вступление решения в законную силу (упрощённое производство)',
    subject: 'Решение суда',
    status: entry.resolved ? 'resolved' : 'pending',
    norm: `${entry.norm} — ${entry.part}`,
    date: entry.date,
    details: { collapsed: true, logic: entry.logic },
  };
  if (entry.message) entryCard.message = entry.message;
  if (entry.note) entryCard.note = entry.note;
  attachCalendarWarning(entryCard, entry.date);
  cards.push(entryCard);

  // Кассация в КСОЮ — после вступления решения в силу (ст. 376.1).
  if (simplified.cassation) cards.push(cassationCard(simplified.cassation));

  // Предъявление ИЛ — после вступления решения в силу (ч. 1 ст. 21 ФЗ № 229-ФЗ).
  if (simplified.enforcement) cards.push(enforcementCard(simplified.enforcement));

  return cards;
}

// Карточки заочного решения (ст. 237): срок на заявление об отмене, апелляция
// (по субъекту) и явная пометка, что вступление в силу не рассчитывается.
function defaultJudgmentCards(dj) {
  const cards = [];
  const incomplete = [];

  cards.push(workingDayCard(dj.cancellation_request));

  if (dj.appeal) {
    const card = {
      id: dj.appeal.id,
      kind: 'term',
      title: dj.appeal.title,
      status: 'computed',
      deadline: dj.appeal.deadline,
      norm: dj.appeal.norm.primary,
      duration: dj.appeal.duration,
      subject: dj.appeal.subject,
      details: {
        collapsed: true,
        logic: dj.appeal.logic,
        calculation: dj.appeal.norm.calculation,
        midnight_rule: dj.appeal.midnight_rule,
      },
      note:
        dj.appeal.anchor_kind === 'request_deadline'
          ? 'Ответчик заявление об отмене не подавал — отсчёт по истечении срока его подачи.'
          : 'Отсчёт со дня вынесения определения об отказе в отмене заочного решения.',
    };
    attachCalendarWarning(card);
    cards.push(card);
  } else if (dj.appeal_not_applicable) {
    // Заявление об отмене удовлетворено: срока нет вовсе. Карточка остаётся,
    // но без даты — как событие вступления в силу в том же состоянии.
    cards.push({
      id: 'default_judgment_appeal',
      kind: 'term',
      title: 'Апелляционная жалоба (заочное решение)',
      status: 'not_applicable',
      deadline: null,
      norm: dj.appeal_not_applicable.norm,
      message: dj.appeal_not_applicable.message,
      details: { collapsed: true, logic: dj.appeal_not_applicable.reason },
    });
  } else if (dj.appeal_blocked) {
    incomplete.push(
      incompleteNode(
        'default_judgment_appeal',
        'term',
        `Апелляционная жалоба (заочное решение) — ${dj.appeal_blocked.norm}`,
        dj.appeal_blocked.reason,
        missingInputs(dj.appeal_blocked.missing, {}),
      ),
    );
  }

  // Вступление в силу — своё событие по ч. 1 ст. 244 с тремя ветвями; общее
  // правило ч. 1 ст. 209 к заочному решению не применяется.
  const entry = dj.entry_into_force;
  const entryCard = {
    id: 'default_judgment_entry_into_force',
    kind: 'event',
    title: 'Вступление заочного решения в законную силу',
    subject: 'Заочное решение',
    status: entry.resolved ? 'resolved' : entry.applicable === false ? 'not_applicable' : 'pending',
    norm: entry.norm,
    date: entry.date,
    branch: entry.branch,
    details: { collapsed: true, logic: entry.logic },
  };
  if (entry.message) entryCard.message = entry.message;
  if (entry.note) entryCard.note = entry.note;
  attachCalendarWarning(entryCard, entry.date);
  cards.push(entryCard);

  // Кассация в КСОЮ — после вступления заочного решения в силу (ст. 376.1).
  // Без exhaustion_warning (отложено, см. computeDefaultJudgment).
  if (dj.cassation) cards.push(cassationCard(dj.cassation));

  // Предъявление ИЛ — после вступления заочного решения в силу (ч. 1 ст. 21
  // ФЗ № 229-ФЗ). При удовлетворённом заявлении об отмене вступления в силу нет,
  // и dj.enforcement === null — карточки нет.
  if (dj.enforcement) cards.push(enforcementCard(dj.enforcement));

  return { cards, incomplete };
}

// Карточки ветки мирового судьи (ч. 3–5 ст. 199).
function mirovoyCards(m) {
  const cards = [];
  cards.push(workingDayCard(m.reasoned_request));
  if (m.reasoned_making) {
    cards.push(workingDayCard(m.reasoned_making, { informational: true }));
  }
  const appeal = {
    id: m.appeal.id,
    kind: 'term',
    title: m.appeal.title,
    status: 'computed',
    deadline: m.appeal.deadline,
    norm: m.appeal.norm.primary,
    duration: m.appeal.duration,
    details: {
      collapsed: true,
      logic: m.appeal.logic,
      calculation: m.appeal.norm.calculation,
      midnight_rule: m.appeal.midnight_rule,
    },
    note:
      m.appeal.anchor_kind === 'reasoned'
        ? 'Мотивированное решение составлено — отсчёт со дня, следующего за днём его составления.'
        : 'Мотивированное решение не составлялось — отсчёт со дня, следующего за днём принятия решения.',
  };
  attachCalendarWarning(appeal);
  cards.push(appeal);

  // Вступление в силу по ч. 1 ст. 209 (как в общем порядке), три ветви.
  const entry = m.entry_into_force;
  const entryCard = {
    id: 'mirovoy_entry_into_force',
    kind: 'event',
    title: 'Вступление решения в законную силу (мировой судья)',
    subject: 'Решение мирового судьи',
    status: entry.resolved ? 'resolved' : 'pending',
    norm: entry.norm,
    date: entry.date,
    branch: entry.branch,
    details: { collapsed: true, logic: entry.logic },
  };
  if (entry.message) entryCard.message = entry.message;
  if (entry.note) entryCard.note = entry.note;
  attachCalendarWarning(entryCard, entry.date);
  cards.push(entryCard);

  // Кассация по делам мировых судей: маршрут зависит от даты подачи
  // (глава 40.1 с 10.05.2026 либо прежний КСОЮ по переходному положению).
  if (m.cassation) {
    const cass = monthTermCard(m.cassation);
    cass.version_id = m.cassation.version_id;
    cass.court = m.cassation.court;
    if (m.cassation.exhaustion_warning) cass.exhaustion_warning = m.cassation.exhaustion_warning;
    if (m.cassation.transitional_note) cass.note = m.cassation.transitional_note;
    cards.push(cass);
  }

  // Предъявление ИЛ — после вступления решения в силу (ч. 1 ст. 21 ФЗ № 229-ФЗ).
  if (m.enforcement) cards.push(enforcementCard(m.enforcement));

  return cards;
}

// Карточка простого срока, посчитанного через computeSimpleTerm (название
// осталось от первого случая применения — надзорной жалобы, но функция не
// завязана на unit: то же используется для годового срока предъявления
// судебного приказа).
function monthTermCard(term) {
  const card = {
    id: term.id,
    kind: 'term',
    title: term.title,
    status: 'computed',
    deadline: term.deadline,
    norm: term.norm.primary,
    duration: term.duration,
    details: {
      collapsed: true,
      logic: term.logic,
      calculation: term.norm.calculation,
      midnight_rule: term.midnight_rule,
    },
  };
  attachCalendarWarning(card);
  return card;
}

const ENTRY_TITLE = 'Вступление решения в законную силу';

// Узлы «вступление в силу» и «кассация» с учётом достаточности данных.
function buildDownstream(inputs, today) {
  const cards = [];
  const incomplete = [];
  const appealed = inputs.appeal_filed_date != null;

  // Не обжаловано без текущей даты — событие не определить (ни not_appealed,
  // ни pending), обе ветки цепочки нельзя показать.
  if (!appealed && today == null) {
    incomplete.push(
      incompleteNode(
        'entry_into_force',
        'event',
        ENTRY_TITLE,
        'Не указана текущая дата — нельзя определить, истёк ли срок обжалования.',
        [],
      ),
    );
    incomplete.push(
      incompleteNode(
        'cassation_ksoyu',
        'term',
        CASSATION_KSOYU.title,
        'Кассационный срок начинается после вступления решения в силу.',
        [],
      ),
    );
    return { cards, incomplete };
  }

  const chain = computeChain(inputs, { today });
  const entry = chain.entry_into_force;

  // Событие. Ветви not_appealed/pending — всегда карточка (pending информативна:
  // «вступит в силу не ранее …»). Ветвь appealed — карточка, когда известна дата
  // принятия апелляционного определения; иначе приглашение её ввести.
  if (entry.branch === 'appealed' && entry.date == null) {
    incomplete.push(
      incompleteNode(
        'entry_into_force',
        'event',
        ENTRY_TITLE,
        'Обжаловано — для даты вступления в силу нужна дата принятия апелляционного определения.',
        missingInputs(['appeal_ruling_date'], inputs),
      ),
    );
  } else {
    cards.push(eventCard(entry));
  }

  // Кассация.
  if (chain.cassation) {
    cards.push(cassationCard(chain.cassation));
  } else if (appealed) {
    // Какого поля не хватает — зависит от редакции нормы на дату подачи кассации
    // (иначе на текущую): новая (с 01.09.2024) считает от мотивированного
    // определения, прежняя — со дня вступления в силу (= даты принятия).
    const effectiveDate = toISO(inputs.cassation_filed_date) ?? today;
    const version = cassationVersionFor(effectiveDate);
    if (version.anchor.event === 'appeal_ruling_reasoned') {
      incomplete.push(
        incompleteNode(
          'cassation_ksoyu',
          'term',
          CASSATION_KSOYU.title,
          'Кассационный срок (редакция с 01.09.2024) считается от даты изготовления мотивированного апелляционного определения.',
          missingInputs(['appeal_ruling_reasoned_date'], inputs),
        ),
      );
    } else {
      // Прежняя редакция: нужна дата вступления в силу — её поле на карточке
      // события (дата принятия апелляционного определения).
      incomplete.push(
        incompleteNode(
          'cassation_ksoyu',
          'term',
          CASSATION_KSOYU.title,
          'Кассационный срок (редакция до 01.09.2024) считается со дня вступления решения в силу — укажите дату принятия апелляционного определения.',
          [],
        ),
      );
    }
  } else {
    // pending: срок обжалования ещё не истёк — можно указать дату подачи жалобы.
    incomplete.push(
      incompleteNode(
        'cassation_ksoyu',
        'term',
        CASSATION_KSOYU.title,
        'Кассационный срок начинается после вступления решения в силу; срок обжалования ещё не истёк.',
        missingInputs(['appeal_filed_date'], inputs),
      ),
    );
  }

  // Кассация в ВС РФ (ст. 390.3) — узел появляется только после ввода даты
  // определения КСОЮ (condition: ksoyu_ruling_date).
  if (toISO(inputs.ksoyu_ruling_date) != null) {
    if (chain.cassation_vs) {
      cards.push(cassationCard(chain.cassation_vs));
    } else {
      // Не считается — действует новая редакция, нужна дата мотивированного
      // определения КСОЮ (прежняя редакция считается от даты вынесения, которая
      // уже введена, поэтому сюда попадает только новая).
      const effVs = toISO(inputs.vs_cassation_filed_date) ?? today;
      const vsVersion = vsCassationVersionFor(effVs);
      const missing =
        vsVersion.anchor.event === 'ksoyu_ruling_reasoned'
          ? ['ksoyu_ruling_reasoned_date']
          : ['ksoyu_ruling_date'];
      incomplete.push(
        incompleteNode(
          'cassation_vs',
          'term',
          CASSATION_VS.title,
          'Кассационный срок в ВС (редакция с 01.09.2024) считается от даты изготовления мотивированного определения КСОЮ.',
          missingInputs(missing, inputs),
        ),
      );
    }
  }

  // Предъявление исполнительного листа — только когда вступление в силу
  // разрешено (condition); в ветви pending узла нет.
  if (chain.enforcement) {
    cards.push(enforcementCard(chain.enforcement));
  }

  const independent = independentNodes(chain, today);
  cards.push(...independent.cards);
  incomplete.push(...independent.incomplete);

  return { cards, incomplete };
}

// Карточки узлов, независимых от цепочки общего порядка: сроки в рабочих днях и
// ветка упрощённого производства. Принимает либо результат цепочки, либо сами
// inputs — во втором случае считает их сама.
function independentNodes(source, today = null) {
  const fromChain = source && 'protocol_remarks' in source;
  const terms = fromChain ? source : computeIndependentTerms(source);
  const simplified = fromChain ? source.simplified : computeSimplified(source, today);
  const defaultJudgment = fromChain
    ? source.default_judgment
    : computeDefaultJudgment(source, today);
  const mirovoy = fromChain ? source.mirovoy : computeMirovoy(source, today);

  const cards = [];
  const incomplete = [];
  if (terms.protocol_remarks) {
    cards.push(workingDayCard(terms.protocol_remarks));
    if (terms.protocol_remarks_review) {
      cards.push(workingDayCard(terms.protocol_remarks_review, { informational: true }));
    }
  }
  if (terms.private_complaint) cards.push(workingDayCard(terms.private_complaint));
  if (terms.supervision) cards.push(monthTermCard(terms.supervision));
  if (terms.court_order_presentation) cards.push(monthTermCard(terms.court_order_presentation));
  if (simplified) cards.push(...simplifiedCards(simplified));
  if (defaultJudgment) {
    const dj = defaultJudgmentCards(defaultJudgment);
    cards.push(...dj.cards);
    incomplete.push(...dj.incomplete);
  }
  if (mirovoy) cards.push(...mirovoyCards(mirovoy));
  return { cards, incomplete };
}

// --- Истёкшие сроки ---------------------------------------------------------
//
// Срок истекает в 24:00 последнего дня (ч. 3 ст. 108), поэтому дедлайн «сегодня»
// ещё не истёк — сравнение строгое.
//
// Отличать от статуса 'missed': тот появляется, когда введена дата фактической
// подачи и она позже дедлайна — там установлен факт пропуска. Здесь факта нет,
// известно только, что срок прошёл.
//
// Узел → input, которым подтверждается совершение действия. Если он введён,
// срок по календарю больше не «висит»: подано вовремя или с пропуском —
// разбирается по факту (статус 'missed'), а не по текущей дате. Узел, которого
// в карте нет, подтвердить нечем — для него достаточно сравнения с датой.
export const ACTION_FACT_INPUT = {
  appeal_general: 'appeal_filed_date',
  cassation_ksoyu: 'cassation_filed_date',
  cassation_vs: 'vs_cassation_filed_date',
  protocol_remarks: 'protocol_remarks_filed_date',
  simplified_reasoned_request: 'simplified_reasoned_request_date',
  simplified_reasoned_making: 'simplified_reasoned_date',
  simplified_appeal: 'simplified_appeal_filed_date',
  default_judgment_cancellation_request: 'default_judgment_cancellation_request_date',
  default_judgment_appeal: 'default_judgment_appeal_filed_date',
  mirovoy_reasoned_request: 'mirovoy_request_date',
  mirovoy_reasoned_making: 'mirovoy_reasoned_date',
  mirovoy_appeal: 'mirovoy_appeal_ruling_reasoned_date',
  mirovoy_cassation: 'cassation_filed_date',
};

// Узлы, у которых подтверждающий факт — это именно дата подачи заявителем.
// Только для них поздняя дата означает пропуск срока со ст. 112 в подсказке.
//
// Остальные подтверждаются датой другого рода: у сроков суда (изготовление
// мотивированного решения) поздняя дата — нарушение судом, а не пропуск
// заявителя, и восстановление по ст. 112 к ней неприменимо; у апелляции по делу
// мирового судьи известна только дата апелляционного определения, а не дата
// подачи жалобы.
const MISSED_FROM_FILING = new Set([
  'appeal_general',
  'cassation_ksoyu',
  'cassation_vs',
  'protocol_remarks',
  'simplified_reasoned_request',
  'simplified_appeal',
  'default_judgment_cancellation_request',
  'default_judgment_appeal',
  'mirovoy_reasoned_request',
  'mirovoy_cassation',
]);

/**
 * Помечает рассчитанные сроки: пропущенные (есть дата подачи, и она позже
 * дедлайна) и истёкшие (даты подачи нет, дедлайн в прошлом). Меняет карточки на
 * месте: обе пометки зависят от введённых фактов и текущей даты, расчёт не
 * трогают.
 * @param {object[]} cards
 * @param {object} inputs
 * @param {string|null} today — 'YYYY-MM-DD'; без неё пометки нет.
 */
function markExpired(cards, inputs, today) {
  for (const card of cards) {
    if (card.kind !== 'term' || card.status !== 'computed' || !card.deadline) continue;
    const factInput = ACTION_FACT_INPUT[card.id];
    const fact = factInput ? toISO(inputs?.[factInput]) : null;

    if (fact != null) {
      // Факт есть — дальше судим по нему, а не по календарю. Пропуск
      // устанавливается только там, где этот факт и есть дата подачи.
      if (MISSED_FROM_FILING.has(card.id) && fact > card.deadline) {
        card.status = 'missed';
        card.overdue = { days: daysBetween(card.deadline, fact), norm: 'ст. 112 ГПК РФ' };
      }
      continue;
    }

    if (today == null || card.deadline >= today) continue; // ч. 3 ст. 108 — 24:00
    card.status = 'expired';
    card.expired = { days: daysBetween(card.deadline, today) };
  }
  return cards;
}

// --- Публичная сборка -------------------------------------------------------

/**
 * Собирает структуру для отображения из входных данных.
 * @param {object} inputs — данные из п. 4.1 SPEC.md.
 * @param {{today?: Date|string}} [options] — текущая дата (передаётся явно).
 * @returns {{cards: object[], incomplete: object[], stubs: object[]}}
 *   cards — видимые (рассчитанные) узлы; incomplete — узлы, которым не хватает
 *   данных, с причиной и списком недостающих input; stubs — заглушки (п. 4.4).
 */
export function buildView(inputs, options = {}) {
  const today = options.today != null ? toISO(options.today) : null;
  const stubs = STUBS.map((s) => ({
    id: s.id,
    title: s.title,
    explanation: s.explanation,
    norm: s.norm,
  }));

  if (inputs?.reasoned_decision_date == null) {
    // Цепочку обжалования без даты решения не построить, но независимые сроки в
    // рабочих днях от неё не зависят — показываем их и здесь.
    const independent = independentNodes(inputs ?? {}, today);
    return {
      cards: markExpired(independent.cards, inputs ?? {}, today),
      incomplete: [
        incompleteNode(
          'appeal_general',
          'term',
          APPEAL_GENERAL.title,
          'Не указана дата мотивированного решения — расчёт цепочки обжалования невозможен.',
          missingInputs(['reasoned_decision_date'], inputs ?? {}),
        ),
        ...independent.incomplete,
      ],
      stubs,
    };
  }

  const { card: appealCard } = buildAppealCard(inputs);
  const cards = [appealCard];
  const { cards: downCards, incomplete } = buildDownstream(inputs, today);
  cards.push(...downCards);

  return { cards: markExpired(cards, inputs, today), incomplete, stubs };
}
