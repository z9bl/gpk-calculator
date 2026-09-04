// Ситуации — разбиение узлов и полей ввода по ветвям для переключателя в UI.
//
// Это чисто представление: расчёт не зависит от выбранной ситуации, buildView
// по-прежнему считает всё сразу. Переключатель лишь решает, что рисовать.
//
// Данные вынесены из web/app.js, чтобы разбиение проверялось тестом: каждый
// узел, который может выдать buildView, должен попадать ровно в одну ситуацию —
// иначе следующий добавленный узел молча окажется невидимым на экране.

export const SITUATIONS = [
  {
    id: 'general',
    label: 'Решение суда в общем порядке',
    // Основное поле ветви — статическое, в разметке страницы. Хранится по id:
    // от его заполненности зависит показ блока уточняющих дат.
    primary_field: 'reasoned_decision_date',
    fields: ['vs_ruling_date'],
    nodes: [
      'appeal_general',
      'entry_into_force',
      'cassation_ksoyu',
      'cassation_vs',
      'enforcement_presentation',
      'supervision',
    ],
  },
  {
    id: 'mirovoy',
    label: 'Решение мирового судьи',
    fields: ['mirovoy_resolution_date'],
    nodes: [
      'mirovoy_reasoned_request',
      'mirovoy_reasoned_making',
      'mirovoy_appeal',
      'mirovoy_entry_into_force',
      'mirovoy_cassation',
      'mirovoy_enforcement_presentation',
    ],
  },
  {
    id: 'simplified',
    label: 'Упрощённое производство',
    fields: ['simplified_resolution_date'],
    nodes: [
      'simplified_reasoned_request',
      'simplified_reasoned_making',
      'simplified_appeal',
      'simplified_entry_into_force',
      'simplified_cassation_ksoyu',
      'simplified_enforcement_presentation',
    ],
  },
  {
    id: 'default_judgment',
    label: 'Заочное решение',
    fields: ['default_judgment_service_date'],
    nodes: [
      'default_judgment_cancellation_request',
      'default_judgment_appeal',
      'default_judgment_entry_into_force',
      'default_judgment_cassation_ksoyu',
      'default_judgment_enforcement_presentation',
    ],
  },
  {
    id: 'court_order',
    label: 'Судебный приказ',
    // Приказное производство (глава 11 ГПК) — самостоятельный трек, не часть
    // цепочки обжалования решения суда: своё поле, как у mirovoy/simplified/
    // default_judgment, а не primary_field — тот зарезервирован за общей
    // веткой (см. тест 'по умолчанию выбран общий порядок' в situations.test.js
    // и статическую разметку общего поля в web/app.js).
    fields: ['court_order_issued_date'],
    nodes: ['court_order_presentation'],
  },
  {
    id: 'separate',
    label: 'Отдельные сроки (протокол, частная жалоба)',
    fields: ['protocol_signed_date', 'interim_ruling_date'],
    nodes: ['protocol_remarks', 'protocol_remarks_review', 'private_complaint'],
  },
];

export const DEFAULT_SITUATION = 'general';

export function situationById(id) {
  return SITUATIONS.find((s) => s.id === id) ?? SITUATIONS[0];
}

/** Все узлы всех ситуаций — в порядке ситуаций и порядке внутри каждой. */
export function allSituationNodes() {
  return SITUATIONS.flatMap((s) => s.nodes);
}

/** Все поля ввода, привязанные к ситуациям (без статического поля общей ветви). */
export function allSituationFields() {
  return SITUATIONS.flatMap((s) => s.fields);
}
