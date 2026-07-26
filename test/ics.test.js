// Тест экспорта .ics (раздел 8, задача 5 SPEC.md).

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildICS, icsTermsFromChain } from '../src/ics.js';
import { computeChain } from '../src/chain.js';
import { addDays, addMonths } from '../src/engine.js';
import { toISODate, isWorkingDay, shiftBackIfNonWorking, subtractWorkingDays } from '../src/calendar.js';

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

// --- Напоминания для сроков в годах (3 года: 3 мес / 1 мес / 7 дней) --------

// Срок предъявления ИЛ (3 года) с дедлайном 10.07.2028. Заранее проверено:
// 3 мес назад → 10.04.2028 (пн, рабочий); 1 мес назад → 10.06.2028 (сб,
// нерабочий → сдвиг на 09.06.2028, пт); 7 дней назад → 03.07.2028 (пн, рабочий).
const IL_TERM = {
  title: 'Предъявление исполнительного листа к исполнению',
  deadline: '2028-07-10',
  norm: 'ч. 1 ст. 21 ФЗ от 02.10.2007 № 229-ФЗ',
  ics: true,
  duration: { value: 3, unit: 'year' },
};

test('1. срок в годах: все три напоминания создаются на верных датах', () => {
  const ics = buildICS([IL_TERM], { referenceDate: '2025-01-01', now: NOW });
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20280410T090000Z')); // 3 мес
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20280609T090000Z')); // 1 мес, сдвинут с 10.06 (сб)
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20280703T090000Z')); // 7 дней
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 3);
});

test('2. смещение в месяцах клампится: 31.05.2027 - 3 мес = 28.02.2027 (в феврале нет 31 числа)', () => {
  // Клампинг, независимо от переноса выходного (та же логика, что addMonths).
  assert.equal(toISODate(addMonths('2027-05-31', -3)), '2027-02-28');

  // 28.02.2027 — воскресенье, поэтому итоговый триггер сдвинут назад на
  // рабочий день (26.02.2027, пятница; 27.02 — суббота).
  const term = { ...IL_TERM, deadline: '2027-05-31' };
  const ics = buildICS([term], { referenceDate: '2025-01-01', now: NOW });
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20270226T090000Z'));
  assert.ok(!ics.includes('20270228T090000Z'), 'нерабочая дата 28.02 не должна остаться');
});

test('3. напоминание, выпавшее на нерабочий день, сдвинуто назад', () => {
  // 1-месячное напоминание для дедлайна 10.07.2028: 10.06.2028 — суббота.
  const ics = buildICS([IL_TERM], { referenceDate: '2025-01-01', now: NOW });
  assert.ok(!ics.includes('20280610T090000Z'), 'исходная нерабочая дата не должна остаться');
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20280609T090000Z'));
});

test('4. расчёт от старого решения: часть напоминаний в прошлом — создаются только будущие', () => {
  // referenceDate после 3-месячного (10.04) и сдвинутого 1-месячного (09.06)
  // напоминаний, но до 7-дневного (03.07) — создаётся только последнее.
  const ics = buildICS([IL_TERM], { referenceDate: '2028-06-15', now: NOW });
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 1);
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20280703T090000Z'));
  assert.ok(!ics.includes('20280410T090000Z'));
  assert.ok(!ics.includes('20280609T090000Z'));
});

// --- Напоминания для сроков в рабочих днях -----------------------------------
// Смещения считаются в рабочих днях: срок исчисляется в них же, а календарное
// смещение на каникулах даёт меньший запас, чем задумано (см. проверку ниже).

// Замечания на протокол: 5 рабочих дней от 28.12.2025 → дедлайн 14.01.2026.
const REMARKS_TERM = {
  title: 'Замечания на протокол судебного заседания',
  deadline: '2026-01-14',
  norm: 'ч. 1 ст. 231 ГПК РФ',
  ics: true,
  duration: { value: 5, unit: 'working_day' },
};

// Частная жалоба: 15 рабочих дней от 15.12.2025 → дедлайн 15.01.2026
// (срок пересекает январские каникулы).
const COMPLAINT_TERM = {
  title: 'Частная жалоба на определение суда первой инстанции',
  deadline: '2026-01-15',
  norm: 'ст. 332 ГПК РФ',
  ics: true,
  duration: { value: 15, unit: 'working_day' },
};

test('для 5-дневного срока создаётся ровно одно напоминание (за 2 рабочих дня)', () => {
  const ics = buildICS([REMARKS_TERM], { referenceDate: '2025-12-29', now: NOW });
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 1);
  // 14.01 → 13.01 (1) → 12.01 (2)
  assert.ok(ics.includes('TRIGGER;VALUE=DATE-TIME:20260112T090000Z'));
});

test('срок, пересекающий январские каникулы: напоминания не уходят раньше даты расчёта', () => {
  const referenceDate = '2025-12-16'; // день расчёта, сразу после вынесения определения
  const ics = buildICS([COMPLAINT_TERM], { referenceDate, now: NOW });

  // Оба напоминания созданы (ни одно не отсеяно как прошлое).
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
  const triggers = [...ics.matchAll(/TRIGGER;VALUE=DATE-TIME:(\d{4})(\d{2})(\d{2})T/g)].map(
    (m) => `${m[1]}-${m[2]}-${m[3]}`,
  );
  // 15.01 − 7 рабочих = 25.12.2025 (через каникулы); 15.01 − 3 рабочих = 12.01.2026.
  assert.deepEqual(triggers, ['2025-12-25', '2026-01-12']);

  for (const t of triggers) {
    assert.ok(t >= referenceDate, `напоминание ${t} не раньше даты расчёта`);
    assert.ok(t <= COMPLAINT_TERM.deadline, `напоминание ${t} не позже дедлайна`);
    assert.ok(isWorkingDay(t), `напоминание ${t} — рабочий день по построению`);
  }
});

test('смещение в рабочих днях даёт больший запас, чем календарное, на каникулах', () => {
  // 7 рабочих дней назад от 15.01.2026 = 25.12.2025 — семь рабочих дней запаса.
  assert.equal(subtractWorkingDays('2026-01-15', 7), '2025-12-25');
  // 7 календарных дней назад = 08.01.2026 — нерабочий день внутри каникул;
  // после сдвига назад это 30.12.2025, то есть всего 4 рабочих дня запаса.
  const calendarRaw = toISODate(addDays('2026-01-15', -7));
  assert.equal(calendarRaw, '2026-01-08');
  assert.ok(!isWorkingDay(calendarRaw));
  assert.equal(shiftBackIfNonWorking(calendarRaw), '2025-12-30');
  assert.equal(subtractWorkingDays('2026-01-15', 4), '2025-12-30');
});
