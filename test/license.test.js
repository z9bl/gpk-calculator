// Лицензия и уведомление об авторском праве: только тексты и метаданные.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('LICENSE существует и не пуст', () => {
  assert.ok(read('LICENSE').trim().length > 0);
});

test('package.json: license UNLICENSED, private', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.private, true);
});

test('ссылка в подвале ведёт на существующую страницу, а та читает LICENSE', () => {
  const footer = read('index.html').match(/<footer class="disclaimer">[\s\S]*?<\/footer>/)[0];
  const href = footer.match(/<a href="([^"#?]+)"[^>]*>\s*Лицензионное соглашение/)[1];
  assert.ok(!/^[a-z]+:|^\//.test(href), 'ссылка должна быть относительной');
  assert.ok(existsSync(new URL(`../${href}`, import.meta.url)));
  assert.match(read(href), /fetch\('LICENSE'\)/);
  assert.match(footer, /© 2026 .*Все права защищены/);
});

test('index.html содержит meta copyright', () => {
  assert.match(read('index.html'), /<meta name="copyright" content="© 2026 [^"]+">/);
});
