// Браузерная smoke-проверка (раздел 9 SPEC.md): грузит index.html в реальном
// браузере и падает при ЛЮБОЙ ошибке в консоли, необработанном исключении или
// показе .fatal. Ловит синтаксические и рантайм-ошибки app.js/views.js, которые
// `node --test` не видит (он не исполняет модули в браузере).
//
// Запуск: node scripts/smoke.mjs  (нужен пакет playwright и браузер chromium).
//
// В контейнере Claude Code браузер лежит по фиксированному пути
// (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers), и его ревизия — часть образа,
// а не репозитория: она может не совпадать с тем, что playwright из
// node_modules ожидает найти сам, и меняться со временем независимо от
// package.json. Поэтому путь к chromium ищем автоматически (findChromiumExecutable
// ниже) по стандартным путям установки — вручную ничего прописывать не нужно.
// Если нужен конкретный браузер, PW_CHROMIUM_PATH=/путь/к/chrome всё ещё
// перебивает автоопределение.

import { createServer } from 'node:http';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

// Ищет установленный браузер chromium по стандартным путям, не полагаясь на
// то, что ревизия, которую ожидает playwright из node_modules, совпадает с
// тем, что реально лежит на диске (см. комментарий в шапке файла). Явный
// PW_CHROMIUM_PATH имеет приоритет. Возвращает undefined, если ничего не
// нашлось, — тогда playwright ищет браузер сам обычным способом (штатный
// случай вне контейнера Claude Code, например после `playwright install`).
async function findChromiumExecutable() {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;

  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean);
  for (const root of roots) {
    // Готовый симлинк на текущую ревизию — так устроен контейнер Claude Code.
    const link = join(root, 'chromium');
    if (existsSync(link)) {
      try {
        return await realpath(link);
      } catch {
        // битый симлинк — ищем ниже по каталогам ревизий
      }
    }
    // Иначе перебираем каталоги chromium-<revision>/chrome-linux/chrome —
    // так playwright раскладывает браузер на Linux.
    let entries;
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    const revision = entries.filter((name) => /^chromium-\d+$/.test(name)).sort().at(-1);
    if (revision) {
      const candidate = join(root, revision, 'chrome-linux', 'chrome');
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

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
const executablePath = await findChromiumExecutable();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
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

// События ст. 22 ФЗ № 229-ФЗ на карточке ИЛ: список добавляет строку и
// пересчитывает срок — перерыв (ч. 1–3) от даты события, вычет (ч. 3.1) на
// длину периода. Проверяем в браузере — расчёт покрыт node --test, а вот
// повторяемый список полей (добавление строки, смена основания с
// перерисовкой набора полей, маска даты) живёт только в app.js.
const ilCard = page
  .locator('#results .card')
  .filter({ hasText: 'Предъявление исполнительного листа к исполнению' });
if ((await ilCard.count()) !== 1) {
  problems.push('карточка предъявления ИЛ не найдена');
} else {
  if ((await ilCard.locator('.interruption-scope').count()) === 0) {
    problems.push('предупреждение о ч. 3.1 ст. 22 не показано рядом с полем');
  }
  await ilCard.getByRole('button', { name: 'Добавить событие' }).click();
  await page.waitForTimeout(100);
  if ((await page.locator('#in-interruption-0-type').count()) === 0) {
    problems.push('строка события не добавилась');
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

  // Вычет по ч. 3.1: смена основания в том же списке должна заменить одно поле
  // даты на два, а введённый период — уменьшить срок, не сдвигая точку отсчёта.
  // Базовый расчёт при дате 11.03.2024: вступление в силу 12.04.2024, срок ИЛ
  // до 12.04.2027. Период 01.05.2024 — 01.09.2024 = 123 дня → 10.12.2026
  // (четверг, переносить не нужно).
  await ilCard.getByRole('button', { name: 'Добавить событие' }).click();
  await page.waitForTimeout(100);
  await page.selectOption('#in-interruption-0-type', 'creditor_request');
  await page.waitForTimeout(200);
  if ((await page.locator('#in-interruption-0-date').count()) !== 0) {
    problems.push('после выбора основания ч. 3.1 осталось поле одной даты');
  }
  if (
    (await page.locator('#in-interruption-0-from').count()) === 0 ||
    (await page.locator('#in-interruption-0-to').count()) === 0
  ) {
    problems.push('после выбора основания ч. 3.1 не появились два поля дат');
  }
  await page.fill('#in-interruption-0-from', '01.05.2024');
  await page.waitForTimeout(100);
  // С одной заполненной датой период не измерить — срок меняться не должен.
  if ((await ilCard.locator('.deadline').first().innerText()).trim() !== '12.04.2027') {
    problems.push('период с одной датой уже повлиял на срок');
  }
  await page.fill('#in-interruption-0-to', '01.09.2024');
  await page.waitForTimeout(200);
  const deducted = (await ilCard.locator('.deadline').first().innerText()).trim();
  if (deducted !== '10.12.2026') {
    problems.push(`после вычета ч. 3.1 ждали 10.12.2026, получили «${deducted}»`);
  }
  if ((await ilCard.locator('.deduction-history').count()) === 0) {
    problems.push('история вычетов на карточке не показана');
  }
  if ((await ilCard.locator('.deduction-assumption').count()) === 0) {
    problems.push('допущения по ч. 3.1 не показаны рядом с расчётом');
  }
  if ((await ilCard.locator('.deduction-overlap').count()) !== 0) {
    problems.push('предупреждение о пересечении показано на одном периоде');
  }

  // Проверка ввода: второй период, перекрывающий первый, должен дать
  // предупреждение рядом с полями — при этом расчёт не меняется иначе, чем на
  // сумму обоих периодов (валидация арифметику не подстраивает).
  await ilCard.getByRole('button', { name: 'Добавить событие' }).click();
  await page.waitForTimeout(100);
  await page.selectOption('#in-interruption-1-type', 'creditor_obstruction');
  await page.waitForTimeout(200);
  await page.fill('#in-interruption-1-from', '01.07.2024');
  await page.fill('#in-interruption-1-to', '01.11.2024');
  await page.waitForTimeout(200);
  if ((await ilCard.locator('.deduction-overlap').count()) === 0) {
    problems.push('пересекающиеся периоды не дали предупреждения о вводе');
  }
  // 123 + 123 = 246 дней от 12.04.2027 → 09.08.2026 (воскресенье → 10.08.2026).
  const overlapped = (await ilCard.locator('.deadline').first().innerText()).trim();
  if (overlapped !== '10.08.2026') {
    problems.push(`при пересечении ждали 10.08.2026, получили «${overlapped}»`);
  }
}

await browser.close();
server.close();

if (problems.length) {
  console.error('SMOKE FAIL:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log('SMOKE OK: index.html загрузился без ошибок в консоли, карточки рендерятся.');
