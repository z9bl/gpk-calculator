// Генератор iCalendar (RFC 5545). Предметно-независимо: собирает файл из уже
// посчитанных сроков и ничего не знает ни о каком процессуальном кодексе, ни о
// конкретных узлах.
//
// Всё предметное принимается параметрами и не имеет значений по умолчанию:
// идентификаторы продукта (prodId, uidDomain) и таблица правил напоминаний
// (offsets). Ядро не подставляет их молча — иначе файл, собранный чужим
// модулем, уехал бы с чужим PRODID или без единого напоминания, и заметить это
// можно было бы только в чужом календаре (тот же принцип, что у
// restoration_norm в core/view/cards.js).
//
// Событие — на весь день в дату дедлайна; в нём название срока, дата и норма
// (в описании). Смещения напоминаний в месяцах вычитаются календарно с
// клампингом на последний день месяца (как addMonths движка, в обратную
// сторону); смещения в днях — календарные, кроме сроков в рабочих днях. Дата
// напоминания на нерабочий день сдвигается НАЗАД, к предыдущему рабочему (через
// календарный модуль). Напоминание раньше даты расчёта не создаётся.

import { shiftBackIfNonWorking, subtractWorkingDays, toISODate } from '../calendar/calendar.js';
import { addMonths } from '../engine/engine.js';
import { calendarEventTitle } from './links.js';

const DAY_MS = 86_400_000;

/**
 * Реестр сроков из экспортов модуля определений: отбирает те, что выглядят как
 * определение срока с признаком экспорта.
 *
 * Принимает УЖЕ импортированный объект-неймспейс (результат `import * as X`), а
 * не путь к модулю: сам импорт предметного модуля остаётся на стороне этого
 * модуля, ядро ничего не импортирует. Свойство «новый узел не может выпасть из
 * экспорта молча» при этом сохраняется — оно даёт не ядро, а исчерпывающий
 * `import *` на вызывающей стороне: узел попадает в реестр вместе с самим
 * определением срока, добавлять его в список вручную не нужно.
 *
 * @param {object} moduleExports — неймспейс модуля (`import * as m from ...`).
 * @param {{filter?: (value: any) => boolean}} [options] — свой предикат отбора;
 *   по умолчанию: объект со строковым id, непустым duration и полем ics.
 * @returns {Array<object>} подходящие записи в порядке экспортов модуля.
 */
export function buildTermRegistry(moduleExports, options = {}) {
  const filter =
    options.filter ||
    ((v) => v && typeof v === 'object' && typeof v.id === 'string' && v.duration && 'ics' in v);
  return Object.values(moduleExports || {}).filter(filter);
}

/**
 * Экспортируемые сроки из структуры отображения: рассчитанные (есть дедлайн) и
 * с ics: true. Длительность берётся из самой карточки, если она её несёт (она
 * может отличаться от константы — например, когда длительность срока зависит от
 * обстоятельств дела), иначе из реестра.
 *
 * Для спорных сроков (card.alternative — норма и разъяснение Пленума
 * расходятся в дате) в календарь уходит рекомендованная, более ранняя дата
 * вместе с её нормой, а не card.deadline/card.norm «по закону» — чтобы норма в
 * описании события не разошлась с датой рядом с ней. Сводка для копирования и
 * печати (caseSummaryItems/Lines) — отдельный канал, показывает обе даты.
 * @param {{cards: object[]}} view — результат buildView.
 * @param {Record<string, object>} registry — реестр сроков по id узла.
 * @returns {Array<object>} сроки для buildICS.
 */
export function icsTermsFromView(view, registry) {
  return exportableCards(view, registry).map(({ card, meta }) => ({
    title: card.title,
    deadline: card.alternative ? card.alternative.deadline : card.deadline,
    norm: card.alternative ? card.alternative.norm : card.norm,
    ics: true,
    duration: card.duration || meta.duration,
  }));
}

/**
 * Карточки, которые имеет смысл переносить в календарь. Общий отбор для всех
 * способов переноса — .ics, ссылки в Google Календарь и текстового списка,
 * чтобы они не расходились между собой.
 * @param {{cards: object[]}} view
 * @param {Record<string, object>} registry — реестр сроков по id узла.
 * @returns {Array<{card: object, meta: object}>}
 */
export function exportableCards(view, registry) {
  const out = [];
  const byId = registry || {};
  for (const card of (view && view.cards) || []) {
    const meta = byId[card.id];
    if (!meta || meta.ics !== true || !card.deadline) continue;
    // Истёкшие и пропущенные сроки не переносим: напоминать не о чем. Это не то
    // же, что отсечение прошлых напоминаний по referenceDate — там срок ещё
    // идёт, и событие в файле остаётся, просто без части будильников.
    if (card.status === 'expired' || card.status === 'missed') continue;
    out.push({ card, meta });
  }
  return out;
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

/**
 * Даты напоминаний для одного срока: сдвиг назад с нерабочих, отсев прошлого.
 *
 * Правила берутся из переданной таблицы (offsets): предметный модуль решает,
 * какие смещения полагаются сроку данной длительности. Для длительности, которой
 * в таблице нет, таблица возвращает пустой список — известное допущение:
 * такой срок молча остаётся без напоминаний (поведение сохранено как было).
 *
 * @param {{deadline: string, duration?: object}} term
 * @param {string|null} referenceDate — дата расчёта: раньше неё не напоминаем.
 * @param {(duration: object) => Array<{unit: string, value: number}>} offsets
 * @returns {string[]} даты напоминаний 'YYYY-MM-DD' без повторов.
 */
export function reminderDates(term, referenceDate, offsets) {
  const out = [];
  for (const off of offsets(term.duration) || []) {
    const raw = offsetBackISO(term.deadline, off);
    // Смещение в рабочих днях уже даёт рабочий день — сдвигать нечего (как и с
    // дедлайном срока в рабочих днях). Календарные смещения сдвигаем назад.
    const date = off.unit === 'working_day' ? raw : shiftBackIfNonWorking(raw);
    if (referenceDate != null && date < referenceDate) continue; // раньше даты расчёта
    out.push(date);
  }
  return [...new Set(out)]; // после сдвига даты могут совпасть
}

/**
 * Метка выгрузки для UID. Без неё UID складывался из даты и порядкового номера,
 * и расчёты по разным делам с совпадающими датами перезаписывали друг друга в
 * календаре: два файла с одним сроком на одну дату давали одно событие.
 */
export function exportToken() {
  const rnd = globalThis.crypto?.randomUUID?.();
  if (rnd) return rnd.replace(/-/g, '').slice(0, 12);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function eventLines(term, index, { stamp, referenceDate, token, uidDomain, offsets }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${compact(term.deadline)}-${index}-${token}@${uidDomain}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(term.deadline)}`,
    `DTEND;VALUE=DATE:${compact(addDaysISO(term.deadline, 1))}`, // конец исключающий
    `SUMMARY:${esc(calendarEventTitle(term.title))}`,
    `DESCRIPTION:${esc(`Норма: ${term.norm}`)}`,
    'TRANSP:TRANSPARENT',
  ];
  for (const r of reminderDates(term, referenceDate, offsets)) {
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
 * @param {object} options
 *   prodId — значение PRODID (обязательно, без умолчания);
 *   uidDomain — доменный суффикс UID после «@» (обязательно, без умолчания);
 *   offsets — таблица правил напоминаний: duration → список смещений
 *     (обязательно: без неё файл собрался бы вообще без будильников, и увидеть
 *     это можно было бы только в чужом календаре);
 *   referenceDate — дата расчёта: напоминания раньше неё не создаются;
 *   now — значение DTSTAMP (по умолчанию текущее время).
 * @returns {string} текст файла с CRLF-переводами строк.
 */
export function buildICS(terms, options = {}) {
  const { referenceDate = null, now, prodId, uidDomain, offsets } = options;
  if (!prodId) {
    throw new Error('buildICS: не задан options.prodId — идентификатор продукта для PRODID.');
  }
  if (!uidDomain) {
    throw new Error('buildICS: не задан options.uidDomain — доменный суффикс UID после «@».');
  }
  if (typeof offsets !== 'function') {
    throw new Error(
      'buildICS: не задана options.offsets — таблица правил напоминаний ' +
        '(duration → смещения); без неё файл остался бы без напоминаний.',
    );
  }
  const stamp = stampUTC(now);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  const exported = (terms || []).filter((t) => t && t.ics === true);
  const token = exportToken(); // одна метка на выгрузку — события файла связаны
  exported.forEach((term, i) => {
    lines.push(...eventLines(term, i, { stamp, referenceDate, token, uidDomain, offsets }));
  });

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
