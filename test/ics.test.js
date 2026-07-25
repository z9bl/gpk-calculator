// Тест экспорта .ics (раздел 8, задача 5 SPEC.md).

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildICS, icsTermsFromChain } from '../src/ics.js';
import { computeChain } from '../src/chain.js';

const NOW = '2025-01-01T00:00:00Z'; // фиксируем DTSTAMP для детерминизма

const APPEAL = {
  title: 'Апелляционная жалоба',
  deadline: '2025-06-16',
  norm: 'ч. 1 ст. 321 ГПК РФ',
  ics: true,
  duration: { value: 1, unit: 'month' },
};
const TRANSFER = {
  title: 'Направление дела в апелляционную инстанцию',
  deadline: '2025-06-20',
  norm: 'ч. 4 ст. 321 ГПК РФ',
  ics: false,
  duration: { value: 3, unit: 'day' },
};

// Мини-парсер для валидации формата.
function parseICS(text) {
  assert.ok(text.includes('\r\n'), 'строки должны разделяться CRLF');
  const raw = text.split('\r\n');
  const enc = new TextEncoder();
  for (const line of raw) {
    assert.ok(enc.encode(line).length <= 75, `строка > 75 октетов: ${line}`);
  }
  const logical = [];
  for (const line of raw) {
    if (line === '') continue;
    if (line.startsWith(' ')) logical[logical.length - 1] += line.slice(1);
    else logical.push(line);
  }
  return logical;
}

test('4. Файл проходит валидацию формата', () => {
  const terms = [APPEAL, { ...APPEAL, title: 'Кассационная жалоба в КСОЮ', deadline: '2025-09-10', duration: { value: 3, unit: 'month' } }];
  const ics = buildICS(terms, { referenceDate: '2025-05-01', now: NOW });
  const lines = parseICS(ics);

  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines[lines.length - 1], 'END:VCALENDAR');
  assert.ok(lines.includes('VERSION:2.0'));
  assert.ok(lines.some((l) => l.startsWith('PRODID:')));

  // Сбалансированность BEGIN/END и обязательные поля VEVENT.
  const stack = [];
  let events = 0;
  let cur = null;
  for (const l of lines) {
    if (l.startsWith('BEGIN:')) {
      const t = l.slice(6);
      stack.push(t);
      if (t === 'VEVENT') { cur = new Set(); events += 1; }
    } else if (l.startsWith('END:')) {
      const t = l.slice(4);
      assert.equal(stack.pop(), t, 'BEGIN/END должны совпадать');
      if (t === 'VEVENT') {
        for (const req of ['UID', 'DTSTAMP', 'DTSTART', 'SUMMARY']) {
          assert.ok(cur.has(req), `в VEVENT нет обязательного ${req}`);
        }
        cur = null;
      }
    } else if (cur) {
      cur.add(l.split(/[:;]/)[0]);
    }
  }
  assert.equal(stack.length, 0, 'все блоки закрыты');
  assert.equal(events, 2);

  // Событие на весь день в дату дедлайна; норма в описании.
  assert.ok(lines.includes('DTSTART;VALUE=DATE:20250616'));
  assert.ok(lines.includes('SUMMARY:Апелляционная жалоба'));
  assert.ok(lines.some((l) => l.startsWith('DESCRIPTION:Норма: ч. 1 ст. 321')));
});

test('1. Сроки с ics: false в файл не попадают', () => {
  const ics = buildICS([APPEAL, TRANSFER], { referenceDate: '2025-05-01', now: NOW });
  assert.ok(ics.includes('SUMMARY:Апелляционная жалоба'));
  assert.ok(!ics.includes('Направление дела'), 'срок с ics:false не должен экспортироваться');
});

test('2. Напоминание, выпавшее на нерабочий день, сдвинуто назад', () => {
  // deadline 16.06.2025, срок 1 мес → напоминания за 14/7/3 дня: 02.06, 09.06, 13.06.
  // 13.06.2025 — нерабочий (перенос 08.03→13.06), 12.06 — праздник → сдвиг к 11.06.
  const ics = buildICS([APPEAL], { referenceDate: '2025-05-01', now: NOW });
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20250611T090000Z'), 'сдвинуто на 11.06 (пятница→среда рабочий)');
  assert.ok(!ics.includes('20250613T090000Z'), 'исходная нерабочая дата не должна остаться');
  // рабочие напоминания не сдвигаются
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20250602T090000Z'));
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20250609T090000Z'));
});

test('3. Напоминание раньше даты расчёта не создаётся', () => {
  // Дата расчёта 05.06.2025: напоминание за 14 дней (02.06) — в прошлом, отсекается.
  const ics = buildICS([APPEAL], { referenceDate: '2025-06-05', now: NOW });
  assert.ok(!ics.includes('20250602T090000Z'), 'напоминание до даты расчёта не создаётся');
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20250609T090000Z'), 'более позднее — остаётся');
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20250611T090000Z'));
});

test('интеграция: computeChain → icsTermsFromChain → buildICS (обжаловано)', () => {
  const chain = computeChain(
    {
      reasoned_decision_date: '2025-03-11',
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      appeal_ruling_reasoned_date: '2025-06-02',
    },
    { today: '2025-07-01' },
  );
  const terms = icsTermsFromChain(chain);
  // Обжаловано и вступление в силу разрешено → к апелляции и кассации
  // добавляется срок предъявления ИЛ (событие разрешено).
  assert.deepEqual(terms.map((t) => t.title), [
    'Апелляционная жалоба',
    'Кассационная жалоба в КСОЮ',
    'Предъявление исполнительного листа к исполнению',
  ]);
  const ics = buildICS(terms, { referenceDate: '2025-01-01', now: NOW });
  const events = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(events, 3);
  // кассация (3 мес) даёт до 4 напоминаний
  assert.ok((ics.match(/BEGIN:VALARM/g) || []).length >= 4);
});

test('pending: кассация не рассчитана — в экспорт попадает только апелляция', () => {
  const chain = computeChain({ reasoned_decision_date: '2025-03-11' }, { today: '2025-04-01' });
  const terms = icsTermsFromChain(chain);
  assert.deepEqual(terms.map((t) => t.title), ['Апелляционная жалоба']);
});

test('5. срок предъявления ИЛ уходит в .ics', () => {
  const chain = computeChain({ reasoned_decision_date: '2025-03-11' }, { today: '2025-05-01' });
  const terms = icsTermsFromChain(chain);
  const il = terms.find((t) => t.title.includes('исполнительного листа'));
  assert.ok(il, 'срок ИЛ в списке экспортируемых');
  assert.equal(il.deadline, chain.enforcement.deadline);

  const ics = buildICS(terms, { referenceDate: '2025-05-01', now: NOW });
  // SUMMARY длинная (кириллица) и сворачивается — проверяем префикс до сгиба.
  assert.ok(ics.includes('SUMMARY:Предъявление'));
  // событие на весь день в дату дедлайна
  const compact = chain.enforcement.deadline.replace(/-/g, '');
  assert.ok(ics.includes(`DTSTART;VALUE=DATE:${compact}`));
});
