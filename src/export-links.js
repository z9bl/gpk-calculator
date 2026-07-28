// Способы перенести сроки к себе, кроме файла .ics: ссылка в Google Календарь
// и текстовый список для буфера обмена.
//
// Только чистые функции над данными — ни DOM, ни сети. Вынесено из web/app.js,
// чтобы формат ссылки и формат списка проверялись тестами: и то и другое легко
// сломать незаметно, а увидеть поломку можно лишь в чужом сервисе.

const GOOGLE_RENDER = 'https://calendar.google.com/calendar/render';

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
 * Текстовый список сроков для буфера обмена.
 *
 * Формат намеренно простой: заголовок с датой расчёта и по строке на срок —
 * дата, название, норма. Такое одинаково читается в заметках, письме и ячейке
 * таблицы; разметка или выравнивание пробелами там только мешают.
 *
 * @param {Array<{title: string, deadline: string, norm?: string}>} terms
 * @param {{today?: string, situation?: string}} [options]
 * @returns {string}
 */
export function termsAsText(terms, options = {}) {
  const head = ['Процессуальные сроки по ГПК РФ'];
  if (options.situation) head.push(options.situation);
  if (options.today) head.push(`расчёт от ${ruDate(options.today)}`);

  const lines = (terms || []).map((t) =>
    t.norm ? `${ruDate(t.deadline)} — ${t.title} (${t.norm})` : `${ruDate(t.deadline)} — ${t.title}`,
  );
  return [head.join(' · '), '', ...lines].join('\n');
}
