// Экспорт сроков в .ics (раздел 8, задача 5 SPEC.md).
//
// Экспортируются только сроки с ics: true. Событие — на весь день в дату
// дедлайна; в нём название срока, дата и норма (в описании). Напоминания —
// по правилам раздела 8: 1 месяц → за 14/7/3 дня; 3 месяца → за 30/14/7/3 дня.
// Дата напоминания на нерабочий день сдвигается НАЗАД, к предыдущему рабочему
// (через календарный модуль). Напоминание раньше даты расчёта не создаётся.

import { shiftBackIfNonWorking, toISODate } from './calendar.js';
import { APPEAL_GENERAL, CASSATION_KSOYU, CASSATION_VS } from './chain.js';

const DAY_MS = 86_400_000;
const PRODID = '-//gpk-calculator//Процессуальные сроки ГПК//RU';

// Правила напоминаний (раздел 8 SPEC.md): дни до дедлайна по длительности срока.
function reminderOffsets(duration) {
  if (duration && duration.unit === 'month' && duration.value === 1) return [14, 7, 3];
  if (duration && duration.unit === 'month' && duration.value === 3) return [30, 14, 7, 3];
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
    const shifted = shiftBackIfNonWorking(addDaysISO(term.deadline, -off));
    if (referenceDate != null && shifted < referenceDate) continue; // раньше даты расчёта
    out.push(shifted);
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
  return terms;
}
