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

// Пояснение к спорному сроку в копировании: две строки ниже — одна и та же дата
// в двух прочтениях, а не два разных события. Смысл тот же, что на экране и в
// печати («Спорный срок: норма и разъяснение Пленума расходятся»).
export const ALTERNATIVE_CONFLICT_NOTE = 'Норма и разъяснение Пленума расходятся в дате:';

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

// Норма — коротко: без скобочного пояснения (редакция, глава и т.п.). Для
// «ч. 1 ст. 321 ГПК РФ» отбрасывать нечего; у кассации «(ред. ФЗ № 135-ФЗ …)»
// уходит. Обоснования и «по закону» в подписи не выводим.
function shortNorm(norm) {
  return norm ? norm.split('(')[0].trim() : '';
}

// Что за дата у срока: у заявителя «последний день подачи», у суда «последний
// день», у события — ничего (само название «Вступление … в силу» говорит).
function captionFor(kind) {
  if (kind === 'court') return DEADLINE_CAPTION_COURT;
  if (kind === 'event') return null;
  return DEADLINE_CAPTION;
}

/**
 * Структура сводки — общий источник для копирования и печати, чтобы форматы не
 * расходились. Каждый пункт: название, характер даты (caption), одна или две
 * строки «дата + норма» и, у спорного срока, рекомендация.
 *
 * Спорный срок (alternative_calculation, раздел 6): показываем ДВЕ даты — по
 * закону и по разъяснению Пленума — и рекомендацию. Без этого юрист, работающий
 * по распечатке, пропустил бы более раннюю (безопасную) дату.
 *
 * @param {Array<{title, deadline, norm?, kind?, alternative?}>} entries
 * @returns {Array<object>}
 */
export function caseSummaryItems(entries) {
  return (entries || []).map((e) => {
    const caption = captionFor(e.kind);
    if (e.alternative) {
      return {
        title: e.title,
        caption,
        alternative: true,
        // Пояснение к паре дат — одна дата в двух прочтениях, а не два события.
        // Без двоеточия: в печати это вводная строка между заголовком и первой
        // датой, а не начало списка (двоеточие добавляет копирование).
        conflictNote: ALTERNATIVE_CONFLICT_NOTE.replace(/:$/, ''),
        rows: [
          { date: ruDate(e.deadline), norm: shortNorm(e.norm) }, // по закону
          { date: ruDate(e.alternative.deadline), norm: shortNorm(e.alternative.norm) }, // Пленум
        ],
        recommendation: (e.alternative.recommendation || '').replace(/\.$/, ''),
      };
    }
    return { title: e.title, caption, alternative: false, date: ruDate(e.deadline), norm: shortNorm(e.norm) };
  });
}

/**
 * Строки сводки для копирования (простой текст). Дата идёт первой и не теряется
 * в строке. Спорный срок разворачивается в четыре строки: название, дата по
 * закону, дата по Пленуму, рекомендация.
 * @param {Array<object>} entries
 * @returns {string[]}
 */
export function caseSummaryLines(entries) {
  const lines = [];
  for (const item of caseSummaryItems(entries)) {
    if (item.alternative) {
      lines.push(item.caption ? `${item.title} (${item.caption})` : item.title);
      lines.push(ALTERNATIVE_CONFLICT_NOTE); // одна дата в двух прочтениях, не два события
      for (const r of item.rows) lines.push(`${r.norm} — ${r.date}`);
      if (item.recommendation) lines.push(item.recommendation);
    } else {
      const cap = item.caption ? `, ${item.caption}` : '';
      const norm = item.norm ? ` (${item.norm})` : '';
      lines.push(`${item.date} — ${item.title}${cap}${norm}`);
    }
  }
  return lines;
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
