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
// здесь нет намеренно: это повторяемый список, привязанный не к ситуации, а к
// карточке — по признаку `interruptible` самого срока. Сейчас такой срок один
// (узел ситуации «Исполнительное производство»), и список появляется ровно
// там, где применим: не у периодических платежей, к которым ст. 22 не сведена,
// и не у прочих ситуаций, где узлов предъявления больше нет.

export const SITUATIONS = [
  {
    id: 'general',
    label: 'Решение суда в общем порядке',
    // Основное поле ветви — статическое, в разметке страницы. Хранится по id:
    // от его заполненности зависит показ блока уточняющих дат.
    primary_field: 'reasoned_decision_date',
    // *_restoration_circumstance_date — необязательные поля годичного
    // потолка восстановления (ч. 7 ст. 112 ГПК РФ, см.
    // CASSATION_SUPERVISORY_RESTORATION_NODE_IDS в chain.js): заполняются,
    // только если пользователь спрашивает про восстановление пропущенного
    // кассационного/надзорного срока, а не как часть обычного расчёта.
    fields: [
      'vs_ruling_date',
      'cassation_ksoyu_restoration_circumstance_date',
      'cassation_vs_restoration_circumstance_date',
      'supervision_restoration_circumstance_date',
    ],
    nodes: [
      'appeal_general',
      'entry_into_force',
      'cassation_ksoyu',
      'cassation_vs',
      'supervision',
    ],
  },
  {
    id: 'court_order',
    label: 'Приказное производство',
    // Приказное производство (глава 11 ГПК) — самостоятельный трек, не часть
    // цепочки обжалования решения суда: своё поле, как у mirovoy/simplified/
    // default_judgment, а не primary_field — тот зарезервирован за общей
    // веткой (см. тест 'по умолчанию выбран общий порядок' в situations.test.js
    // и статическую разметку общего поля в web/app.js).
    //
    // Узел здесь один — возражения должника (ст. 128) от даты получения копии
    // приказа. Второй узел этой ситуации, предъявление приказа к исполнению
    // (ч. 3 ст. 21 ФЗ № 229-ФЗ), убран вместе со своим полем
    // court_order_issued_date: тот же расчёт от той же даты даёт вариант
    // «судебный приказ» ситуации «Исполнительное производство» ниже, и поле
    // переехало туда. Дублировать предъявление в конце каждой процедуры
    // больше не нужно — вход к нему один.
    fields: ['court_order_copy_received_date'],
    nodes: ['court_order_objection'],
  },
  {
    id: 'mirovoy',
    label: 'Решение мирового судьи',
    // mirovoy_cassation_restoration_circumstance_date — годичный потолок
    // восстановления (ч. 7 ст. 112 ГПК РФ), см. общий комментарий у ветви
    // 'general' выше.
    fields: ['mirovoy_resolution_date', 'mirovoy_cassation_restoration_circumstance_date'],
    nodes: [
      'mirovoy_reasoned_request',
      'mirovoy_reasoned_making',
      'mirovoy_appeal',
      'mirovoy_entry_into_force',
      'mirovoy_cassation',
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
    ],
  },
  {
    id: 'enforcement',
    label: 'Исполнительное производство',
    // Вход для случая, когда исполнительный документ уже на руках: цепочка
    // обжалования не нужна, нужен только срок предъявления к исполнению
    // (ст. 21 ФЗ № 229-ФЗ) с перерывами (ч. 1–3 ст. 22) и вычетами
    // (ч. 3.1 ст. 22) там, где ст. 22 применяется.
    //
    // Первое поле — dropdown с типом документа (три варианта, см.
    // ENFORCEMENT_DOCUMENT_TYPES в chain.js), от него зависят и норма, и то,
    // какое поле даты-якоря показывается, — по образцу review_ground.
    //
    // Периодические платежи (ч. 4 ст. 21) — вариант этого dropdown, а не своя
    // ситуация: прежняя ситуация «Периодические платежи» с узлом
    // periodic_payments_presentation была тонкой обёрткой над тем же расчётом и
    // поглощена целиком, вместе со своими двумя полями — датой окончания
    // периода и чекбоксом бессрочности (взаимоисключающими, см.
    // computeEnforcementDocumentPresentation в chain.js). Оба поля перечислены
    // ниже: теперь они принадлежат этой ситуации.
    //
    // court_order_issued_date (дата выдачи приказа взыскателю, ст. 130 ГПК) —
    // якорь варианта «судебный приказ». Прежде поле принадлежало ситуации
    // «Судебный приказ» и здесь лишь переиспользовалось: перечислить его в
    // двух ситуациях сразу нельзя (инвариант «поля ввода не дублируются между
    // ситуациями», situations.test.js). Теперь узел предъявления в приказном
    // производстве убран, и поле закреплено за этой ситуацией — единственной,
    // где оно что-то открывает. В «Судебном приказе» осталось своё поле
    // (court_order_copy_received_date) и свой узел — возражения должника.
    //
    // На экране поля даты рисует renderEnforcementDocumentFields (web/app.js)
    // по anchor_field выбранного типа, а не перебором этого списка: у трёх
    // типов документа три разных якоря, и одновременно показывается ровно один.
    fields: [
      'enforcement_document_type',
      'enforcement_decision_entry_into_force_date',
      'court_order_issued_date',
      'periodic_payment_period_end_date',
      'periodic_payment_indefinite',
    ],
    nodes: ['enforcement_document_presentation'],
  },
  {
    id: 'separate',
    label: 'Отдельные сроки (протокол, частная жалоба, возврат кассационной жалобы)',
    // Пул сроков, не привязанных к категории дела: каждый считается по своему
    // input независимо от цепочки обжалования. Обжалование определения о
    // возврате кассационной жалобы (ч. 1 ст. 379.2) — событие стадии кассации,
    // возможное по делу любой категории, поэтому оно здесь, а не в ветви
    // конкретного производства. Обжалование определения об утверждении мирового
    // соглашения, заключаемого в процессе исполнения судебного акта
    // (ч. 11 ст. 153.10) — по той же логике: акт, для которого апелляция не
    // предусмотрена, обжалуется сразу в кассацию, независимо от категории
    // дела. Той же логике подчинена кассация на судебный приказ (п. 1 ч. 2
    // ст. 377): она перечислена одним списком с определением об утверждении
    // мирового соглашения в п. 3 ПП ВС РФ от 22.06.2021 № 17, но в отличие от
    // него считается по общему трёхмесячному сроку кассации (ч. 1 ст. 376.1),
    // а не по своей норме срока. Единицы сроков в пуле разные: замечания на
    // протокол и частная жалоба — рабочие дни, все остальные узлы этого пула —
    // месяц или три месяца (ч. 1, 2 ст. 108).
    // Из этого пула выделены две ситуации: «Третейский суд» (четыре узла) и
    // «Признание и исполнение решений иностранных судов» (два узла главы 45) —
    // см. ниже. В обоих случаях узлов набиралось столько, что на экране пула
    // они тонули среди сроков, к их предмету отношения не имеющих. Оба переноса
    // были перегруппировкой, а не правкой расчёта: нормы, якоря и поля узлов не
    // изменились.
    // У судебного приказа дата вступления в силу не вводится, а вычисляется
    // (п. 32 ПП ВС РФ от 27.12.2016 № 62 + ст. 128 ГПК РФ, см. комментарий
    // перед SUDEBNY_PRIKAZ_CASSATION в chain.js): два взаимоисключающих поля,
    // как у periodic_payment_indefinite — sudebny_prikaz_received_date (дата
    // получена напрямую) имеет приоритет, sudebny_prikaz_postal_arrival_date
    // (известна только дата прибытия на почту) используется, только если
    // первое не заполнено.
    // *_restoration_circumstance_date — годичный потолок восстановления
    // (ч. 7 ст. 112 ГПК РФ), см. общий комментарий у ветви 'general' выше;
    // здесь — у двух узлов прямой кассации пула, для которых предусмотрен
    // (settlement_approval_cassation_appeal, sudebny_prikaz_cassation).
    fields: [
      'protocol_signed_date',
      'interim_ruling_date',
      'cassation_return_ruling_date',
      'settlement_approval_ruling_date',
      'settlement_approval_cassation_appeal_restoration_circumstance_date',
      'sudebny_prikaz_received_date',
      'sudebny_prikaz_postal_arrival_date',
      'sudebny_prikaz_cassation_restoration_circumstance_date',
    ],
    nodes: [
      'protocol_remarks',
      'protocol_remarks_review',
      'private_complaint',
      'cassation_return_ruling_appeal',
      'settlement_approval_cassation_appeal',
      'sudebny_prikaz_cassation',
    ],
  },
  {
    id: 'child_cases',
    label: 'Дела о детях (возврат ребёнка, усыновление)',
    // Две специальные категории дел из 11.4 SPEC.md, у которых свои сроки
    // обжалования, короче общего порядка, — под одной ситуацией: возвращение
    // ребёнка и осуществление прав доступа (глава 22.2 ГПК) и усыновление
    // (удочерение) ребёнка (глава 29 ГПК). Прежде это были две отдельные
    // ситуации, child_return и adoption.
    //
    // Это перегруппировка, а не слияние расчётов: у каждого из трёх узлов
    // остались своя норма, свой якорь и своё поле, ни один из них не изменился
    // и не знает про остальные. Общего у категорий ровно одно — обе про детей,
    // и обе дают неверный результат, если считать их общим узлом.
    //
    // Первое поле — dropdown категории (CHILD_CASE_CATEGORIES ниже): от него
    // зависит, какой блок полей показывается, — по образцу review_ground и
    // enforcement_document_type. Отличие от них в том, что там выбор
    // переписывает норму ОДНОГО узла, а здесь выбирает, о какой категории дела
    // идёт речь: узлы разные и остаются разными, dropdown только делит экран.
    // Поле ветви — в `fields`, а не `primary_field`: тот зарезервирован за
    // общей ветвью (см. situations.test.js).
    fields: [
      'child_case_category',
      'child_return_reasoned_decision_date',
      'child_return_interim_ruling_date',
      'adoption_reasoned_decision_date',
    ],
    nodes: ['child_return_appeal', 'child_return_private_complaint', 'adoption_appeal'],
  },
  {
    id: 'default_judgment_foreign_state',
    label: 'Заочное решение против иностранного государства',
    // Глава 45.1 ГПК (ст. 417.10): та же механика главы 22, что и у обычного
    // заочного решения (default_judgment), но с другими числами (2/1/2 месяца
    // вместо 7 рабочих дней/1 месяца) и без деления по субъекту — поэтому
    // отдельная ситуация, а не вариант default_judgment.
    fields: ['foreign_state_default_judgment_service_date'],
    nodes: [
      'foreign_state_default_judgment_cancellation_request',
      'foreign_state_default_judgment_appeal',
      'foreign_state_default_judgment_entry_into_force',
      'foreign_state_default_judgment_cassation_ksoyu',
    ],
  },
  {
    id: 'arbitration',
    label: 'Третейский суд',
    // Все сроки модели, привязанные к третейскому разбирательству, — одной
    // ситуацией. Все четыре узла прежде лежали в пуле «Отдельные сроки»; сюда
    // они переехали как есть, без единой правки нормы, якоря и полей.
    //
    // Это не категория дела, а свой процессуальный трек: ни один из четырёх
    // узлов не встроен в computeChain, каждый считается по своему input
    // (computeIndependentTerms). Узлы перечислены в порядке самой процедуры:
    // постановление о компетенции (ч. 2 ст. 422.1) → заявление об отмене
    // решения третейского суда в суд первой инстанции (ст. 418) → кассация по
    // делу об оспаривании решения (ч. 5 ст. 422) → кассация по выдаче
    // исполнительного листа на принудительное исполнение решения (ч. 5
    // ст. 427).
    //
    // Dropdown'а здесь нет, и это не упущение: все поля показываются сразу
    // списком — тот же принцип, что и у «Отдельных сроков», откуда узлы и
    // приехали. По одному делу пользователь может пройти больше одного из
    // четырёх сценариев подряд (сначала компетенция, потом отмена решения,
    // потом кассация на определение об отмене), и сколько узлов ситуации
    // видно на экране одновременно, столько и должно оставаться видно.
    //
    // arbitration_award_setaside_received_date /
    // arbitration_award_setaside_aware_date — глава 46 ГПК (заявление об
    // отмене решения третейского суда, ст. 418): один узел с двумя
    // взаимоисключающими полями, как у sudebny_prikaz_* в пуле отдельных
    // сроков, — приоритет за received_date (вариант (a), сторона третейского
    // разбирательства), если заполнены оба (см.
    // resolveArbitrationAwardSetasideAnchor в chain.js). Годичный потолок
    // восстановления к узлу не подключён, поэтому своего поля
    // *_restoration_circumstance_date у него нет.
    // *_restoration_circumstance_date — годичный потолок восстановления
    // (ч. 7 ст. 112 ГПК РФ), см. общий комментарий у ветви 'general' выше;
    // здесь — у двух кассационных узлов, для которых он предусмотрен.
    fields: [
      'arbitration_competence_ruling_received_date',
      'arbitration_award_setaside_received_date',
      'arbitration_award_setaside_aware_date',
      'treteisky_osparivanie_entry_into_force_date',
      'treteisky_osparivanie_cassation_restoration_circumstance_date',
      'treteisky_ispollist_entry_into_force_date',
      'treteisky_ispollist_cassation_restoration_circumstance_date',
    ],
    nodes: [
      'arbitration_competence_appeal',
      'arbitration_award_setaside',
      'treteisky_osparivanie_cassation',
      'treteisky_ispollist_cassation',
    ],
  },
  {
    id: 'foreign_judgment',
    label: 'Признание и исполнение решений иностранных судов',
    // Глава 45 ГПК — свой трек: решение выносит иностранный суд, российский суд
    // его только признаёт и приводит в исполнение. Оба узла прежде лежали в
    // пуле «Отдельные сроки»; сюда они переехали как есть, без единой правки
    // нормы, якоря и полей.
    //
    // Не путать с двумя соседними «иностранными» ситуациями, с которыми эта
    // не пересекается ни узлом, ни полем:
    //   — «Заочное решение против иностранного государства»
    //     (default_judgment_foreign_state, глава 45.1) — там решение выносит
    //     РОССИЙСКИЙ суд, а иностранное государство является ответчиком;
    //   — «Третейский суд» (arbitration) — там предмет третейское
    //     разбирательство, а не иностранный суд как источник решения. Узлы
    //     главы 45 сознательно не сведены туда, хотя ст. 416 распространяет
    //     срок ч. 2 ст. 413 и на решения иностранных третейских судов
    //     (арбитражей): срок здесь один на решения ЛЮБОГО иностранного суда, и
    //     третейское разбирательство для него — частный случай, а не предмет.
    //
    // Узлы независимы: у каждого свой input, и ни одна из дат не является
    // входом для другого расчёта. Порядок — порядок самой главы 45: сначала
    // решения, ТРЕБУЮЩИЕ принудительного исполнения (ст. 409–412), затем
    // признание решений, которые его не требуют (ст. 413–415).
    //
    // Dropdown'а здесь нет, как и у «Третейского суда»: оба поля показываются
    // списком, тем же общим рендерером, что и у любой ситуации без своего
    // спец-случая. Годичный потолок восстановления к узлам не подключён (см.
    // комментарий в chain.js перед FOREIGN_JUDGMENT_ENFORCEMENT_PRESENTATION),
    // поэтому полей *_restoration_circumstance_date у них нет.
    fields: ['foreign_judgment_entry_into_force_date', 'foreign_judgment_recognition_aware_date'],
    nodes: ['foreign_judgment_enforcement_presentation', 'foreign_judgment_recognition_objection'],
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
    nodes: ['review_new_circumstances_filing', 'review_new_circumstances_restoration'],
  },
];

// Категории дел ситуации «Дела о детях» — таблица для dropdown'а: что
// показывать и что очищать при переключении.
//
// Предметных свойств расчёта здесь нет намеренно: норма, якорь, длительность и
// единица срока живут в самих узлах (CHILD_RETURN_APPEAL,
// CHILD_RETURN_PRIVATE_COMPLAINT, ADOPTION_APPEAL в chain.js) и от выбора
// категории не зависят — выбор лишь делит поля ситуации на два непересекающихся
// блока. Этим таблица отличается от REVIEW_GROUNDS и ENFORCEMENT_DOCUMENT_TYPES:
// там вариант ПЕРЕПИСЫВАЕТ норму одного узла и таблица предметная, поэтому и
// лежит в chain.js; здесь узлы разные и готовые, и таблица чисто
// интерфейсная — её место рядом с разбиением по ситуациям.
export const CHILD_CASE_CATEGORIES = [
  {
    id: 'child_return',
    label: 'Возвращение ребёнка / осуществление прав доступа (глава 22.2 ГПК)',
    fields: ['child_return_reasoned_decision_date', 'child_return_interim_ruling_date'],
  },
  {
    id: 'adoption',
    label: 'Усыновление (удочерение) ребёнка (глава 29 ГПК)',
    fields: ['adoption_reasoned_decision_date'],
  },
];

/** Категория дела о детях по id; неизвестный id (включая пустой) — null. */
export function childCaseCategoryById(id) {
  return CHILD_CASE_CATEGORIES.find((c) => c.id === id) ?? null;
}

export const DEFAULT_SITUATION = 'general';

// situationById, allSituationNodes, allSituationFields — предметно-независимая
// механика, вынесена в core/view/situations.js (шаг 9 аудита, см.
// docs/core-extraction-audit.md, §4). Здесь остаются только данные ГПК.
