// Тест цепочки обжалования (раздел 8, задача 3 SPEC.md).

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeChain } from '../src/chain.js';

// Базовые входные данные. reasoned_decision_date = 11.03.2025 (вторник),
// апелляция 1 месяц → 11.04.2025 (пятница, рабочий).
const BASE = { reasoned_decision_date: '2025-03-11' };
const APPEAL_DEADLINE = '2025-04-11';

test('appeal_general считается от reasoned_decision_date', () => {
  const { appeal } = computeChain(BASE, { today: '2025-04-01' });
  assert.equal(appeal.deadline, APPEAL_DEADLINE);
});

test('1. not_appealed: срок истёк → cassation_anchor = дата вступления в силу', () => {
  const r = computeChain(BASE, { today: '2025-05-01' }); // после дедлайна апелляции
  assert.equal(r.entry_into_force.branch, 'not_appealed');
  assert.equal(r.entry_into_force.resolved, true);
  // Вступление в силу = дедлайн апелляции + 1 день.
  assert.equal(r.entry_into_force.date, '2025-04-12');
  // sets: cassation_anchor = entry_into_force.date
  assert.equal(r.cassation.anchor, r.entry_into_force.date);
  assert.equal(r.cassation.anchor, '2025-04-12');
});

test('2. appealed: cassation_anchor = appeal_ruling_reasoned_date; без подачи — другой якорь и итог', () => {
  const appealedInputs = {
    ...BASE,
    appeal_filed_date: '2025-04-05',
    appeal_ruling_date: '2025-06-02',
    appeal_ruling_reasoned_date: '2025-06-02',
  };
  const appealed = computeChain(appealedInputs, { today: '2025-07-01' });
  assert.equal(appealed.entry_into_force.branch, 'appealed');
  // sets: cassation_anchor = appeal_ruling_reasoned_date
  assert.equal(appealed.cassation.anchor, '2025-06-02');
  assert.equal(appealed.cassation.deadline, '2025-09-02'); // 02.06 + 3 мес

  // Тот же набор без appeal_filed_date → ветвь not_appealed, другой якорь и итог.
  const notAppealed = computeChain(BASE, { today: '2025-07-01' });
  assert.equal(notAppealed.entry_into_force.branch, 'not_appealed');
  assert.equal(notAppealed.cassation.anchor, '2025-04-12');
  assert.notEqual(notAppealed.cassation.anchor, appealed.cassation.anchor);
  assert.notEqual(notAppealed.cassation.deadline, appealed.cassation.deadline);
});

test('appealed: дата принятия есть, мотивированного нет → событие разрешено, кассация не считается', () => {
  const r = computeChain(
    { ...BASE, appeal_filed_date: '2025-04-05', appeal_ruling_date: '2025-06-02' },
    { today: '2025-07-01' },
  );
  assert.equal(r.entry_into_force.branch, 'appealed');
  assert.equal(r.entry_into_force.resolved, true);
  assert.equal(r.entry_into_force.date, '2025-06-02'); // = дата принятия определения
  assert.equal(r.cassation, null); // нет точки отсчёта (мотивированное определение)
});

test('appealed: жалоба подана, дат определения нет → событие не разрешено, без throw', () => {
  const r = computeChain({ ...BASE, appeal_filed_date: '2025-04-05' }, { today: '2025-07-01' });
  assert.equal(r.entry_into_force.branch, 'appealed');
  assert.equal(r.entry_into_force.resolved, false);
  assert.equal(r.entry_into_force.date, null);
  assert.equal(r.cassation, null);
});

test('3. pending: срок ещё течёт → кассация не считается, «вступит в силу не ранее …»', () => {
  const r = computeChain(BASE, { today: '2025-04-01' }); // до дедлайна апелляции
  assert.equal(r.entry_into_force.branch, 'pending');
  assert.equal(r.entry_into_force.resolved, false);
  assert.equal(r.entry_into_force.date, null);
  assert.equal(r.cassation, null);
  assert.equal(r.entry_into_force.not_earlier_than, '2025-04-12');
  assert.match(r.entry_into_force.message, /не ранее 2025-04-12/);
});

test('граница: today == дедлайн апелляции → ещё pending (срок последнего дня не истёк)', () => {
  const r = computeChain(BASE, { today: APPEAL_DEADLINE });
  assert.equal(r.entry_into_force.branch, 'pending');
});

test('4. condition: пока entry_into_force не разрешено (pending) — кассация не рассчитывается', () => {
  const r = computeChain(BASE, { today: '2025-04-01' });
  assert.equal(r.entry_into_force.resolved, false);
  assert.equal(r.cassation, null);
});

test('5a. alternative_calculation: даты совпадают → блока нет', () => {
  const r = computeChain(
    {
      ...BASE,
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      appeal_ruling_reasoned_date: '2025-06-02', // == принятию
    },
    { today: '2025-07-01' },
  );
  assert.equal(r.cassation.alternative, undefined);
});

test('5b. alternative_calculation: reasoned > ruling → обе даты, prefer earliest', () => {
  const r = computeChain(
    {
      ...BASE,
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02', // принятие
      appeal_ruling_reasoned_date: '2025-06-10', // мотивированное позже
    },
    { today: '2025-07-01' },
  );
  // Основная дата — по закону, от мотивированного определения (10.06 + 3 мес).
  assert.equal(r.cassation.anchor, '2025-06-10');
  assert.equal(r.cassation.deadline, '2025-09-10');
  // Альтернатива — по п. 12 ПП ВС № 17, от даты принятия (02.06 + 3 мес).
  assert.ok(r.cassation.alternative);
  assert.equal(r.cassation.alternative.anchor, '2025-06-02');
  assert.equal(r.cassation.alternative.deadline, '2025-09-02');
  // prefer: earliest → рекомендуется более ранняя (02.09).
  assert.equal(r.cassation.alternative.prefer, 'earliest');
  assert.equal(r.cassation.alternative.recommended_deadline, '2025-09-02');
});

test('пропуск текущей даты для ветви not_appealed/pending — явная ошибка', () => {
  assert.throws(() => computeChain(BASE), /текущая дата/);
});

// --- Темпоральная модель нормы (ч. 3 ст. 1 ГПК) -----------------------------

test('прежняя редакция: реальное дело — подача 07.07.2023, определение 12.04.2023 → 12.07.2023', () => {
  const r = computeChain(
    {
      reasoned_decision_date: '2023-02-01',
      appeal_filed_date: '2023-03-01',
      appeal_ruling_date: '2023-04-12', // апелляционное определение принято
      cassation_filed_date: '2023-07-07', // подача до 01.09.2024 → прежняя редакция
    },
    { today: '2023-07-20' },
  );
  assert.equal(r.cassation.version_id, 'before_135fz');
  // Три месяца со дня вступления в силу (= даты принятия определения).
  assert.equal(r.cassation.anchor, '2023-04-12');
  assert.equal(r.cassation.deadline, '2023-07-12'); // жалоба 07.07 подана в срок
  assert.equal(r.cassation.alternative, undefined); // до 01.09.2024 расхождения нет
});

test('прежняя редакция считается без даты мотивированного определения', () => {
  // Точка отсчёта прежней редакции — вступление в силу, reasoned не нужен.
  const r = computeChain(
    {
      reasoned_decision_date: '2023-02-01',
      appeal_filed_date: '2023-03-01',
      appeal_ruling_date: '2023-04-12',
      cassation_filed_date: '2023-07-07',
    },
    { today: '2023-07-20' },
  );
  assert.ok(r.cassation);
  assert.equal(r.cassation.deadline, '2023-07-12');
});

test('новая редакция: подача после 01.09.2024 → отсчёт от мотивированного определения', () => {
  const r = computeChain(
    {
      reasoned_decision_date: '2024-05-01',
      appeal_filed_date: '2024-05-15',
      appeal_ruling_date: '2024-06-02',
      appeal_ruling_reasoned_date: '2024-06-10',
      cassation_filed_date: '2024-10-01',
    },
    { today: '2024-10-05' },
  );
  assert.equal(r.cassation.version_id, 'from_135fz');
  assert.equal(r.cassation.anchor, '2024-06-10'); // мотивированное определение
  assert.equal(r.cassation.deadline, '2024-09-10');
  assert.ok(r.cassation.alternative); // конфликт с ПП ВС № 17 существует
  assert.equal(r.cassation.alternative.deadline, '2024-09-02');
});

test('alternative_calculation не появляется для подач до 01.09.2024 даже при разных датах определения', () => {
  const r = computeChain(
    {
      reasoned_decision_date: '2024-04-01',
      appeal_filed_date: '2024-04-10',
      appeal_ruling_date: '2024-06-02',
      appeal_ruling_reasoned_date: '2024-06-10', // отличается от принятия
      cassation_filed_date: '2024-08-31', // последний день прежней редакции
    },
    { today: '2024-09-05' },
  );
  assert.equal(r.cassation.version_id, 'before_135fz');
  assert.equal(r.cassation.alternative, undefined);
  assert.equal(r.cassation.anchor, '2024-06-02'); // от вступления в силу, не от мотивированного
});

test('граница редакций: 31.08.2024 → прежняя, 01.09.2024 → новая', () => {
  const base = {
    reasoned_decision_date: '2024-01-01',
    appeal_filed_date: '2024-02-01',
    appeal_ruling_date: '2024-06-02',
    appeal_ruling_reasoned_date: '2024-06-10',
  };
  const before = computeChain({ ...base, cassation_filed_date: '2024-08-31' }, { today: '2024-12-01' });
  const after = computeChain({ ...base, cassation_filed_date: '2024-09-01' }, { today: '2024-12-01' });
  assert.equal(before.cassation.version_id, 'before_135fz');
  assert.equal(before.cassation.anchor, '2024-06-02'); // вступление в силу
  assert.equal(after.cassation.version_id, 'from_135fz');
  assert.equal(after.cassation.anchor, '2024-06-10'); // мотивированное определение
});

test('без даты подачи кассации редакция выбирается по текущей дате', () => {
  const inputs = {
    reasoned_decision_date: '2024-01-01',
    appeal_filed_date: '2024-02-01',
    appeal_ruling_date: '2024-06-02',
    appeal_ruling_reasoned_date: '2024-06-10',
  };
  assert.equal(computeChain(inputs, { today: '2024-08-15' }).cassation.version_id, 'before_135fz');
  assert.equal(computeChain(inputs, { today: '2025-01-15' }).cassation.version_id, 'from_135fz');
});
