// Браузерный шим для `node:fs`, нужный только чтобы src/calendar.js работал в
// браузере без изменений. Данные календаря загружаются страницей заранее
// (fetch calendar_data.json) и кладутся в globalThis.__CALENDAR_JSON__;
// readFileSync синхронно их возвращает. В Node этот файл не используется —
// там работает настоящий node:fs.
export function readFileSync() {
  const json = globalThis.__CALENDAR_JSON__;
  if (json == null) {
    throw new Error('calendar_data.json не загружен (ожидался globalThis.__CALENDAR_JSON__)');
  }
  return json;
}
