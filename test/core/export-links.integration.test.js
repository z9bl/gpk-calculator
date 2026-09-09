// Интеграционные тесты на стыке core/export/links.js и предметного модуля
// ГПК: проверяем не отдельную функцию, а то, что несколько модулей остаются
// согласованы между собой после общего извлечения в core/.
//
// Выделены из export-links.test.js при разборе бэклога (файл смешивал их с
// юнит-тестами чистых функций — см. export.test.js). Сюда перенесены как
// есть, без изменения проверяемых утверждений.

import test from 'node:test';
import assert from 'node:assert/strict';

import { termsAsText, reminderRulePhrase, ruDate } from '../../core/export/links.js';
import { buildView } from '../../src/views.js';
import { icsTermsFromView } from '../../src/ics.js';
// Таблица смещений предметная (ГПК), сама фраза — общая: проверяем их вместе,
// потому что смысл проверки именно в том, что источник у них теперь один.
import { reminderOffsets } from '../../src/term-registry.js';

test('фраза правила напоминаний совпадает с длительностями из ics', () => {
  const phrase = (duration) => reminderRulePhrase(duration, reminderOffsets);
  assert.equal(phrase({ value: 1, unit: 'month' }), 'за 3 и 7 дней');
  assert.equal(phrase({ value: 3, unit: 'month' }), 'за 3 и 14 дней');
  assert.equal(phrase({ value: 3, unit: 'year' }), 'за 7 дней и 1 месяц');
  assert.equal(phrase({ value: 15, unit: 'working_day' }), 'за 3 и 7 рабочих дней');
  assert.equal(phrase({ value: 7, unit: 'working_day' }), 'за 1 и 2 рабочих дня');
  assert.equal(phrase({ value: 3, unit: 'working_day' }), 'за 1 рабочий день');
  assert.equal(phrase(undefined), '');
});

test('фраза строится по той же таблице, что и напоминания в .ics', () => {
  // До объединения фраза хранила свою копию таблицы и уже разошлась с ней:
  // для шести месяцев (практика ВС) и десяти рабочих дней (возражения на
  // судебный приказ) напоминания в файл писались, а фраза молчала.
  assert.equal(reminderRulePhrase({ value: 6, unit: 'month' }, reminderOffsets), 'за 3 и 30 дней');
  assert.equal(
    reminderRulePhrase({ value: 10, unit: 'working_day' }, reminderOffsets),
    'за 2 и 5 рабочих дней',
  );

  // Сверка по существу: числа во фразе — те же, что в самой таблице смещений.
  for (const duration of [
    { value: 1, unit: 'month' },
    { value: 3, unit: 'month' },
    { value: 6, unit: 'month' },
    { value: 3, unit: 'year' },
    { value: 3, unit: 'working_day' },
    { value: 10, unit: 'working_day' },
    { value: 15, unit: 'working_day' },
  ]) {
    const said = reminderRulePhrase(duration, reminderOffsets);
    for (const off of reminderOffsets(duration)) {
      assert.match(said, new RegExp(`\\b${off.value}\\b`), `${said}: нет смещения ${off.value}`);
    }
  }

  // Без таблицы говорить нечего — пустая строка, а не выдуманное правило.
  assert.equal(reminderRulePhrase({ value: 1, unit: 'month' }, undefined), '');
});

test('текстовый список строится из тех же сроков, что и .ics', () => {
  // Способы переноса не должны расходиться между собой.
  const view = buildView({ reasoned_decision_date: '2026-07-01' }, { today: '2026-07-28' });
  const terms = icsTermsFromView(view).map((t) => ({ ...t, kind: 'applicant' }));
  const text = termsAsText(terms, { today: '2026-07-28' });
  assert.ok(terms.length > 0);
  for (const t of terms) {
    assert.ok(text.includes(t.title), `в списке нет срока «${t.title}»`);
    assert.ok(text.includes(ruDate(t.deadline)), `в списке нет даты ${t.deadline}`);
  }
  // Строк ровно столько, сколько сроков (заголовок + пустая строка сверху,
  // пустая строка + дисклеймер снизу).
  assert.equal(text.split('\n').length, terms.length + 4);
});
