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
// Признак того, что render() отработал: секция «Другие сроки» с полями-триггерами
// независимых ветвей. Заглушки для этого больше не годятся — все ветви раскрыты.
if ((await page.locator('#other-terms input').count()) < 1) {
  problems.push('секция «Другие сроки» не отрисована');
}

// Ввод даты должен дать карточки без новых ошибок.
await page.fill('#reasoned', '11.03.2024');
await page.dispatchEvent('#reasoned', 'change');
await page.waitForTimeout(200);
if ((await page.locator('#results .card').count()) < 1) {
  problems.push('после ввода даты карточки не появились');
}

await browser.close();
server.close();

if (problems.length) {
  console.error('SMOKE FAIL:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log('SMOKE OK: index.html загрузился без ошибок в консоли, карточки рендерятся.');
