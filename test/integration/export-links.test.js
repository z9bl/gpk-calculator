// Интеграционные тесты на стыке core/export/links.js и предметного модуля
// ГПК: проверяем не отдельную функцию, а то, что несколько модулей остаются
// согласованы между собой после общего извлечения в core/.
//
// Изначально были частью test/core/export-links.test.js вперемешку с
// юнит-тестами чистых функций (см. test/core/export.test.js), затем выделены
// в test/core/export-links.integration.test.js, а отсюда — в test/integration/
// (см. docs/core-extraction-audit.md, §5): расположение test/core/ подразумевало
// бы изоляцию от предметного слоя, что для этого файла неверно. Проверяемые
// утверждения при переездах не менялись.

import test from 'node:test';
import assert from 'node:assert/strict';

import { termsAsText, reminderRulePhrase, ruDate, googleCalendarUrl } from '../../core/export/links.js';
import { buildView } from '../../src/views.js';
import { icsTermsFromView } from '../../src/ics.js';
// web/app.js импортируется и здесь: у него нет DOM-инициализации при
// импорте вне браузера (гвардия typeof document в конце файла), а
// googleCalendarTermFromCard — чистая функция, которую можно проверить
// напрямую, без DOM.
import { googleCalendarTermFromCard } from '../../web/app.js';
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

// --- Спорные сроки (card.alternative): ссылка в Google Календарь ведёт на ---
// рекомендованную дату, а не «по закону» -------------------------------------

test('спорный срок: ссылка в Google Календарь ведёт на рекомендованную (более раннюю) дату и её норму', () => {
  // Тот же спорный узел (cassation_ksoyu), что и в тесте .ics
  // (test/ics.test.js): норма и разъяснение Пленума расходятся в дате.
  // card.deadline/card.norm дают более позднюю дату «по закону» (10.09.2024),
  // card.alternative — рекомендованную более раннюю (02.09.2024).
  const view = buildView(
    {
      reasoned_decision_date: '2024-05-01',
      appeal_filed_date: '2024-05-15',
      appeal_ruling_date: '2024-06-02',
      appeal_ruling_reasoned_date: '2024-06-10',
      cassation_filed_date: '2024-09-05',
    },
    { today: '2024-09-05' },
  );
  const card = view.cards.find((c) => c.id === 'cassation_ksoyu');
  assert.ok(card.alternative, 'фикстура должна давать спорный срок');
  assert.notEqual(card.alternative.deadline, card.deadline, 'фикстура должна давать расхождение дат');

  const term = googleCalendarTermFromCard(card);
  assert.equal(term.deadline, card.alternative.deadline, 'дата ссылки — рекомендованная, не card.deadline');
  assert.equal(term.norm, card.alternative.norm, 'норма ссылки — norm alternative, а не card.norm');

  const url = new URL(googleCalendarUrl(term));
  const compact = card.alternative.deadline.replace(/-/g, '');
  assert.equal(url.searchParams.get('dates').split('/')[0], compact);
  assert.equal(url.searchParams.get('details'), `Норма: ${card.alternative.norm}`);
});

test('обычный срок без alternative: ссылка в Google Календарь по-прежнему card.deadline/card.norm', () => {
  const card = { title: 'Апелляционная жалоба', deadline: '2026-08-03', norm: 'ч. 1 ст. 321 ГПК РФ' };
  const term = googleCalendarTermFromCard(card);
  assert.equal(term.deadline, card.deadline);
  assert.equal(term.norm, card.norm);

  const url = new URL(googleCalendarUrl(term));
  assert.equal(url.searchParams.get('dates'), '20260803/20260804');
  assert.equal(url.searchParams.get('details'), 'Норма: ч. 1 ст. 321 ГПК РФ');
});
