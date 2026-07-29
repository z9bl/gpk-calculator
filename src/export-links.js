// Способы перенести сроки к себе, кроме файла .ics: ссылка в Google Календарь
// и текстовый список для буфера обмена.
//
// Только чистые функции над данными — ни DOM, ни сети. Вынесено из web/app.js,
// чтобы формат ссылки и формат списка проверялись тестами: и то и другое легко
// сломать незаметно, а увидеть поломку можно лишь в чужом сервисе.

const GOOGLE_RENDER = 'https://calendar.google.com/calendar/render';

// Что означает дата на карточке. Без подписи «13.08.2026» читается неоднозначно:
// как дата вступления в силу или как начало течения срока.
export const DEADLINE_CAPTION = 'последний день подачи';       // срок заявителя
export const DEADLINE_CAPTION_COURT = 'последний день';        // срок суда

/**
 * Название события в календаре. В календаре видно только название, поэтому
 * пояснение уходит в него: «Апелляционная жалоба — последний день подачи».
 */
export function calendarEventTitle(title) {
  return `${title} — ${DEADLINE_CAPTION}`;
}

function lowerFirst(text) {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

// Одна строка сводки — для копирования и печати. Формат явно называет, что за
// дата: у сроков заявителя «последний день подачи», у сроков суда «последний
// день», у событий «вступает в силу». Иначе «13.08.2026 — …» читается
// неоднозначно (последний день? начало течения? вступление в силу?).
function summaryLine(entry) {
  const norm = entry.norm ? ` (${entry.norm})` : '';
  if (entry.kind === 'event') {
    return `${entry.title} — вступает в силу ${ruDate(entry.deadline)}${norm}`;
  }
  const caption = entry.kind === 'court' ? DEADLINE_CAPTION_COURT : DEADLINE_CAPTION;
  return `${entry.title} — ${caption}: ${ruDate(entry.deadline)}${norm}`;
}

/**
 * Строки сводки по сроку/событию (без заголовка). Общий формат для копирования
 * и печати — чтобы они не расходились между собой.
 * @param {Array<{title, deadline, norm?, kind?: 'applicant'|'court'|'event'}>} entries
 * @returns {string[]}
 */
export function caseSummaryLines(entries) {
  return (entries || []).map(summaryLine);
}

/**
 * Заголовок сводки: «Сроки по делу (решение суда в общем порядке). Расчёт от
 * 28.07.2026». Название ветви — с маленькой буквы, как часть фразы.
 * @param {{today?: string, situation?: string}} [options]
 * @returns {string}
 */
export function caseSummaryHeader(options = {}) {
  let head = 'Сроки по делу';
  if (options.situation) head += ` (${lowerFirst(options.situation)})`;
  if (options.today) head += `. Расчёт от ${ruDate(options.today)}`;
  else head += '.';
  return head;
}

function compact(iso) {
  return iso.replace(/-/g, ''); // YYYY-MM-DD → YYYYMMDD
}

function nextDayCompact(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const p = (n) => String(n).padStart(2, '0');
  return `${next.getUTCFullYear()}${p(next.getUTCMonth() + 1)}${p(next.getUTCDate())}`;
}

/** 'YYYY-MM-DD' → 'ДД.ММ.ГГГГ'. */
export function ruDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * Ссылка на предзаполненную форму события в Google Календаре.
 *
 * Событие на весь день: в параметре dates конец указывается следующим днём —
 * он не включается (как DTEND в .ics). Иначе событие занимало бы два дня.
 *
 * @param {{title: string, deadline: string, norm?: string}} term
 * @returns {string}
 */
export function googleCalendarUrl(term) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: term.title,
    dates: `${compact(term.deadline)}/${nextDayCompact(term.deadline)}`,
  });
  if (term.norm) params.set('details', `Норма: ${term.norm}`);
  return `${GOOGLE_RENDER}?${params.toString()}`;
}

/**
 * Текстовая сводка для буфера обмена: заголовок, пустая строка и по строке на
 * срок/событие. Формат намеренно простой — одинаково читается в заметках,
 * письме и ячейке таблицы; разметка или выравнивание пробелами там мешают.
 *
 * @param {Array<{title, deadline, norm?, kind?: 'applicant'|'court'|'event'}>} entries
 * @param {{today?: string, situation?: string}} [options]
 * @returns {string}
 */
export function termsAsText(entries, options = {}) {
  return [caseSummaryHeader(options), '', ...caseSummaryLines(entries)].join('\n');
}

// Русское описание правила напоминаний для срока данной длительности — для
// пояснения под ссылкой в Google Календарь. Держим синхронно с reminderOffsets
// в ics.js: те же длительности, те же смещения.
export function reminderRulePhrase(duration) {
  const d = duration || {};
  if (d.unit === 'month' && d.value === 1) return 'за 3 и 7 дней';
  if (d.unit === 'month' && d.value === 3) return 'за 3 и 14 дней';
  if (d.unit === 'year' && d.value === 3) return 'за 7 дней и 1 месяц';
  if (d.unit === 'working_day') {
    if (d.value === 3) return 'за 1 рабочий день';
    if (d.value === 5 || d.value === 7) return 'за 1 и 2 рабочих дня';
    if (d.value === 15) return 'за 3 и 7 рабочих дней';
  }
  return '';
}
