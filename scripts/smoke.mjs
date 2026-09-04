// Браузерная smoke-проверка (раздел 9 SPEC.md): грузит index.html в реальном
// браузере и падает при ЛЮБОЙ ошибке в консоли, необработанном исключении или
// показе .fatal. Ловит синтаксические и рантайм-ошибки app.js/views.js, которые
// `node --test` не видит (он не исполняет модули в браузере).
//
// Запуск: node test/smoke.mjs  (нужен пакет playwright и браузер chromium).
// В окружении можно указать путь к chromium: PW_CHROMIUM_PATH=/путь/к/chrome.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// require() резолвит playwright из локальных node_modules или из NODE_PATH
// (в отличие от ESM-import голого спецификатора).
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

// Минимальный статический сервер из корня репозитория.
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0]));
  // Браузер сам запрашивает /favicon.ico — отдаём пустышку, чтобы 404 фавикона
  // не выглядел как ошибка загрузки ресурса.
  if (rel === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  try {
    const file = join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT)) throw new Error('path escape');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;

const problems = [];
const launchOpts = process.env.PW_CHROMIUM_PATH
  ? { executablePath: process.env.PW_CHROMIUM_PATH }
  : {};
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'networkidle' });

// Приложение должно инициализироваться: без .fatal, поле ввода на месте,
// заглушки отрисованы (значит render() отработал).
if ((await page.locator('.fatal').count()) > 0) {
  problems.push('.fatal показан — приложение не инициализировалось');
}
if ((await page.locator('#reasoned').count()) === 0) problems.push('нет поля #reasoned');
// Признак того, что render() отработал: переключатель ситуации. Он рисуется
// кодом приложения и виден всегда — в отличие от блока уточняющих дат, который
// теперь появляется только после заполнения основного поля.
if ((await page.locator('#situation input[type=radio]').count()) < 5) {
  problems.push('переключатель ситуации не отрисован');
}

// Ввод даты должен дать карточки без новых ошибок. fill() сам шлёт input —
// именно на него приложение и реагирует (слушателя change нет).
await page.fill('#reasoned', '11.03.2024');
await page.waitForTimeout(200);
if ((await page.locator('#results .card').count()) < 1) {
  problems.push('после ввода даты карточки не появились');
}

// Перерыв срока предъявления (ч. 1–3 ст. 22 ФЗ № 229-ФЗ): список событий на
// карточке ИЛ добавляет строку и пересчитывает срок от даты события. Проверяем
// в браузере — расчёт покрыт node --test, а вот повторяемый список полей
// (добавление строки, маска даты, перерисовка) живёт только в app.js.
const ilCard = page
  .locator('#results .card')
  .filter({ hasText: 'Предъявление исполнительного листа к исполнению' });
if ((await ilCard.count()) !== 1) {
  problems.push('карточка предъявления ИЛ не найдена');
} else {
  if ((await ilCard.locator('.interruption-scope').count()) === 0) {
    problems.push('предупреждение о ч. 3.1 ст. 22 не показано рядом с полем');
  }
  await ilCard.getByRole('button', { name: 'Добавить перерыв' }).click();
  await page.waitForTimeout(100);
  if ((await page.locator('#in-interruption-0-type').count()) === 0) {
    problems.push('строка перерыва не добавилась');
  }
  await page.fill('#in-interruption-0-date', '15.06.2026');
  await page.waitForTimeout(200);
  const deadline = await ilCard.locator('.deadline').first().innerText();
  if (deadline.trim() !== '15.06.2029') {
    problems.push(`после перерыва ждали 15.06.2029, получили «${deadline.trim()}»`);
  }
  if ((await ilCard.locator('.interruption-history').count()) === 0) {
    problems.push('история перерывов на карточке не показана');
  }
  // Удаление строки возвращает расчёт к исходному якорю.
  await ilCard.getByRole('button', { name: 'Удалить' }).first().click();
  await page.waitForTimeout(200);
  if ((await ilCard.locator('.interruption-history').count()) !== 0) {
    problems.push('после удаления строки история перерывов осталась');
  }
  if ((await ilCard.locator('.deadline').first().innerText()).trim() === '15.06.2029') {
    problems.push('после удаления перерыва срок не пересчитался обратно');
  }
}

await browser.close();
server.close();

if (problems.length) {
  console.error('SMOKE FAIL:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log('SMOKE OK: index.html загрузился без ошибок в консоли, карточки рендерятся.');
