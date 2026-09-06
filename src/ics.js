// Экспорт сроков в .ics (раздел 8, задача 5 SPEC.md).
//
// Экспортируются только сроки с ics: true. Событие — на весь день в дату
// дедлайна; в нём название срока, дата и норма (в описании). Напоминания —
// по правилам раздела 8, не больше двух на событие и от ближайшего к дедлайну
// к более раннему (календари обрезают список молча, см. reminderOffsets).
// Смещения в месяцах вычитаются календарно с клампингом на последний день
// месяца (как addMonths движка, в обратную сторону); смещения в днях —
// календарные, кроме сроков в рабочих днях. Дата напоминания на нерабочий день
// сдвигается НАЗАД, к предыдущему рабочему (через календарный модуль).
// Напоминание раньше даты расчёта не создаётся.

import { shiftBackIfNonWorking, subtractWorkingDays, toISODate } from '../core/calendar/calendar.js';
import { addMonths } from '../core/engine/engine.js';
import { calendarEventTitle } from '../core/export/links.js';
import {
  APPEAL_GENERAL,
  CASSATION_KSOYU,
  CASSATION_VS,
  ENFORCEMENT_PRESENTATION,
  COURT_ORDER_OBJECTION,
  COURT_ORDER_PRESENTATION,
  PERIODIC_PAYMENTS_PRESENTATION,
  PROTOCOL_REMARKS,
  PRIVATE_COMPLAINT,
  CHILD_RETURN_APPEAL,
  CHILD_RETURN_PRIVATE_COMPLAINT,
  ADOPTION_APPEAL,
  CASSATION_RETURN_RULING_APPEAL,
  ARBITRATION_COMPETENCE_APPEAL,
  SETTLEMENT_APPROVAL_CASSATION_APPEAL,
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

import * as chainModule from './chain.js';

const DAY_MS = 86_400_000;
const PRODID = '-//gpk-calculator//Процессуальные сроки ГПК//RU';

/**
 * Реестр сроков по id узла. Собирается автоматически из экспортов chain.js,
 * поэтому новый узел не может выпасть из экспорта .ics молча — он попадает в
 * реестр вместе с самим определением срока.
 */
export const TERM_REGISTRY = Object.fromEntries(
  Object.values(chainModule)
    .filter(
      (v) =>
        v && typeof v === 'object' && typeof v.id === 'string' && v.duration && 'ics' in v,
    )
    .map((term) => [term.id, term]),
);

/**
 * Экспортируемые сроки из структуры отображения: рассчитанные (есть дедлайн) и
 * с ics: true. Длительность берётся из самой карточки, если она её несёт (она
 * может отличаться от константы — например, 3 или 15 рабочих дней у заявления
 * мировому судье в зависимости от явки), иначе из реестра.
 * @param {{cards: object[]}} view — результат buildView.
 * @returns {Array<object>} сроки для buildICS.
 */
export function icsTermsFromView(view) {
  return exportableCards(view).map(({ card, meta }) => ({
    title: card.title,
    deadline: card.deadline,
    norm: card.norm,
    ics: true,
    duration: card.duration || meta.duration,
  }));
}

/**
 * Карточки, которые имеет смысл переносить в календарь. Общий отбор для всех
 * способов переноса — .ics, ссылки в Google Календарь и текстового списка,
 * чтобы они не расходились между собой.
 * @param {{cards: object[]}} view
 * @returns {Array<{card: object, meta: object}>}
 */
export function exportableCards(view) {
  const out = [];
  for (const card of (view && view.cards) || []) {
    const meta = TERM_REGISTRY[card.id];
    if (!meta || meta.ics !== true || !card.deadline) continue;
    // Истёкшие и пропущенные сроки не переносим: напоминать не о чем. Это не то
    // же, что отсечение прошлых напоминаний по referenceDate — там срок ещё
    // идёт, и событие в файле остаётся, просто без части будильников.
    if (card.status === 'expired' || card.status === 'missed') continue;
    out.push({ card, meta });
  }
  return out;
}

// Правила напоминаний (раздел 8 SPEC.md) по длительности срока: смещения до
// дедлайна, каждое со своей единицей (день — календарный, месяц — с клампингом).
//
// Не больше двух на событие: календари обрезают список молча и отбрасывают
// именно последние — ближайшие к дедлайну и самые нужные (iOS показывает два,
// Outlook одно, проверено на устройствах). Поэтому смещения перечислены от
// ближайшего к дедлайну к более раннему: если календарь оставит одно, останется
// то, которое важнее.
function reminderOffsets(duration) {
  if (duration && duration.unit === 'month' && duration.value === 1) {
    return [
      { unit: 'day', value: 3 },
      { unit: 'day', value: 7 },
    ];
  }
  if (duration && duration.unit === 'month' && duration.value === 3) {
    return [
      { unit: 'day', value: 3 },
      { unit: 'day', value: 14 },
    ];
  }
  // Шесть месяцев: только у практики ВС (vs_practice_change, п. 5 ч. 4 ст. 392),
  // когда шестимесячный потолок ч. 3 ст. 394 оказывается контролирующим —
  // остальные узлы такой длительности не имеют. Тот же принцип, что у прочих
  // месячных сроков (ближнее напоминание не растёт, дальнее — растёт вместе со
  // сроком): ближнее держим на уровне трёхмесячного (3 дня), дальнее продлеваем
  // до месяца — запас пропорционален более длинному сроку.
  if (duration && duration.unit === 'month' && duration.value === 6) {
    return [
      { unit: 'day', value: 3 },
      { unit: 'day', value: 30 },
    ];
  }
  if (duration && duration.unit === 'year' && duration.value === 3) {
    return [
      { unit: 'day', value: 7 },
      { unit: 'month', value: 1 },
    ];
  }
  // Сроки в рабочих днях: смещения тоже в рабочих днях — календарное смещение
  // на каникулах увело бы напоминание за границу срока.
  if (duration && duration.unit === 'working_day') {
    switch (duration.value) {
      case 3: // заявление мировому судье при явке (п. 1 ч. 4 ст. 199)
        return [{ unit: 'working_day', value: 1 }];
      case 5: // замечания на протокол, заявление по упрощённому производству
      case 7: // заявление об отмене заочного решения (ч. 1 ст. 237)
        return [
          { unit: 'working_day', value: 1 },
          { unit: 'working_day', value: 2 },
        ];
      case 10: // возражения должника на судебный приказ (ст. 128)
        return [
          { unit: 'working_day', value: 2 },
          { unit: 'working_day', value: 5 },
        ];
      case 15: // частная жалоба, апелляция по упрощённому, заявление без явки
        return [
          { unit: 'working_day', value: 3 },
          { unit: 'working_day', value: 7 },
        ];
      default:
        return [];
    }
  }
  return [];
}

// --- Даты -------------------------------------------------------------------

function toDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDaysISO(iso, n) {
  return toISODate(new Date(toDate(iso).getTime() + n * DAY_MS));
}
// Смещение назад от дедлайна на одно правило напоминания.
function offsetBackISO(deadlineISO, off) {
  if (off.unit === 'month') return toISODate(addMonths(deadlineISO, -off.value));
  if (off.unit === 'working_day') return subtractWorkingDays(deadlineISO, off.value);
  return addDaysISO(deadlineISO, -off.value);
}
function compact(iso) {
  return iso.replace(/-/g, ''); // YYYY-MM-DD → YYYYMMDD
}
function stampUTC(value) {
  const d = value instanceof Date ? value : value ? new Date(value) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

// --- Текст iCalendar --------------------------------------------------------

// Экранирование значений (RFC 5545 §3.3.11).
function esc(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Свёртка строки до 75 октетов (RFC 5545 §3.1); продолжение — с пробела.
function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const chunks = [];
  let chunk = '';
  let bytes = 0;
  for (const ch of line) {
    const cb = enc.encode(ch).length;
    const max = chunks.length === 0 ? 75 : 74; // на продолжении 1 октет — пробел
    if (bytes + cb > max) {
      chunks.push(chunk);
      chunk = ch;
      bytes = cb;
    } else {
      chunk += ch;
      bytes += cb;
    }
  }
  chunks.push(chunk);
  return chunks[0] + chunks.slice(1).map((c) => `\r\n ${c}`).join('');
}

// --- Сборка -----------------------------------------------------------------

// Даты напоминаний для одного срока: сдвиг назад с нерабочих, отсев прошлого.
function reminderDates(term, referenceDate) {
  const out = [];
  for (const off of reminderOffsets(term.duration)) {
    const raw = offsetBackISO(term.deadline, off);
    // Смещение в рабочих днях уже даёт рабочий день — сдвигать нечего (как и с
    // дедлайном срока в рабочих днях). Календарные смещения сдвигаем назад.
    const date = off.unit === 'working_day' ? raw : shiftBackIfNonWorking(raw);
    if (referenceDate != null && date < referenceDate) continue; // раньше даты расчёта
    out.push(date);
  }
  return [...new Set(out)]; // после сдвига даты могут совпасть
}

// Метка выгрузки для UID. Без неё UID складывался из даты и порядкового номера,
// и расчёты по разным делам с совпадающими датами перезаписывали друг друга в
// календаре: два файла с апелляцией на одну дату давали одно событие.
function exportToken() {
  const rnd = globalThis.crypto?.randomUUID?.();
  if (rnd) return rnd.replace(/-/g, '').slice(0, 12);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function eventLines(term, index, stamp, referenceDate, token) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${compact(term.deadline)}-${index}-${token}@gpk-calculator`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(term.deadline)}`,
    `DTEND;VALUE=DATE:${compact(addDaysISO(term.deadline, 1))}`, // конец исключающий
    `SUMMARY:${esc(calendarEventTitle(term.title))}`,
    `DESCRIPTION:${esc(`Норма: ${term.norm}`)}`,
    'TRANSP:TRANSPARENT',
  ];
  for (const r of reminderDates(term, referenceDate)) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(`${term.title} — напоминание о сроке`)}`,
      `TRIGGER;VALUE=DATE-TIME:${compact(r)}T090000Z`,
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT');
  return lines;
}

/**
 * Строит содержимое .ics.
 * @param {Array<{title,deadline,norm,ics,duration:{value,unit}}>} terms — сроки;
 *   deadline и все даты — 'YYYY-MM-DD'.
 * @param {{referenceDate?: string, now?: Date|string}} [options]
 *   referenceDate — дата расчёта: напоминания раньше неё не создаются;
 *   now — значение DTSTAMP (по умолчанию текущее время).
 * @returns {string} текст файла с CRLF-переводами строк.
 */
export function buildICS(terms, options = {}) {
  const { referenceDate = null, now } = options;
  const stamp = stampUTC(now);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  const exported = (terms || []).filter((t) => t && t.ics === true);
  const token = exportToken(); // одна метка на выгрузку — события файла связаны
  exported.forEach((term, i) => {
    lines.push(...eventLines(term, i, stamp, referenceDate, token));
  });

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
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
