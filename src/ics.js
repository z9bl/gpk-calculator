// Экспорт сроков ГПК в .ics (раздел 8, задача 5 SPEC.md) — предметная обвязка
// над генератором ядра.
//
// Сама механика iCalendar (сборка, экранирование, свёртка строк, VALARM) живёт
// в core/export/ics.js и о ГПК ничего не знает. Здесь — только предметное:
// идентификаторы продукта, таблица напоминаний и реестр узлов (все три из
// src/term-registry.js) подставляются в общие функции, а icsTermsFromChain
// разбирает результат computeChain по именам полей конкретных процедур ГПК.
//
// Обёртки сохраняют прежние сигнатуры (buildICS(terms, options),
// icsTermsFromView(view), exportableCards(view)), поэтому вызывающий код —
// web/app.js и тесты — от параметризации ядра не зависит.

import {
  buildICS as coreBuildICS,
  icsTermsFromView as coreIcsTermsFromView,
  exportableCards as coreExportableCards,
} from '../core/export/ics.js';
import {
  TERM_REGISTRY,
  ICS_PRODID,
  ICS_UID_DOMAIN,
  reminderOffsets,
} from './term-registry.js';
import {
  APPEAL_GENERAL,
  CASSATION_KSOYU,
  CASSATION_VS,
  ENFORCEMENT_PRESENTATION,
  COURT_ORDER_OBJECTION,
  COURT_ORDER_PRESENTATION,
  PERIODIC_PAYMENTS_PRESENTATION,
  FOREIGN_JUDGMENT_ENFORCEMENT_PRESENTATION,
  FOREIGN_JUDGMENT_RECOGNITION_OBJECTION,
  PROTOCOL_REMARKS,
  PRIVATE_COMPLAINT,
  CHILD_RETURN_APPEAL,
  CHILD_RETURN_PRIVATE_COMPLAINT,
  ADOPTION_APPEAL,
  CASSATION_RETURN_RULING_APPEAL,
  ARBITRATION_COMPETENCE_APPEAL,
  SETTLEMENT_APPROVAL_CASSATION_APPEAL,
  SUDEBNY_PRIKAZ_CASSATION,
  TRETEISKY_OSPARIVANIE_CASSATION,
  TRETEISKY_ISPOLLIST_CASSATION,
  COURT_ARBITRATION_AWARD_SETASIDE,
  REVIEW_NEW_CIRCUMSTANCES_FILING,
  REVIEW_NEW_CIRCUMSTANCES_RESTORATION,
  SIMPLIFIED_REASONED_REQUEST,
  SIMPLIFIED_APPEAL,
  DEFAULT_JUDGMENT_CANCELLATION_REQUEST,
  DEFAULT_JUDGMENT_APPEAL,
  FOREIGN_STATE_DEFAULT_JUDGMENT_CANCELLATION_REQUEST,
  MIROVOY_REASONED_REQUEST,
  MIROVOY_APPEAL,
} from './chain.js';

/**
 * Строит содержимое .ics по срокам ГПК: та же сигнатура, что и раньше
 * (referenceDate, now), предметные параметры ядра подставляются здесь.
 * @param {Array<object>} terms
 * @param {{referenceDate?: string, now?: Date|string}} [options]
 * @returns {string}
 */
export function buildICS(terms, options = {}) {
  return coreBuildICS(terms, {
    ...options,
    prodId: ICS_PRODID,
    uidDomain: ICS_UID_DOMAIN,
    offsets: reminderOffsets,
  });
}

/**
 * Экспортируемые сроки из структуры отображения — по реестру узлов ГПК.
 * @param {{cards: object[]}} view — результат buildView.
 * @returns {Array<object>}
 */
export function icsTermsFromView(view) {
  return coreIcsTermsFromView(view, TERM_REGISTRY);
}

/**
 * Карточки, которые имеет смысл переносить в календарь — по реестру узлов ГПК.
 * @param {{cards: object[]}} view
 * @returns {Array<{card: object, meta: object}>}
 */
export function exportableCards(view) {
  return coreExportableCards(view, TERM_REGISTRY);
}

/**
 * Извлекает экспортируемые сроки из результата computeChain: апелляция всегда,
 * кассация — если рассчитана. Метаданные (ics, duration) берутся из констант.
 * @param {{appeal?:object, cassation?:object|null}} chain
 * @returns {Array<object>}
 */
export function icsTermsFromChain(chain) {
  const terms = [];
  if (chain && chain.appeal && chain.appeal.deadline) {
    terms.push({
      title: chain.appeal.title,
      deadline: chain.appeal.deadline,
      norm: chain.appeal.norm.primary,
      ics: APPEAL_GENERAL.ics,
      duration: APPEAL_GENERAL.duration,
    });
  }
  if (chain && chain.cassation && chain.cassation.deadline) {
    terms.push({
      title: chain.cassation.title,
      deadline: chain.cassation.deadline,
      norm: chain.cassation.norm.primary,
      ics: CASSATION_KSOYU.ics,
      duration: CASSATION_KSOYU.duration,
    });
  }
  if (chain && chain.cassation_vs && chain.cassation_vs.deadline) {
    terms.push({
      title: chain.cassation_vs.title,
      deadline: chain.cassation_vs.deadline,
      norm: chain.cassation_vs.norm.primary,
      ics: CASSATION_VS.ics,
      duration: CASSATION_VS.duration,
    });
  }
  if (chain && chain.enforcement && chain.enforcement.deadline) {
    terms.push({
      title: chain.enforcement.title,
      deadline: chain.enforcement.deadline,
      norm: chain.enforcement.norm.primary,
      ics: ENFORCEMENT_PRESENTATION.ics,
      duration: ENFORCEMENT_PRESENTATION.duration,
    });
  }
  // Сроки в рабочих днях. Правила напоминаний (раздел 8) заданы только для
  // месячных и годовых сроков — у этих событий напоминаний нет, только сам
  // дедлайн в календаре. Срок рассмотрения замечаний судьёй — ics: false
  // (срок суда, справочный), поэтому в экспорт не попадает.
  if (chain && chain.protocol_remarks && chain.protocol_remarks.deadline) {
    terms.push({
      title: chain.protocol_remarks.title,
      deadline: chain.protocol_remarks.deadline,
      norm: chain.protocol_remarks.norm.primary,
      ics: PROTOCOL_REMARKS.ics,
      duration: PROTOCOL_REMARKS.duration,
    });
  }
  if (chain && chain.private_complaint && chain.private_complaint.deadline) {
    terms.push({
      title: chain.private_complaint.title,
      deadline: chain.private_complaint.deadline,
      norm: chain.private_complaint.norm.primary,
      ics: PRIVATE_COMPLAINT.ics,
      duration: PRIVATE_COMPLAINT.duration,
    });
  }
  // Дела о возвращении ребёнка / осуществлении прав доступа (глава 22.2
  // ГПК) — два независимых узла со своими input: апелляция от решения в
  // окончательной форме (ч. 1 ст. 244.17), частная жалоба от определения суда
  // первой инстанции (ч. 1 ст. 244.18). Оба в рабочих днях.
  if (chain && chain.child_return_appeal && chain.child_return_appeal.deadline) {
    terms.push({
      title: chain.child_return_appeal.title,
      deadline: chain.child_return_appeal.deadline,
      norm: chain.child_return_appeal.norm.primary,
      ics: CHILD_RETURN_APPEAL.ics,
      duration: CHILD_RETURN_APPEAL.duration,
    });
  }
  if (
    chain &&
    chain.child_return_private_complaint &&
    chain.child_return_private_complaint.deadline
  ) {
    terms.push({
      title: chain.child_return_private_complaint.title,
      deadline: chain.child_return_private_complaint.deadline,
      norm: chain.child_return_private_complaint.norm.primary,
      ics: CHILD_RETURN_PRIVATE_COMPLAINT.ics,
      duration: CHILD_RETURN_PRIVATE_COMPLAINT.duration,
    });
  }
  // Дела об усыновлении (глава 29 ГПК) — независимый узел: апелляция от
  // решения в окончательной форме (ч. 2.1 ст. 274), рабочие дни.
  if (chain && chain.adoption_appeal && chain.adoption_appeal.deadline) {
    terms.push({
      title: chain.adoption_appeal.title,
      deadline: chain.adoption_appeal.deadline,
      norm: chain.adoption_appeal.norm.primary,
      ics: ADOPTION_APPEAL.ics,
      duration: ADOPTION_APPEAL.duration,
    });
  }
  // Обжалование определения о возврате кассационной жалобы (ч. 1 ст. 379.2
  // ГПК) — независимый узел стадии кассации: считается по своему input
  // (cassation_return_ruling_date) и не привязан к категории дела.
  if (
    chain &&
    chain.cassation_return_ruling_appeal &&
    chain.cassation_return_ruling_appeal.deadline
  ) {
    terms.push({
      title: chain.cassation_return_ruling_appeal.title,
      deadline: chain.cassation_return_ruling_appeal.deadline,
      norm: chain.cassation_return_ruling_appeal.norm.primary,
      ics: CASSATION_RETURN_RULING_APPEAL.ics,
      duration: CASSATION_RETURN_RULING_APPEAL.duration,
    });
  }
  // Отмена постановления третейского суда о компетенции (ч. 2 ст. 422.1
  // ГПК) — независимый узел: считается по своему input
  // (arbitration_competence_ruling_received_date), не привязан к категории
  // дела. Якорь — дата получения постановления стороной, а не вынесения.
  if (
    chain &&
    chain.arbitration_competence_appeal &&
    chain.arbitration_competence_appeal.deadline
  ) {
    terms.push({
      title: chain.arbitration_competence_appeal.title,
      deadline: chain.arbitration_competence_appeal.deadline,
      norm: chain.arbitration_competence_appeal.norm.primary,
      ics: ARBITRATION_COMPETENCE_APPEAL.ics,
      duration: ARBITRATION_COMPETENCE_APPEAL.duration,
    });
  }
  // Обжалование определения об утверждении мирового соглашения, заключаемого
  // в процессе исполнения судебного акта (ч. 11 ст. 153.10 ГПК) — независимый
  // узел: акт, для которого апелляционное обжалование не предусмотрено,
  // обжалуется сразу в кассацию, считается по своему input
  // (settlement_approval_ruling_date), не привязан к категории дела.
  if (
    chain &&
    chain.settlement_approval_cassation_appeal &&
    chain.settlement_approval_cassation_appeal.deadline
  ) {
    terms.push({
      title: chain.settlement_approval_cassation_appeal.title,
      deadline: chain.settlement_approval_cassation_appeal.deadline,
      norm: chain.settlement_approval_cassation_appeal.norm.primary,
      ics: SETTLEMENT_APPROVAL_CASSATION_APPEAL.ics,
      duration: SETTLEMENT_APPROVAL_CASSATION_APPEAL.duration,
    });
  }
  // Прямая кассация, минуя апелляцию, по общему трёхмесячному сроку
  // (ч. 1 ст. 376.1) — три независимых узла по той же логике, что и
  // settlement_approval_cassation_appeal выше: судебный приказ, определения по
  // делам об оспаривании решений третейских судов и о выдаче/отказе в выдаче
  // исполнительного листа на принудительное исполнение решения третейского
  // суда (п. 3 ПП ВС РФ от 22.06.2021 № 17).
  if (chain && chain.sudebny_prikaz_cassation && chain.sudebny_prikaz_cassation.deadline) {
    terms.push({
      title: chain.sudebny_prikaz_cassation.title,
      deadline: chain.sudebny_prikaz_cassation.deadline,
      norm: chain.sudebny_prikaz_cassation.norm.primary,
      ics: SUDEBNY_PRIKAZ_CASSATION.ics,
      duration: SUDEBNY_PRIKAZ_CASSATION.duration,
    });
  }
  if (
    chain &&
    chain.treteisky_osparivanie_cassation &&
    chain.treteisky_osparivanie_cassation.deadline
  ) {
    terms.push({
      title: chain.treteisky_osparivanie_cassation.title,
      deadline: chain.treteisky_osparivanie_cassation.deadline,
      norm: chain.treteisky_osparivanie_cassation.norm.primary,
      ics: TRETEISKY_OSPARIVANIE_CASSATION.ics,
      duration: TRETEISKY_OSPARIVANIE_CASSATION.duration,
    });
  }
  if (
    chain &&
    chain.treteisky_ispollist_cassation &&
    chain.treteisky_ispollist_cassation.deadline
  ) {
    terms.push({
      title: chain.treteisky_ispollist_cassation.title,
      deadline: chain.treteisky_ispollist_cassation.deadline,
      norm: chain.treteisky_ispollist_cassation.norm.primary,
      ics: TRETEISKY_ISPOLLIST_CASSATION.ics,
      duration: TRETEISKY_ISPOLLIST_CASSATION.duration,
    });
  }
  // Заявление об отмене решения третейского суда (глава 46, ч. 2, 3 ст. 418
  // ГПК) — независимый узел: первая стадия того же процесса, что и
  // treteisky_osparivanie_cassation выше, но якорь вводится напрямую одним из
  // двух альтернативных полей (см. комментарий в chain.js), не вычисляется
  // из другого узла цепочки.
  if (chain && chain.arbitration_award_setaside && chain.arbitration_award_setaside.deadline) {
    terms.push({
      title: chain.arbitration_award_setaside.title,
      deadline: chain.arbitration_award_setaside.deadline,
      norm: chain.arbitration_award_setaside.norm.primary,
      ics: COURT_ARBITRATION_AWARD_SETASIDE.ics,
      duration: COURT_ARBITRATION_AWARD_SETASIDE.duration,
    });
  }
  // Пересмотр по вновь открывшимся/новым обстоятельствам (глава 42 ГПК) —
  // независимый узел: считается по своим input (review_ground + дата(-ы)),
  // норма в экспорте — та, что соответствует выбранному основанию (см.
  // REVIEW_GROUNDS в chain.js). Длительность берётся из самого узла, а не из
  // статической константы: у практики ВС (vs_practice_change) она не
  // фиксирована — 3 или 6 месяцев, в зависимости от того, какой из двух
  // компонентов контролирует (см. computeVsPracticeChangeTerm), и это решает
  // правило напоминаний (reminderOffsets). У остальных шести оснований
  // duration узла всегда совпадает с REVIEW_NEW_CIRCUMSTANCES_FILING.duration.
  if (
    chain &&
    chain.review_new_circumstances_filing &&
    chain.review_new_circumstances_filing.deadline
  ) {
    terms.push({
      title: chain.review_new_circumstances_filing.title,
      deadline: chain.review_new_circumstances_filing.deadline,
      norm: chain.review_new_circumstances_filing.norm.primary,
      ics: REVIEW_NEW_CIRCUMSTANCES_FILING.ics,
      duration: chain.review_new_circumstances_filing.duration,
    });
  }
  // Восстановление пропущенного срока подачи заявления о пересмотре
  // (ч. 2 ст. 394 ГПК) — независимый резервный узел, считается от того же
  // якоря, что и review_new_circumstances_filing (см. chain.js).
  if (
    chain &&
    chain.review_new_circumstances_restoration &&
    chain.review_new_circumstances_restoration.deadline
  ) {
    terms.push({
      title: chain.review_new_circumstances_restoration.title,
      deadline: chain.review_new_circumstances_restoration.deadline,
      norm: chain.review_new_circumstances_restoration.norm.primary,
      ics: REVIEW_NEW_CIRCUMSTANCES_RESTORATION.ics,
      duration: REVIEW_NEW_CIRCUMSTANCES_RESTORATION.duration,
    });
  }
  // Возражения должника относительно исполнения судебного приказа (ст. 128
  // ГПК) — независимый узел приказного производства, считается по своему input
  // (court_order_copy_received_date), отдельно от срока предъявления приказа к
  // исполнению.
  if (chain && chain.court_order_objection && chain.court_order_objection.deadline) {
    terms.push({
      title: chain.court_order_objection.title,
      deadline: chain.court_order_objection.deadline,
      norm: chain.court_order_objection.norm.primary,
      ics: COURT_ORDER_OBJECTION.ics,
      duration: COURT_ORDER_OBJECTION.duration,
    });
  }
  // Предъявление судебного приказа к исполнению (ч. 3 ст. 21 ФЗ № 229-ФЗ) —
  // независимый узел (глава 11 ГПК вне цепочки обжалования), считается по
  // своему input (court_order_issued_date).
  if (chain && chain.court_order_presentation && chain.court_order_presentation.deadline) {
    terms.push({
      title: chain.court_order_presentation.title,
      deadline: chain.court_order_presentation.deadline,
      norm: chain.court_order_presentation.norm.primary,
      ics: COURT_ORDER_PRESENTATION.ics,
      duration: COURT_ORDER_PRESENTATION.duration,
    });
  }
  // Предъявление документов о взыскании периодических платежей (ч. 4 ст. 21
  // ФЗ № 229-ФЗ) — независимый узел, считается по своему input
  // (periodic_payment_period_end_date). В ветке not_applicable (бессрочное
  // взыскание) deadline нет — в экспорт узел не попадает.
  if (
    chain &&
    chain.periodic_payments_presentation &&
    chain.periodic_payments_presentation.deadline
  ) {
    terms.push({
      title: chain.periodic_payments_presentation.title,
      deadline: chain.periodic_payments_presentation.deadline,
      norm: chain.periodic_payments_presentation.norm.primary,
      ics: PERIODIC_PAYMENTS_PRESENTATION.ics,
      duration: PERIODIC_PAYMENTS_PRESENTATION.duration,
    });
  }
  // Признание и исполнение решений иностранных судов (глава 45 ГПК) — два
  // независимых узла, каждый считается по своему input: предъявление решения
  // к принудительному исполнению (ч. 3 ст. 409, три года со дня вступления
  // решения в законную силу) и возражения относительно признания решения, не
  // требующего принудительного исполнения (ч. 2 ст. 413, один месяц со дня,
  // когда заинтересованному лицу стало известно о решении).
  if (
    chain &&
    chain.foreign_judgment_enforcement_presentation &&
    chain.foreign_judgment_enforcement_presentation.deadline
  ) {
    terms.push({
      title: chain.foreign_judgment_enforcement_presentation.title,
      deadline: chain.foreign_judgment_enforcement_presentation.deadline,
      norm: chain.foreign_judgment_enforcement_presentation.norm.primary,
      ics: FOREIGN_JUDGMENT_ENFORCEMENT_PRESENTATION.ics,
      duration: FOREIGN_JUDGMENT_ENFORCEMENT_PRESENTATION.duration,
    });
  }
  if (
    chain &&
    chain.foreign_judgment_recognition_objection &&
    chain.foreign_judgment_recognition_objection.deadline
  ) {
    terms.push({
      title: chain.foreign_judgment_recognition_objection.title,
      deadline: chain.foreign_judgment_recognition_objection.deadline,
      norm: chain.foreign_judgment_recognition_objection.norm.primary,
      ics: FOREIGN_JUDGMENT_RECOGNITION_OBJECTION.ics,
      duration: FOREIGN_JUDGMENT_RECOGNITION_OBJECTION.duration,
    });
  }
  // Упрощённое производство: заявление о мотивированном решении и апелляция.
  // Срок изготовления решения судом — ics: false (справочный), не экспортируется.
  if (chain && chain.simplified) {
    const s = chain.simplified;
    terms.push({
      title: s.reasoned_request.title,
      deadline: s.reasoned_request.deadline,
      norm: s.reasoned_request.norm.primary,
      ics: SIMPLIFIED_REASONED_REQUEST.ics,
      duration: SIMPLIFIED_REASONED_REQUEST.duration,
    });
    terms.push({
      title: s.appeal.title,
      deadline: s.appeal.deadline,
      norm: s.appeal.norm.primary,
      ics: SIMPLIFIED_APPEAL.ics,
      duration: SIMPLIFIED_APPEAL.duration,
    });
  }
  // Заочное решение (ст. 237): заявление об отмене и апелляция.
  if (chain && chain.default_judgment) {
    const dj = chain.default_judgment;
    terms.push({
      title: dj.cancellation_request.title,
      deadline: dj.cancellation_request.deadline,
      norm: dj.cancellation_request.norm.primary,
      ics: DEFAULT_JUDGMENT_CANCELLATION_REQUEST.ics,
      duration: DEFAULT_JUDGMENT_CANCELLATION_REQUEST.duration,
    });
    if (dj.appeal) {
      terms.push({
        title: dj.appeal.title,
        deadline: dj.appeal.deadline,
        norm: dj.appeal.norm.primary,
        ics: DEFAULT_JUDGMENT_APPEAL.ics,
        duration: DEFAULT_JUDGMENT_APPEAL.duration,
      });
    }
  }
  // Заочное решение против иностранного государства (ч. 1–4 ст. 417.10):
  // заявление об отмене и апелляция — та же структура, что у обычного
  // заочного решения выше, с другими числами.
  if (chain && chain.default_judgment_foreign_state) {
    const fdj = chain.default_judgment_foreign_state;
    terms.push({
      title: fdj.cancellation_request.title,
      deadline: fdj.cancellation_request.deadline,
      norm: fdj.cancellation_request.norm.primary,
      ics: FOREIGN_STATE_DEFAULT_JUDGMENT_CANCELLATION_REQUEST.ics,
      duration: FOREIGN_STATE_DEFAULT_JUDGMENT_CANCELLATION_REQUEST.duration,
    });
    if (fdj.appeal) {
      terms.push({
        title: fdj.appeal.title,
        deadline: fdj.appeal.deadline,
        norm: fdj.appeal.norm.primary,
        ics: true,
        // Длительность зависит от режима (1 или 2 месяца, ч. 4 ст. 417.10) —
        // берём фактическую, не статичную константу (как у mirovoy.reasoned_request
        // выше — там тоже длительность зависит от явки, а не фиксирована).
        duration: fdj.appeal.duration,
      });
    }
  }
  // Мировой судья (ч. 3–5 ст. 199): заявление и апелляция. Срок составления
  // решения судьёй — ics: false (справочный).
  if (chain && chain.mirovoy) {
    const m = chain.mirovoy;
    terms.push({
      title: m.reasoned_request.title,
      deadline: m.reasoned_request.deadline,
      norm: m.reasoned_request.norm.primary,
      ics: MIROVOY_REASONED_REQUEST.ics,
      // Длительность зависит от явки — берём фактическую для правил напоминаний.
      duration: { value: m.attendance === 'absent' ? 15 : 3, unit: 'working_day' },
    });
    terms.push({
      title: m.appeal.title,
      deadline: m.appeal.deadline,
      norm: m.appeal.norm.primary,
      ics: MIROVOY_APPEAL.ics,
      duration: MIROVOY_APPEAL.duration,
    });
  }
  return terms;
}
