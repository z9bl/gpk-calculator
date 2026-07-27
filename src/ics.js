// Экспорт сроков в .ics (раздел 8, задача 5 SPEC.md).
//
// Экспортируются только сроки с ics: true. Событие — на весь день в дату
// дедлайна; в нём название срока, дата и норма (в описании). Напоминания —
// по правилам раздела 8: 1 месяц → за 14/7/3 дня; 3 месяца → за 30/14/7/3 дня;
// 3 года (предъявление ИЛ) → за 3 месяца/1 месяц/7 дней. Смещения в месяцах
// вычитаются календарно с клампингом на последний день месяца (как addMonths
// движка, в обратную сторону); смещение в 7 дней — календарных, не рабочих.
// Дата напоминания на нерабочий день сдвигается НАЗАД, к предыдущему рабочему
// (через календарный модуль). Напоминание раньше даты расчёта не создаётся.

import { shiftBackIfNonWorking, subtractWorkingDays, toISODate } from './calendar.js';
import { addMonths } from './engine.js';
import {
  APPEAL_GENERAL,
  CASSATION_KSOYU,
  CASSATION_VS,
  ENFORCEMENT_PRESENTATION,
  PROTOCOL_REMARKS,
  PRIVATE_COMPLAINT,
  SIMPLIFIED_REASONED_REQUEST,
  SIMPLIFIED_APPEAL,
  DEFAULT_JUDGMENT_CANCELLATION_REQUEST,
  DEFAULT_JUDGMENT_APPEAL,
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
  const out = [];
  for (const card of (view && view.cards) || []) {
    const meta = TERM_REGISTRY[card.id];
    if (!meta || meta.ics !== true || !card.deadline) continue;
    // Истёкшие сроки не выгружаем: напоминать не о чем. Это не то же, что
    // отсечение прошлых напоминаний по referenceDate — там срок ещё идёт, и
    // событие в файле остаётся, просто без части будильников.
    if (card.status === 'expired') continue;
    out.push({
      title: card.title,
      deadline: card.deadline,
      norm: card.norm,
      ics: true,
      duration: card.duration || meta.duration,
    });
  }
  return out;
}

// Правила напоминаний (раздел 8 SPEC.md) по длительности срока: смещения до
// дедлайна, каждое со своей единицей (день — календарный, месяц — с клампингом).
function reminderOffsets(duration) {
  if (duration && duration.unit === 'month' && duration.value === 1) {
    return [
      { unit: 'day', value: 14 },
      { unit: 'day', value: 7 },
      { unit: 'day', value: 3 },
    ];
  }
  if (duration && duration.unit === 'month' && duration.value === 3) {
    return [
      { unit: 'day', value: 30 },
      { unit: 'day', value: 14 },
      { unit: 'day', value: 7 },
      { unit: 'day', value: 3 },
    ];
  }
  if (duration && duration.unit === 'year' && duration.value === 3) {
    return [
      { unit: 'month', value: 3 },
      { unit: 'month', value: 1 },
      { unit: 'day', value: 7 },
    ];
  }
  // Сроки в рабочих днях: смещения тоже в рабочих днях — календарное смещение
  // на каникулах увело бы напоминание за границу срока.
  if (duration && duration.unit === 'working_day') {
    switch (duration.value) {
      case 3: // заявление мировому судье при явке (п. 1 ч. 4 ст. 199)
        return [{ unit: 'working_day', value: 1 }];
      case 5: // замечания на протокол, заявление по упрощённому производству
        return [{ unit: 'working_day', value: 2 }];
      case 7: // заявление об отмене заочного решения (ч. 1 ст. 237)
        return [
          { unit: 'working_day', value: 3 },
          { unit: 'working_day', value: 1 },
        ];
      case 15: // частная жалоба, апелляция по упрощённому, заявление без явки
        return [
          { unit: 'working_day', value: 7 },
          { unit: 'working_day', value: 3 },
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

function eventLines(term, index, stamp, referenceDate) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${compact(term.deadline)}-${index}@gpk-calculator`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(term.deadline)}`,
    `DTEND;VALUE=DATE:${compact(addDaysISO(term.deadline, 1))}`, // конец исключающий
    `SUMMARY:${esc(term.title)}`,
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
  exported.forEach((term, i) => {
    lines.push(...eventLines(term, i, stamp, referenceDate));
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
