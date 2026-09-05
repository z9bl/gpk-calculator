// Ситуации — разбиение узлов и полей ввода по ветвям для переключателя в UI.
//
// Это чисто представление: расчёт не зависит от выбранной ситуации, buildView
// по-прежнему считает всё сразу. Переключатель лишь решает, что рисовать.
//
// Данные вынесены из web/app.js, чтобы разбиение проверялось тестом: каждый
// узел, который может выдать buildView, должен попадать ровно в одну ситуацию —
// иначе следующий добавленный узел молча окажется невидимым на экране.
//
// В `fields` перечислены одиночные поля ввода ветви (даты, а у периодических
// платежей ещё и чекбокс бессрочности): каждое по тесту принадлежит ровно
// одной ситуации и рисуется над карточками либо в блоке уточняющих дат.
// Списка перерывов срока (`enforcement_interruptions`, ст. 22 ФЗ № 229-ФЗ)
// здесь нет намеренно: это повторяемый список, и один и тот же список нужен
// пяти ситуациям сразу (узлы предъявления ИЛ во всех ветвях и судебный приказ).
// Он привязан не к ситуации, а к карточке — по признаку `interruptible` самого
// срока, поэтому появляется ровно там, где применим.

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
    // Два независимых поля одной процедуры, в порядке самой процедуры: копия
    // приказа получена должником (ст. 128) → возражений в срок нет → приказ
    // выдан взыскателю (ст. 130, ч. 3 ст. 21 ФЗ № 229-ФЗ). Друг от друга поля
    // не зависят: каждый узел считается по своему input, любое из полей можно
    // заполнить отдельно.
    fields: ['court_order_copy_received_date', 'court_order_issued_date'],
    nodes: ['court_order_objection', 'court_order_presentation'],
  },
  {
    id: 'periodic_payments',
    label: 'Периодические платежи',
    // Предъявление к исполнению документов о взыскании периодических платежей
    // (ч. 4 ст. 21 ФЗ № 229-ФЗ) — самостоятельный трек, как и судебный приказ:
    // не часть цепочки обжалования решения суда, своё поле и свой чекбокс
    // бессрочности вместо даты (взаимоисключающие, см. web/app.js).
    fields: ['periodic_payment_period_end_date', 'periodic_payment_indefinite'],
    nodes: ['periodic_payments_presentation'],
  },
  {
    id: 'child_return',
    label: 'Возврат ребёнка / права доступа',
    // Специальная категория дел (глава 22.2 ГПК): дела по международным
    // договорам РФ о возвращении ребёнка и об осуществлении прав доступа.
    // Своя ситуация, а не модификация общей цепочки: сроки обжалования здесь
    // короче общего порядка (10 дней вместо месяца по ст. 321 и вместо
    // пятнадцати дней по ст. 332), и общий узел дал бы неверный результат.
    // Поле ветви — в `fields`, а не `primary_field`: тот зарезервирован за
    // общей ветвью (см. situations.test.js).
    // Два независимых поля, как у судебного приказа: апелляция считается от
    // решения в окончательной форме (ч. 1 ст. 244.17), частная жалоба — от
    // определения суда первой инстанции (ч. 1 ст. 244.18). Друг от друга поля
    // не зависят: любое можно заполнить отдельно.
    fields: ['child_return_reasoned_decision_date', 'child_return_interim_ruling_date'],
    nodes: ['child_return_appeal', 'child_return_private_complaint'],
  },
  {
    id: 'separate',
    label: 'Отдельные сроки (протокол, частная жалоба, возврат кассационной жалобы)',
    // Пул сроков, не привязанных к категории дела: каждый считается по своему
    // input независимо от цепочки обжалования. Обжалование определения о
    // возврате кассационной жалобы (ч. 1 ст. 379.2) — событие стадии кассации,
    // возможное по делу любой категории, поэтому оно здесь, а не в ветви
    // конкретного производства. Единицы сроков в пуле разные: замечания на
    // протокол и частная жалоба — рабочие дни, возврат кассационной жалобы —
    // месяц (ч. 1, 2 ст. 108).
    fields: ['protocol_signed_date', 'interim_ruling_date', 'cassation_return_ruling_date'],
    nodes: [
      'protocol_remarks',
      'protocol_remarks_review',
      'private_complaint',
      'cassation_return_ruling_appeal',
    ],
  },
  {
    id: 'review_new_circumstances',
    label: 'Пересмотр по вновь открывшимся/новым обстоятельствам',
    // Глава 42 ГПК (ст. 392–395) — самостоятельный трек, как «Отдельные сроки»:
    // не часть цепочки обжалования решения суда и не привязан к категории дела.
    // Своё поле — в `fields`, а не `primary_field`: тот зарезервирован за общей
    // ветвью (см. situations.test.js).
    // Основание — dropdown (review_ground, семь вариантов, см. REVIEW_GROUNDS в
    // chain.js) + поле(-я) даты, зависящие от выбора:
    // — шесть простых оснований используют одно общее поле
    //   review_circumstance_date, подпись и норма которого меняются по выбору
    //   (по образцу enforcement_interruptions);
    // — седьмое, «изменение практики ВС» (vs_practice_change, п. 5 ч. 4 ст. 392),
    //   устроено иначе (минимум из двух дат, см. 11.3 SPEC.md) и использует
    //   три своих поля: булев toggle review_discovered_during_cassation
    //   (обнаружено при рассмотрении кассационной/надзорной жалобы) переключает
    //   между review_publication_date и review_refusal_ruling_received_date
    //   (взаимоисключающие, как periodic_payment_indefinite у периодических
    //   платежей), а review_last_act_entry_into_force_date нужна всегда — это
    //   якорь шестимесячного потолка (ч. 3 ст. 394), он не зависит от toggle.
    fields: [
      'review_ground',
      'review_circumstance_date',
      'review_discovered_during_cassation',
      'review_publication_date',
      'review_refusal_ruling_received_date',
      'review_last_act_entry_into_force_date',
    ],
    nodes: ['review_new_circumstances_filing'],
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
