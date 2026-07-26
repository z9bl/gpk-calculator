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
} from './chain.js';

// Заглушки рядом с узлом предъявления ИЛ (ст. 21–22 ФЗ № 229-ФЗ).
const ENFORCEMENT_STUBS = [
  {
    id: 'court_order',
    title: 'Судебный приказ',
    explanation:
      'Три года со дня выдачи судебного приказа, а не со дня вступления в силу.',
    norm: 'ч. 3 ст. 21 ФЗ № 229-ФЗ',
  },
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
import { computeDeadline } from './engine.js';
import { toISODate, calendarNote } from './calendar.js';

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
};

// Заглушки (п. 4.4 SPEC.md) — статические карточки.
const STUBS = [
  {
    id: 'default_judgment',
    title: 'Заочное решение',
    explanation:
      'Отмена — 7 дней со дня вручения копии ответчику; апелляция — месяц со ' +
      'дня определения об отказе в отмене. Точка отсчёта — вручение, а не принятие.',
    norm: 'ч. 1, 2 ст. 237 ГПК РФ',
  },
  {
    id: 'simplified',
    title: 'Упрощённое производство',
    explanation:
      'Апелляция — 15 дней, срок в днях: нерабочие дни не включаются ' +
      '(абз. 2 ч. 3 ст. 107 ГПК РФ). Механика рабочих дней реализована, но эта ' +
      'ветка требует своей точки отсчёта и пока не рассчитывается.',
    norm: 'ч. 8 ст. 232.4 ГПК РФ',
  },
  {
    id: 'justice_of_peace_no_reasoning',
    title: 'Мировой судья без мотивированного решения',
    explanation:
      'Срок зависит от подачи заявления о составлении мотивированного решения ' +
      '(3 или 15 дней в зависимости от присутствия в заседании).',
    norm: 'ч. 4, 5 ст. 199 ГПК РФ, п. 17 ПП ВС РФ № 16',
  },
];

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
function attachCalendarWarning(card) {
  const note = calendarNote(card.deadline);
  if (note) card.calendar_warning = note;
}

function buildAppealCard(inputs) {
  const calc = computeDeadline(APPEAL_GENERAL, inputs.reasoned_decision_date);
  const card = termCard(APPEAL_GENERAL, calc);

  // Предупреждение: мотивированное решение изготовлено позже 10 дней
  // (ч. 2 ст. 199; warn_not_block — считаем от фактической даты, п. 16 ПП ВС № 16).
  if (inputs.hearing_end_date != null) {
    const gap = daysBetween(toISO(inputs.hearing_end_date), calc.anchor);
    if (gap > 10) {
      card.warnings = [
        {
          code: 'reasoned_over_10_days',
          text:
            `Мотивированное решение изготовлено на ${gap}-й день после ` +
            'окончания разбирательства (> 10 дней, ч. 2 ст. 199 ГПК РФ). Срок ' +
            'обжалования считается от фактической даты (п. 16 ПП ВС № 16).',
        },
      ];
    }
  }

  // Проверка «уже подали?»: подача позже дедлайна — срок пропущен (ст. 112 ГПК).
  if (inputs.appeal_filed_date != null) {
    const filed = toISO(inputs.appeal_filed_date);
    if (filed > calc.deadline) {
      card.status = 'missed';
      card.overdue = { days: daysBetween(calc.deadline, filed), norm: 'ст. 112 ГПК РФ' };
    }
  }

  return { card, calc };
}

function eventCard(entry) {
  const card = {
    id: 'entry_into_force',
    kind: 'event',
    title: 'Вступление решения в законную силу',
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

  cards.push(...independentCards(chain));

  return { cards, incomplete };
}

// Карточки независимых сроков в рабочих днях. Принимает либо результат цепочки,
// либо сами inputs — во втором случае считает их сама.
function independentCards(source) {
  const terms =
    source && 'protocol_remarks' in source ? source : computeIndependentTerms(source);
  const cards = [];
  if (terms.protocol_remarks) {
    cards.push(workingDayCard(terms.protocol_remarks));
    if (terms.protocol_remarks_review) {
      cards.push(workingDayCard(terms.protocol_remarks_review, { informational: true }));
    }
  }
  if (terms.private_complaint) cards.push(workingDayCard(terms.private_complaint));
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
    return {
      cards: independentCards(inputs ?? {}),
      incomplete: [
        incompleteNode(
          'appeal_general',
          'term',
          APPEAL_GENERAL.title,
          'Не указана дата мотивированного решения — расчёт цепочки обжалования невозможен.',
          missingInputs(['reasoned_decision_date'], inputs ?? {}),
        ),
      ],
      stubs,
    };
  }

  const { card: appealCard } = buildAppealCard(inputs);
  const cards = [appealCard];
  const { cards: downCards, incomplete } = buildDownstream(inputs, today);
  cards.push(...downCards);

  return { cards, incomplete, stubs };
}
