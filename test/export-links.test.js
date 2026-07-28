// Ссылка в Google Календарь и текстовый список сроков.

import test from 'node:test';
import assert from 'node:assert/strict';

import { googleCalendarUrl, termsAsText, ruDate } from '../src/export-links.js';
import { buildView } from '../src/views.js';
import { icsTermsFromView } from '../src/ics.js';

const APPEAL = {
  title: 'Апелляционная жалоба',
  deadline: '2026-08-03',
  norm: 'ч. 1 ст. 321 ГПК РФ',
};

test('ссылка в Google: событие на весь день в дату дедлайна', () => {
  const url = new URL(googleCalendarUrl(APPEAL));
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('text'), 'Апелляционная жалоба');
  assert.equal(url.searchParams.get('details'), 'Норма: ч. 1 ст. 321 ГПК РФ');
  // Конец не включается, поэтому следующий день — иначе событие займёт двое суток.
  assert.equal(url.searchParams.get('dates'), '20260803/20260804');
});

test('ссылка в Google: конец месяца и конец года не ломают дату', () => {
  const end = new URL(googleCalendarUrl({ ...APPEAL, deadline: '2026-08-31' }));
  assert.equal(end.searchParams.get('dates'), '20260831/20260901');
  const newYear = new URL(googleCalendarUrl({ ...APPEAL, deadline: '2026-12-31' }));
  assert.equal(newYear.searchParams.get('dates'), '20261231/20270101');
  const leap = new URL(googleCalendarUrl({ ...APPEAL, deadline: '2028-02-28' }));
  assert.equal(leap.searchParams.get('dates'), '20280228/20280229');
});

test('ссылка в Google: кириллица и спецсимволы экранируются', () => {
  const url = googleCalendarUrl({
    title: 'Замечания на протокол & возражения',
    deadline: '2026-08-03',
    norm: 'ч. 1 ст. 231 ГПК РФ',
  });
  // Амперсанд в названии не должен разорвать строку параметров: значения
  // читаются обратно без потерь.
  const parsed = new URL(url).searchParams;
  assert.equal([...parsed.keys()].length, 4, 'лишних параметров от амперсанда нет');
  assert.equal(parsed.get('text'), 'Замечания на протокол & возражения');
  assert.equal(parsed.get('details'), 'Норма: ч. 1 ст. 231 ГПК РФ');
});

test('ссылка в Google: без нормы параметр описания не добавляется', () => {
  const url = new URL(googleCalendarUrl({ title: 'Срок', deadline: '2026-08-03' }));
  assert.equal(url.searchParams.has('details'), false);
});

test('текстовый список: заголовок с датой расчёта и по строке на срок', () => {
  const text = termsAsText([APPEAL, { title: 'Кассация', deadline: '2026-11-03', norm: 'ст. 376.1' }], {
    today: '2026-07-28',
    situation: 'Решение суда в общем порядке',
  });
  assert.deepEqual(text.split('\n'), [
    'Процессуальные сроки по ГПК РФ · Решение суда в общем порядке · расчёт от 28.07.2026',
    '',
    '03.08.2026 — Апелляционная жалоба (ч. 1 ст. 321 ГПК РФ)',
    '03.11.2026 — Кассация (ст. 376.1)',
  ]);
});

test('текстовый список: пустой набор даёт только заголовок', () => {
  const text = termsAsText([], { today: '2026-07-28' });
  assert.deepEqual(text.split('\n'), ['Процессуальные сроки по ГПК РФ · расчёт от 28.07.2026', '']);
});

test('текстовый список строится из тех же сроков, что и .ics', () => {
  // Способы переноса не должны расходиться между собой.
  const view = buildView({ reasoned_decision_date: '2026-07-01' }, { today: '2026-07-28' });
  const terms = icsTermsFromView(view);
  const text = termsAsText(terms, { today: '2026-07-28' });
  assert.ok(terms.length > 0);
  for (const t of terms) {
    assert.ok(text.includes(t.title), `в списке нет срока «${t.title}»`);
    assert.ok(text.includes(ruDate(t.deadline)), `в списке нет даты ${t.deadline}`);
  }
  // Строк ровно столько, сколько сроков (плюс заголовок и пустая строка).
  assert.equal(text.split('\n').length, terms.length + 2);
});
