// Сборка карточек для отображения (раздел 8, задача 4а SPEC.md).
//
// Берёт входные данные, считает цепочку и возвращает готовую структуру данных
// для UI: карточки видимых узлов, список неполных узлов («что ещё уточнить») и
// статические заглушки. Никакой вёрстки — только данные.
//
// Прогрессивное раскрытие (вариант А): полностью показываются только узлы, для
// которых достаточно введённых данных; остальные попадают в `incomplete` с
// причиной и названиями недостающих input, а не пустыми полями.

import { computeChain, APPEAL_GENERAL, CASSATION_KSOYU } from './chain.js';
import { computeDeadline } from './engine.js';
import { toISODate } from './calendar.js';

// Названия input (п. 4.1 SPEC.md) для списка «что ещё можно уточнить».
const INPUT_LABELS = {
  reasoned_decision_date: 'Дата изготовления мотивированного решения',
  hearing_end_date: 'Дата окончания разбирательства дела',
  appeal_filed_date: 'Дата подачи апелляционной жалобы',
  appeal_ruling_date: 'Дата принятия апелляционного определения',
  appeal_ruling_reasoned_date: 'Дата изготовления мотивированного апелляционного определения',
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
      '(абз. 2 ч. 3 ст. 107 ГПК РФ). Механика отличается от месячных сроков принципиально.',
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
  {
    id: 'private_complaint',
    title: 'Частная жалоба на определение',
    explanation:
      '15 дней со дня вынесения определения; срок в днях — нерабочие не включаются.',
    norm: 'ст. 332 ГПК РФ',
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
  return {
    id: term.id,
    kind: 'term',
    title: term.title,
    status: 'computed',
    deadline: calc.deadline,
    norm: term.norm.primary,
    details: {
      collapsed: true, // блок «подробнее» свёрнут по умолчанию
      logic: term.logic,
      calculation: term.norm.calculation,
      midnight_rule: term.midnight_rule,
    },
  };
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

function cassationCard(cassation) {
  const card = {
    id: 'cassation_ksoyu',
    kind: 'term',
    title: cassation.title,
    status: 'computed',
    deadline: cassation.deadline,
    norm: cassation.norm.primary,
    details: {
      collapsed: true,
      logic: CASSATION_KSOYU.logic,
      calculation: cassation.norm.calculation,
      midnight_rule: CASSATION_KSOYU.midnight_rule,
    },
  };
  if (cassation.alternative) card.alternative = cassation.alternative;
  return card;
}

// Узлы «вступление в силу» и «кассация» с учётом достаточности данных.
function buildDownstream(inputs, today) {
  const cards = [];
  const incomplete = [];
  const appealed = inputs.appeal_filed_date != null;

  if (appealed) {
    const haveRuling = inputs.appeal_ruling_date != null;
    const haveReasoned = inputs.appeal_ruling_reasoned_date != null;
    if (haveRuling && haveReasoned) {
      const chain = computeChain(inputs, { today });
      cards.push(eventCard(chain.entry_into_force));
      cards.push(cassationCard(chain.cassation));
    } else {
      incomplete.push(
        incompleteNode(
          'entry_into_force',
          'event',
          'Вступление решения в законную силу',
          'Обжаловано — для даты вступления в силу нужна дата апелляционного определения.',
          missingInputs(['appeal_ruling_date'], inputs),
        ),
      );
      incomplete.push(
        incompleteNode(
          'cassation_ksoyu',
          'term',
          CASSATION_KSOYU.title,
          'Кассационный срок считается от даты мотивированного апелляционного определения.',
          missingInputs(['appeal_ruling_reasoned_date'], inputs),
        ),
      );
    }
    return { cards, incomplete };
  }

  // Не обжаловано: для разрешения события нужна текущая дата.
  if (today == null) {
    incomplete.push(
      incompleteNode(
        'entry_into_force',
        'event',
        'Вступление решения в законную силу',
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
  cards.push(eventCard(chain.entry_into_force));
  if (chain.cassation) {
    cards.push(cassationCard(chain.cassation));
  } else {
    // pending: событие не разрешено (condition entry_into_force.resolved).
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
  return { cards, incomplete };
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
    return {
      cards: [],
      incomplete: [
        incompleteNode(
          'appeal_general',
          'term',
          APPEAL_GENERAL.title,
          'Не указана дата мотивированного решения — расчёт невозможен.',
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
