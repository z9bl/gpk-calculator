// Тест цепочки обжалования (раздел 8, задача 3 SPEC.md).

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeChain, computeIndependentTerms, computeSimplified } from '../src/chain.js';

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

// --- Пограничное окно редакций (отсечка между датами) -----------------------

test('окно: прежний срок истёк до 01.09.2024, подача после → предупреждение с обеими датами', () => {
  const r = computeChain(
    {
      reasoned_decision_date: '2024-03-01',
      appeal_filed_date: '2024-03-20',
      appeal_ruling_date: '2024-05-15', // прежняя: 15.05 + 3 мес = 15.08.2024 (до отсечки)
      appeal_ruling_reasoned_date: '2024-06-20', // новая: 20.06 + 3 мес = 20.09.2024 (после)
      cassation_filed_date: '2024-09-15', // подача после отсечки → действует новая
    },
    { today: '2024-10-01' },
  );
  assert.equal(r.cassation.version_id, 'from_135fz');
  assert.equal(r.cassation.deadline, '2024-09-20'); // расчёт по действующей редакции
  assert.ok(r.cassation.boundary_warning);
  assert.equal(r.cassation.boundary_warning.prev_redaction_deadline, '2024-08-15');
  assert.equal(r.cassation.boundary_warning.current_deadline, '2024-09-20');
  assert.equal(r.cassation.boundary_warning.cutoff, '2024-09-01');
});

test('нет окна: обе даты после 01.09.2024 → без предупреждения', () => {
  const r = computeChain(
    {
      reasoned_decision_date: '2024-05-01',
      appeal_filed_date: '2024-05-20',
      appeal_ruling_date: '2024-07-01', // прежняя: 01.10.2024
      appeal_ruling_reasoned_date: '2024-07-10', // новая: 10.10.2024
      cassation_filed_date: '2024-11-01',
    },
    { today: '2024-12-01' },
  );
  assert.equal(r.cassation.version_id, 'from_135fz');
  assert.equal(r.cassation.boundary_warning, undefined);
});

test('нет окна: обе даты до 01.09.2024 → без предупреждения', () => {
  const r = computeChain(
    {
      reasoned_decision_date: '2024-02-01',
      appeal_filed_date: '2024-02-20',
      appeal_ruling_date: '2024-04-01', // прежняя: 01.07.2024
      appeal_ruling_reasoned_date: '2024-05-01', // новая: 01.08.2024
      cassation_filed_date: '2024-09-15', // действует новая, но обе даты до отсечки
    },
    { today: '2024-10-01' },
  );
  assert.equal(r.cassation.version_id, 'from_135fz');
  assert.equal(r.cassation.boundary_warning, undefined);
});

test('нет окна: действует прежняя редакция (подача до отсечки)', () => {
  const r = computeChain(
    {
      reasoned_decision_date: '2024-03-01',
      appeal_filed_date: '2024-03-20',
      appeal_ruling_date: '2024-05-15',
      appeal_ruling_reasoned_date: '2024-06-20',
      cassation_filed_date: '2024-08-20', // прежняя редакция действует
    },
    { today: '2024-10-01' },
  );
  assert.equal(r.cassation.version_id, 'before_135fz');
  assert.equal(r.cassation.boundary_warning, undefined);
});

// --- Кассация в Судебную коллегию ВС РФ (ст. 390.3) --------------------------

// Минимальный набор для узла ВС: цепочка до кассации не важна, нужна лишь дата
// определения КСОЮ. reasoned_decision_date обязателен для computeChain.
const VS_BASE = { reasoned_decision_date: '2023-01-01' };

test('узел ВС отсутствует без даты определения КСОЮ (condition)', () => {
  const r = computeChain(VS_BASE, { today: '2025-01-01' });
  assert.equal(r.cassation_vs, null);
});

test('ВС, прежняя редакция: отсчёт от даты вынесения определения КСОЮ', () => {
  const r = computeChain(
    { ...VS_BASE, ksoyu_ruling_date: '2023-04-12', vs_cassation_filed_date: '2023-07-01' },
    { today: '2023-07-20' },
  );
  assert.equal(r.cassation_vs.version_id, 'before_135fz');
  assert.equal(r.cassation_vs.anchor, '2023-04-12');
  assert.equal(r.cassation_vs.deadline, '2023-07-12');
  assert.equal(r.cassation_vs.alternative, undefined); // до 01.09.2024 расхождения нет
});

test('ВС, новая редакция: отсчёт от мотивированного определения КСОЮ + alternative', () => {
  const r = computeChain(
    {
      ...VS_BASE,
      ksoyu_ruling_date: '2024-06-02',
      ksoyu_ruling_reasoned_date: '2024-06-10',
      vs_cassation_filed_date: '2024-10-01',
    },
    { today: '2024-10-05' },
  );
  assert.equal(r.cassation_vs.version_id, 'from_135fz');
  assert.equal(r.cassation_vs.anchor, '2024-06-10');
  assert.equal(r.cassation_vs.deadline, '2024-09-10');
  assert.ok(r.cassation_vs.alternative);
  assert.equal(r.cassation_vs.alternative.deadline, '2024-09-02'); // от даты вынесения
});

test('ВС: alternative не появляется при совпадении дат вынесения и мотивированного', () => {
  const r = computeChain(
    {
      ...VS_BASE,
      ksoyu_ruling_date: '2024-06-02',
      ksoyu_ruling_reasoned_date: '2024-06-02',
      vs_cassation_filed_date: '2024-10-01',
    },
    { today: '2024-10-05' },
  );
  assert.equal(r.cassation_vs.alternative, undefined);
});

test('ВС: alternative не появляется до 01.09.2024 даже при разных датах', () => {
  const r = computeChain(
    {
      ...VS_BASE,
      ksoyu_ruling_date: '2024-06-02',
      ksoyu_ruling_reasoned_date: '2024-06-10',
      vs_cassation_filed_date: '2024-08-31',
    },
    { today: '2024-09-05' },
  );
  assert.equal(r.cassation_vs.version_id, 'before_135fz');
  assert.equal(r.cassation_vs.alternative, undefined);
  assert.equal(r.cassation_vs.anchor, '2024-06-02'); // от вынесения, не от мотивированного
});

test('ВС, граница редакций: 31.08.2024 → прежняя, 01.09.2024 → новая', () => {
  const inputs = {
    ...VS_BASE,
    ksoyu_ruling_date: '2024-06-02',
    ksoyu_ruling_reasoned_date: '2024-06-10',
  };
  const before = computeChain({ ...inputs, vs_cassation_filed_date: '2024-08-31' }, { today: '2024-12-01' });
  const after = computeChain({ ...inputs, vs_cassation_filed_date: '2024-09-01' }, { today: '2024-12-01' });
  assert.equal(before.cassation_vs.version_id, 'before_135fz');
  assert.equal(before.cassation_vs.anchor, '2024-06-02');
  assert.equal(after.cassation_vs.version_id, 'from_135fz');
  assert.equal(after.cassation_vs.anchor, '2024-06-10');
});

test('ВС, новая редакция без мотивированного определения → узел не считается', () => {
  const r = computeChain(
    { ...VS_BASE, ksoyu_ruling_date: '2024-06-02', vs_cassation_filed_date: '2024-10-01' },
    { today: '2024-10-05' },
  );
  assert.equal(r.cassation_vs, null);
});

test('ВС, пограничное окно: прежний срок истёк до 01.09.2024, подача после', () => {
  const r = computeChain(
    {
      ...VS_BASE,
      ksoyu_ruling_date: '2024-05-15', // прежняя: 15.08.2024 (до отсечки)
      ksoyu_ruling_reasoned_date: '2024-06-20', // новая: 20.09.2024 (после)
      vs_cassation_filed_date: '2024-09-15',
    },
    { today: '2024-10-01' },
  );
  assert.equal(r.cassation_vs.version_id, 'from_135fz');
  assert.equal(r.cassation_vs.deadline, '2024-09-20');
  assert.ok(r.cassation_vs.boundary_warning);
  assert.equal(r.cassation_vs.boundary_warning.prev_redaction_deadline, '2024-08-15');
  assert.equal(r.cassation_vs.boundary_warning.current_deadline, '2024-09-20');
});

// --- Предъявление исполнительного листа (ст. 21 ФЗ № 229-ФЗ, unit: year) -----

test('ИЛ: срок 3 года от даты вступления в силу (not_appealed)', () => {
  // reasoned 11.03.2025 → апелляция 11.04.2025 → вступление в силу 12.04.2025.
  const r = computeChain(BASE, { today: '2025-05-01' }); // not_appealed
  assert.equal(r.entry_into_force.date, '2025-04-12');
  assert.ok(r.enforcement);
  assert.equal(r.enforcement.anchor, '2025-04-12');
  assert.equal(r.enforcement.deadline, '2028-04-12'); // 12.04.2025 + 3 года
  assert.match(r.enforcement.norm.primary, /229-ФЗ/);
});

test('ИЛ отсутствует, пока вступление в силу не разрешено (pending)', () => {
  const r = computeChain(BASE, { today: '2025-04-01' }); // pending
  assert.equal(r.entry_into_force.resolved, false);
  assert.equal(r.enforcement, null);
});

// --- Узлы на механике рабочих дней (абз. 2 ч. 3 ст. 107) --------------------

test('замечания на протокол: 5 рабочих дней от подписания (ч. 1 ст. 231)', () => {
  const r = computeChain({ ...BASE, protocol_signed_date: '2025-12-28' }, { today: '2026-02-01' });
  assert.ok(r.protocol_remarks);
  assert.equal(r.protocol_remarks.anchor, '2025-12-28');
  assert.equal(r.protocol_remarks.first_working_day, '2025-12-29');
  assert.equal(r.protocol_remarks.deadline, '2026-01-14');
  assert.equal(r.protocol_remarks.shifted, false);
  assert.match(r.protocol_remarks.norm.primary, /ст\. 231/);
});

test('рассмотрение замечаний: 5 рабочих дней от подачи (ч. 2 ст. 232)', () => {
  // Дата подачи указана → срок считается от неё.
  const filed = computeChain(
    { ...BASE, protocol_signed_date: '2025-12-28', protocol_remarks_filed_date: '2026-01-13' },
    { today: '2026-02-01' },
  );
  assert.equal(filed.protocol_remarks_review.anchor, '2026-01-13');
  assert.equal(filed.protocol_remarks_review.anchor_is_assumed, false);
  assert.match(filed.protocol_remarks_review.norm.primary, /ст\. 232/);

  // Дата подачи не указана → от последнего дня срока подачи, с пометкой.
  const assumed = computeChain(
    { ...BASE, protocol_signed_date: '2025-12-28' },
    { today: '2026-02-01' },
  );
  assert.equal(assumed.protocol_remarks_review.anchor, assumed.protocol_remarks.deadline);
  assert.equal(assumed.protocol_remarks_review.anchor_is_assumed, true);
  assert.match(assumed.protocol_remarks_review.anchor_note, /не указана/);
});

test('частная жалоба: 15 рабочих дней от вынесения определения (ст. 332)', () => {
  const r = computeChain({ ...BASE, interim_ruling_date: '2025-12-26' }, { today: '2026-02-01' });
  assert.ok(r.private_complaint);
  assert.equal(r.private_complaint.deadline, '2026-01-28');
  assert.equal(r.private_complaint.shifted, false);
  assert.match(r.private_complaint.norm.primary, /ст\. 332/);
});

test('узлы в рабочих днях отсутствуют без своих input (condition)', () => {
  const r = computeChain(BASE, { today: '2026-02-01' });
  assert.equal(r.protocol_remarks, null);
  assert.equal(r.protocol_remarks_review, null);
  assert.equal(r.private_complaint, null);
});

test('независимые сроки считаются без даты мотивированного решения', () => {
  // computeIndependentTerms не требует цепочки — узлы доступны сами по себе.
  const t = computeIndependentTerms({ interim_ruling_date: '2025-12-26' });
  assert.equal(t.private_complaint.deadline, '2026-01-28');
  assert.equal(t.protocol_remarks, null);
});

// --- Упрощённое производство (глава 21.1 ГПК) --------------------------------
// Все сроки в рабочих днях (п. 16–17 ПП ВС № 16). Резолютивная часть подписана
// 22.12.2025 — сроки пересекают январские каникулы.

const SIMPL = { simplified_resolution_date: '2025-12-22' };

test('упрощённое: узла нет без даты резолютивной части', () => {
  assert.equal(computeSimplified({}), null);
  assert.equal(computeChain(BASE, { today: '2026-03-01' }).simplified, null);
});

test('упрощённое: заявление о мотивированном решении — 5 рабочих дней (ч. 3 ст. 232.4)', () => {
  const s = computeSimplified(SIMPL);
  assert.equal(s.reasoned_request.first_working_day, '2025-12-23');
  assert.equal(s.reasoned_request.deadline, '2025-12-29');
  assert.match(s.reasoned_request.norm.primary, /ч\. 3 ст\. 232\.4/);
});

test('упрощённое: апелляция — 15 рабочих дней, пересечение январских каникул', () => {
  const s = computeSimplified(SIMPL);
  // 23.12 (1) ... каникулы 31.12–11.01 ... 22.01.2026 (15)
  assert.equal(s.appeal.deadline, '2026-01-22');
  assert.equal(s.appeal.anchor_kind, 'resolution');
  assert.ok(s.appeal.deadline > '2026-01-11', 'срок уезжает за каникулы');
  // 15 календарных дней дали бы 06.01.2026 — внутри каникул, на две недели раньше.
  assert.ok(s.appeal.deadline > '2026-01-06');
  assert.match(s.appeal.norm.primary, /ч\. 8 ст\. 232\.4/);
});

test('упрощённое: обе точки отсчёта апелляции', () => {
  // Без мотивированного решения — со дня принятия (резолютивной части).
  const plain = computeSimplified(SIMPL);
  assert.equal(plain.appeal.anchor, '2025-12-22');
  assert.equal(plain.appeal.deadline, '2026-01-22');

  // С мотивированным решением — со дня принятия в окончательной форме.
  const reasoned = computeSimplified({ ...SIMPL, simplified_reasoned_date: '2026-01-15' });
  assert.equal(reasoned.appeal.anchor, '2026-01-15');
  assert.equal(reasoned.appeal.anchor_kind, 'reasoned');
  assert.equal(reasoned.appeal.deadline, '2026-02-05');
  assert.notEqual(reasoned.appeal.deadline, plain.appeal.deadline);
});

test('упрощённое: 10 рабочих дней на изготовление — от заявления и от подачи жалобы', () => {
  // От поступления заявления (ч. 4 ст. 232.4).
  const byRequest = computeSimplified({ ...SIMPL, simplified_reasoned_request_date: '2025-12-24' });
  assert.equal(byRequest.reasoned_making.trigger, 'request');
  assert.equal(byRequest.reasoned_making.anchor, '2025-12-24');
  assert.equal(byRequest.reasoned_making.deadline, '2026-01-19');

  // От подачи апелляционной жалобы, если заявления не было.
  const byAppeal = computeSimplified({ ...SIMPL, simplified_appeal_filed_date: '2025-12-25' });
  assert.equal(byAppeal.reasoned_making.trigger, 'appeal_filed');
  assert.equal(byAppeal.reasoned_making.anchor, '2025-12-25');
  assert.equal(byAppeal.reasoned_making.deadline, '2026-01-20');

  // Если есть оба факта — от более раннего.
  const both = computeSimplified({
    ...SIMPL,
    simplified_reasoned_request_date: '2025-12-24',
    simplified_appeal_filed_date: '2025-12-25',
  });
  assert.equal(both.reasoned_making.trigger, 'request');
  assert.equal(both.reasoned_making.anchor, '2025-12-24');

  // Без обоих фактов срок изготовления не считается.
  assert.equal(computeSimplified(SIMPL).reasoned_making, null);
});

test('упрощённое, ч. 5: жалоба не подана → по истечении 15 дней со дня принятия', () => {
  const s = computeSimplified(SIMPL);
  assert.equal(s.entry_into_force.branch, 'not_appealed');
  assert.match(s.entry_into_force.part, /ч\. 5 ст\. 232\.4/);
  assert.equal(s.entry_into_force.resolved, true);
  assert.equal(s.entry_into_force.date, '2026-01-23'); // дедлайн 22.01 + 1
});

test('упрощённое, ч. 6: составлено мотивированное → по истечении срока по ч. 8', () => {
  const s = computeSimplified({ ...SIMPL, simplified_reasoned_date: '2026-01-15' });
  assert.equal(s.entry_into_force.branch, 'reasoned');
  assert.match(s.entry_into_force.part, /ч\. 6 ст\. 232\.4/);
  assert.equal(s.entry_into_force.resolved, true);
  assert.equal(s.entry_into_force.date, '2026-02-06'); // дедлайн 05.02 + 1
});

test('упрощённое, ч. 7: подана жалоба → со дня определения апелляции, дата не вычисляется', () => {
  const s = computeSimplified({ ...SIMPL, simplified_appeal_filed_date: '2026-01-20' });
  assert.equal(s.entry_into_force.branch, 'appealed');
  assert.match(s.entry_into_force.part, /ч\. 7 ст\. 232\.4/);
  assert.equal(s.entry_into_force.resolved, false);
  assert.equal(s.entry_into_force.date, null);
  assert.match(s.entry_into_force.message, /определения судом апелляционной инстанции/);
  assert.match(s.entry_into_force.note, /не заложена/);
});

test('упрощённое: событие — своё, по ст. 232.4, а не общее по ч. 1 ст. 209', () => {
  const r = computeChain({ ...BASE, ...SIMPL }, { today: '2026-03-01' });
  assert.match(r.simplified.entry_into_force.norm, /232\.4/);
  assert.match(r.entry_into_force.norm, /ст\. 209/); // общая цепочка не затронута
  assert.notEqual(r.simplified.entry_into_force.date, r.entry_into_force.date);
});
