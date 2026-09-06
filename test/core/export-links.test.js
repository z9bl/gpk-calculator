// Ссылка в Google Календарь и текстовый список сроков.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  googleCalendarUrl,
  termsAsText,
  caseSummaryHeader,
  caseSummaryLines,
  caseSummaryItems,
  reminderRulePhrase,
  calendarEventTitle,
  ruDate,
} from '../../core/export/links.js';
import { buildView } from '../../src/views.js';
import { icsTermsFromView } from '../../src/ics.js';

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

test('сводка: заголовок и строки с указанием характера даты', () => {
  const text = termsAsText(
    [
      APPEAL,
      { title: 'Изготовление решения', deadline: '2026-07-16', norm: 'ч. 4 ст. 232.4', kind: 'court' },
      { title: 'Вступление в силу', deadline: '2026-08-04', norm: 'ч. 1 ст. 209', kind: 'event' },
    ],
    { today: '2026-07-28', situation: 'Решение суда в общем порядке' },
  );
  // Дата идёт первой (пункт 2 иерархии); характер даты сохранён (пункт 5 прошлой
  // задачи): у заявителя «последний день подачи», у суда «последний день»,
  // у события — по названию.
  assert.deepEqual(text.split('\n'), [
    'Сроки по делу (решение суда в общем порядке). Расчёт от 28.07.2026',
    '',
    '03.08.2026 — Апелляционная жалоба, последний день подачи (ч. 1 ст. 321 ГПК РФ)',
    '16.07.2026 — Изготовление решения, последний день (ч. 4 ст. 232.4)',
    '04.08.2026 — Вступление в силу (ч. 1 ст. 209)',
    '',
    'Справочный расчёт, не заменяет консультацию юриста',
  ]);
});

test('сводка: заголовок без ветви и без даты расчёта', () => {
  assert.equal(caseSummaryHeader({}), 'Сроки по делу.');
  assert.equal(caseSummaryHeader({ today: '2026-07-28' }), 'Сроки по делу. Расчёт от 28.07.2026');
  assert.equal(
    caseSummaryHeader({ situation: 'Решение мирового судьи' }),
    'Сроки по делу (решение мирового судьи).',
  );
});

test('сводка: пустой набор даёт заголовок и дисклеймер', () => {
  const text = termsAsText([], { today: '2026-07-28' });
  assert.deepEqual(text.split('\n'), [
    'Сроки по делу. Расчёт от 28.07.2026',
    '',
    '',
    'Справочный расчёт, не заменяет консультацию юриста',
  ]);
});

test('сводка: без нормы строка обходится без скобок', () => {
  assert.deepEqual(caseSummaryLines([{ title: 'Срок', deadline: '2026-08-03', kind: 'applicant' }]), [
    '03.08.2026 — Срок, последний день подачи',
  ]);
});

test('сводка: короткая норма — скобочное пояснение редакции отброшено', () => {
  const [line] = caseSummaryLines([
    {
      title: 'Кассационная жалоба в КСОЮ',
      deadline: '2026-11-03',
      norm: 'абз. 2 ч. 1 ст. 376.1 ГПК РФ (ред. ФЗ № 135-ФЗ от 12.06.2024)',
      kind: 'applicant',
    },
  ]);
  assert.equal(line, '03.11.2026 — Кассационная жалоба в КСОЮ, последний день подачи (абз. 2 ч. 1 ст. 376.1 ГПК РФ)');
});

test('спорный срок: копирование — две даты и рекомендация', () => {
  const entry = {
    title: 'Кассационная жалоба в Судебную коллегию ВС РФ',
    deadline: '2026-08-13',
    norm: 'ч. 1 ст. 390.3 ГПК РФ (ред. ФЗ № 135-ФЗ от 12.06.2024)',
    kind: 'applicant',
    alternative: {
      deadline: '2026-08-10',
      norm: 'п. 12 ПП ВС РФ от 22.06.2021 № 17',
      recommendation: 'Рекомендуем ориентироваться на более раннюю дату.',
    },
  };
  assert.deepEqual(caseSummaryLines([entry]), [
    'Кассационная жалоба в Судебную коллегию ВС РФ (последний день подачи)',
    'Норма и разъяснение Пленума расходятся в дате:',
    'ч. 1 ст. 390.3 ГПК РФ — 13.08.2026',
    'п. 12 ПП ВС РФ от 22.06.2021 № 17 — 10.08.2026',
    'Рекомендуем ориентироваться на более раннюю дату',
  ]);

  // Структура для печати: вводная строка (без двоеточия), две пары «дата +
  // норма» и рекомендация.
  const [item] = caseSummaryItems([entry]);
  assert.equal(item.alternative, true);
  assert.equal(item.conflictNote, 'Норма и разъяснение Пленума расходятся в дате');
  assert.deepEqual(item.rows, [
    { date: '13.08.2026', norm: 'ч. 1 ст. 390.3 ГПК РФ' },
    { date: '10.08.2026', norm: 'п. 12 ПП ВС РФ от 22.06.2021 № 17' },
  ]);
  assert.equal(item.recommendation, 'Рекомендуем ориентироваться на более раннюю дату');
});

test('спорный срок: печать — вводная строка есть, у обычного срока нет', () => {
  const [alt] = caseSummaryItems([
    {
      title: 'Кассационная жалоба в КСОЮ',
      deadline: '2026-11-30',
      norm: 'абз. 2 ч. 1 ст. 376.1 ГПК РФ (ред. ФЗ № 135-ФЗ от 12.06.2024)',
      kind: 'applicant',
      alternative: {
        deadline: '2026-11-25',
        norm: 'п. 12 ПП ВС РФ от 22.06.2021 № 17',
        recommendation: 'Рекомендуем ориентироваться на более раннюю дату.',
      },
    },
  ]);
  assert.equal(alt.conflictNote, 'Норма и разъяснение Пленума расходятся в дате');

  // Обычный срок (без alternative) вводной строки не несёт.
  const [plain] = caseSummaryItems([
    { title: 'Апелляционная жалоба', deadline: '2026-08-03', norm: 'ч. 1 ст. 321 ГПК РФ', kind: 'applicant' },
  ]);
  assert.equal(plain.alternative, false);
  assert.equal(plain.conflictNote, undefined);
});

test('название события в календаре несёт характер даты', () => {
  assert.equal(calendarEventTitle('Апелляционная жалоба'), 'Апелляционная жалоба — последний день подачи');
});

test('фраза правила напоминаний совпадает с длительностями из ics', () => {
  assert.equal(reminderRulePhrase({ value: 1, unit: 'month' }), 'за 3 и 7 дней');
  assert.equal(reminderRulePhrase({ value: 3, unit: 'month' }), 'за 3 и 14 дней');
  assert.equal(reminderRulePhrase({ value: 3, unit: 'year' }), 'за 7 дней и 1 месяц');
  assert.equal(reminderRulePhrase({ value: 15, unit: 'working_day' }), 'за 3 и 7 рабочих дней');
  assert.equal(reminderRulePhrase({ value: 7, unit: 'working_day' }), 'за 1 и 2 рабочих дня');
  assert.equal(reminderRulePhrase({ value: 3, unit: 'working_day' }), 'за 1 рабочий день');
  assert.equal(reminderRulePhrase(undefined), '');
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
