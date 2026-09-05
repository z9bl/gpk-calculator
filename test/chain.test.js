// Тест цепочки обжалования (раздел 8, задача 3 SPEC.md).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeChain,
  computeIndependentTerms,
  computeSimplified,
  computeDefaultJudgment,
  computeDefaultJudgmentForeignState,
  computeMirovoy,
  applyInterruptions,
  interruptionEvents,
  CASSATION_RETURN_RULING_APPEAL,
  ARBITRATION_COMPETENCE_APPEAL,
  SETTLEMENT_APPROVAL_CASSATION_APPEAL,
  REVIEW_GROUNDS,
} from '../src/chain.js';

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
  // Альтернатива — по п. 12 ПП ВС РФ от 22.06.2021 № 17, от даты принятия (02.06 + 3 мес).
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
  assert.ok(r.cassation.alternative); // конфликт с ПП ВС РФ от 22.06.2021 № 17 существует
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
// Все сроки в рабочих днях (п. 16–17 ПП ВС РФ от 22.06.2021 № 16). Резолютивная часть подписана
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

test('упрощённое, ч. 7: без даты определения апелляции — не разрешено, но поле предложено', () => {
  const s = computeSimplified({ ...SIMPL, simplified_appeal_filed_date: '2026-01-20' });
  assert.equal(s.entry_into_force.branch, 'appealed');
  assert.match(s.entry_into_force.part, /ч\. 7 ст\. 232\.4/);
  assert.equal(s.entry_into_force.resolved, false);
  assert.equal(s.entry_into_force.date, null);
  assert.match(s.entry_into_force.message, /определения судом апелляционной инстанции/);
  assert.deepEqual(s.entry_into_force.missing_inputs, ['simplified_appeal_ruling_date']);
});

test('упрощённое, ч. 7: с датой определения апелляции — событие разрешено', () => {
  const s = computeSimplified({
    ...SIMPL,
    simplified_appeal_filed_date: '2026-01-20',
    simplified_appeal_ruling_date: '2026-03-05',
  });
  assert.equal(s.entry_into_force.branch, 'appealed');
  assert.equal(s.entry_into_force.resolved, true);
  assert.equal(s.entry_into_force.date, '2026-03-05');
});

test('упрощённое: событие — своё, по ст. 232.4, а не общее по ч. 1 ст. 209', () => {
  const r = computeChain({ ...BASE, ...SIMPL }, { today: '2026-03-01' });
  assert.match(r.simplified.entry_into_force.norm, /232\.4/);
  assert.match(r.entry_into_force.norm, /ст\. 209/); // общая цепочка не затронута
  assert.notEqual(r.simplified.entry_into_force.date, r.entry_into_force.date);
});

test('упрощённое: предъявление ИЛ — 3 года со дня вступления в силу (все ветви)', () => {
  // ч. 5 — жалоба не подана: событие разрешено, ИЛ считается от его даты.
  const ch5 = computeSimplified(SIMPL);
  assert.equal(ch5.entry_into_force.date, '2026-01-23');
  assert.ok(ch5.enforcement);
  assert.equal(ch5.enforcement.id, 'simplified_enforcement_presentation');
  assert.equal(ch5.enforcement.anchor, '2026-01-23');
  assert.equal(ch5.enforcement.deadline, '2029-01-23'); // + 3 года
  assert.match(ch5.enforcement.norm.primary, /229-ФЗ/);

  // ч. 6 — составлено мотивированное решение: ИЛ от даты события этой ветви.
  const ch6 = computeSimplified({ ...SIMPL, simplified_reasoned_date: '2026-01-15' });
  assert.equal(ch6.enforcement.anchor, '2026-02-06');

  // ч. 7 — обжаловано, определение известно: ИЛ от даты вступления в силу.
  const ch7 = computeSimplified({
    ...SIMPL,
    simplified_appeal_filed_date: '2026-01-20',
    simplified_appeal_ruling_date: '2026-03-05',
  });
  assert.equal(ch7.enforcement.anchor, '2026-03-05');
});

test('упрощённое: ИЛ отсутствует, пока событие не разрешено (ч. 7 без определения)', () => {
  const s = computeSimplified({ ...SIMPL, simplified_appeal_filed_date: '2026-01-20' });
  assert.equal(s.entry_into_force.resolved, false);
  assert.equal(s.enforcement, null);
});

test('упрощённое: кассация в КСОЮ — обе точки отсчёта', () => {
  // Не обжаловалось (ч. 5): со дня вступления в силу.
  const notAppealed = computeSimplified(SIMPL, '2026-03-01');
  assert.ok(notAppealed.cassation);
  assert.equal(notAppealed.cassation.id, 'simplified_cassation_ksoyu');
  assert.equal(notAppealed.cassation.version_id, 'from_135fz');
  assert.equal(notAppealed.cassation.anchor, notAppealed.entry_into_force.date);
  assert.equal(notAppealed.cassation.anchor, '2026-01-23');
  assert.match(notAppealed.cassation.norm.primary, /ст\. 376\.1/);

  // Обжаловалось: со дня изготовления мотивированного апелляционного определения.
  const appealed = computeSimplified(
    {
      ...SIMPL,
      simplified_appeal_filed_date: '2026-01-20',
      simplified_appeal_ruling_date: '2026-03-05',
      simplified_appeal_ruling_reasoned_date: '2026-03-12',
    },
    '2026-03-01',
  );
  assert.equal(appealed.cassation.anchor, '2026-03-12'); // изготовление, не принятие
});

test('упрощённое: исчерпание способов обжалования (3.7) — как в общей цепочке', () => {
  // Не обжаловалось → предупреждение показывается.
  const notAppealed = computeSimplified(SIMPL, '2026-03-01');
  assert.ok(notAppealed.cassation.exhaustion_warning);
  assert.equal(notAppealed.cassation.exhaustion_warning.code, 'appeal_not_exhausted');

  // Обжаловалось → способы исчерпаны, предупреждения нет.
  const appealed = computeSimplified(
    {
      ...SIMPL,
      simplified_appeal_filed_date: '2026-01-20',
      simplified_appeal_ruling_date: '2026-03-05',
      simplified_appeal_ruling_reasoned_date: '2026-03-12',
    },
    '2026-03-01',
  );
  assert.equal(appealed.cassation.exhaustion_warning, undefined);
});

test('упрощённое: alternative_calculation при различии дат принятия и изготовления', () => {
  const differ = computeSimplified(
    {
      ...SIMPL,
      simplified_appeal_filed_date: '2026-01-20',
      simplified_appeal_ruling_date: '2026-03-05', // принятие
      simplified_appeal_ruling_reasoned_date: '2026-03-12', // изготовление позже
    },
    '2026-03-01',
  );
  assert.ok(differ.cassation.alternative);
  assert.equal(differ.cassation.alternative.anchor, '2026-03-05'); // от принятия (п. 12 ПП ВС)
  assert.match(differ.cassation.alternative.norm, /п\. 12 ПП ВС РФ от 22\.06\.2021 № 17/);

  // Даты совпадают — расхождения нет, альтернативы нет.
  const same = computeSimplified(
    {
      ...SIMPL,
      simplified_appeal_filed_date: '2026-01-20',
      simplified_appeal_ruling_date: '2026-03-05',
      simplified_appeal_ruling_reasoned_date: '2026-03-05',
    },
    '2026-03-01',
  );
  assert.equal(same.cassation.alternative, undefined);
});

test('упрощённое: кассации нет, пока событие вступления в силу не разрешено', () => {
  const s = computeSimplified({ ...SIMPL, simplified_appeal_filed_date: '2026-01-20' }, '2026-03-01');
  assert.equal(s.entry_into_force.resolved, false);
  assert.equal(s.cassation, null);
});

// --- Заочное решение (ст. 237 ГПК) ------------------------------------------
// Вручение копии 22.12.2025 → семидневный срок пересекает январские каникулы.

const DJ = { default_judgment_service_date: '2025-12-22' };

test('заочное: узла нет без даты вручения копии', () => {
  assert.equal(computeDefaultJudgment({}), null);
  assert.equal(computeChain(BASE, { today: '2026-03-01' }).default_judgment, null);
});

test('заочное: 7 рабочих дней на заявление об отмене через январские каникулы', () => {
  const d = computeDefaultJudgment(DJ);
  assert.equal(d.cancellation_request.first_working_day, '2025-12-23');
  // 23,24,25,26,29,30.12 (6) → каникулы → 12.01.2026 (7)
  assert.equal(d.cancellation_request.deadline, '2026-01-12');
  assert.ok(d.cancellation_request.deadline > '2026-01-11', 'срок уезжает за каникулы');
  assert.match(d.cancellation_request.norm.primary, /ч\. 1 ст\. 237/);
  assert.match(d.cancellation_request.logic, /возобновляется/); // оговорка об отмене
});

test('заочное, ответчик: месяц со дня определения об отказе (абз. 1 ч. 2 ст. 237)', () => {
  const d = computeDefaultJudgment({ ...DJ, default_judgment_refusal_date: '2026-02-10' });
  assert.equal(d.subject, 'defendant');
  assert.equal(d.appeal.anchor, '2026-02-10');
  assert.equal(d.appeal.anchor_kind, 'refusal');
  assert.equal(d.appeal.deadline, '2026-03-10');
  assert.match(d.appeal.norm.primary, /абз\. 1 ч\. 2 ст\. 237/);
});

test('заочное, ответчик без определения об отказе: апелляция не считается', () => {
  const d = computeDefaultJudgment(DJ);
  assert.equal(d.appeal, null);
  assert.deepEqual(d.appeal_blocked.missing, ['default_judgment_refusal_date']);
});

test('заочное, иные лица без заявления ответчика: месяц по истечении срока подачи', () => {
  const d = computeDefaultJudgment({ ...DJ, default_judgment_subject: 'other_persons' });
  assert.equal(d.subject, 'other_persons');
  assert.equal(d.appeal.anchor_kind, 'request_deadline');
  // якорь — последний день семидневного срока (12.01.2026), месяц → 12.02.2026
  assert.equal(d.appeal.anchor, d.cancellation_request.deadline);
  assert.equal(d.appeal.deadline, '2026-02-12');
  assert.match(d.appeal.norm.primary, /абз\. 2 ч\. 2 ст\. 237/);
});

test('заочное, иные лица с заявлением ответчика: месяц со дня определения об отказе', () => {
  const d = computeDefaultJudgment({
    ...DJ,
    default_judgment_subject: 'other_persons',
    default_judgment_cancellation_request_date: '2025-12-30',
    default_judgment_refusal_date: '2026-02-10',
  });
  assert.equal(d.appeal.anchor_kind, 'refusal');
  assert.equal(d.appeal.anchor, '2026-02-10');
  assert.equal(d.appeal.deadline, '2026-03-10');
  assert.match(d.appeal.norm.primary, /абз\. 2 ч\. 2 ст\. 237/);
  // Ветвь субъекта действительно меняет результат: без заявления было бы 12.02.
  const noRequest = computeDefaultJudgment({ ...DJ, default_judgment_subject: 'other_persons' });
  assert.notEqual(d.appeal.deadline, noRequest.appeal.deadline);
});

test('заочное: месячный срок с переносом последнего дня (ч. 2 ст. 108)', () => {
  // Отказ 10.04.2026 → 10.05.2026 нерабочий → перенос на 12.05.2026.
  const d = computeDefaultJudgment({ ...DJ, default_judgment_refusal_date: '2026-04-10' });
  assert.equal(d.appeal.raw_deadline, '2026-05-10');
  assert.equal(d.appeal.deadline, '2026-05-12');
  assert.equal(d.appeal.shifted, true);
});

// --- Вступление заочного решения в силу (ч. 1 ст. 244) ---------------------

test('ст. 244, ветвь 1: не обжаловано — по истечении срока по ч. 2 ст. 237', () => {
  // Иные лица, заявление об отмене не подавалось: срок апелляции считается по
  // истечении срока подачи заявления, поэтому дата известна сразу.
  const d = computeDefaultJudgment({ ...DJ, default_judgment_subject: 'other_persons' });
  const e = d.entry_into_force;
  assert.equal(e.branch, 'not_appealed');
  assert.equal(e.resolved, true);
  assert.match(e.norm, /ч\. 1 ст\. 244/);
  assert.equal(d.appeal.deadline, '2026-02-12');
  assert.equal(e.date, '2026-02-13'); // на следующий день по истечении срока
  assert.match(e.logic, /ч\. 2 ст\. 237/);
});

test('ст. 244, ветвь 1: у ответчика и иных лиц срок обжалования разный', () => {
  const others = computeDefaultJudgment({ ...DJ, default_judgment_subject: 'other_persons' });
  // Иные лица: месяц по истечении срока подачи заявления об отмене.
  assert.equal(others.appeal.deadline, '2026-02-12');
  assert.equal(others.entry_into_force.date, '2026-02-13');

  // Ответчик: срок считается от определения об отказе (абз. 1 ч. 2 ст. 237).
  // Пока её нет — считать не от чего, дату не выдумываем.
  const defendantBlocked = computeDefaultJudgment({ ...DJ, default_judgment_subject: 'defendant' });
  assert.equal(defendantBlocked.entry_into_force.branch, 'not_appealed');
  assert.equal(defendantBlocked.entry_into_force.resolved, false);
  assert.equal(defendantBlocked.entry_into_force.date, null);
  assert.deepEqual(defendantBlocked.entry_into_force.missing_inputs, [
    'default_judgment_refusal_date',
  ]);
});

test('ст. 244, ветвь 2: заявление подано, отказано, апелляции не было', () => {
  const d = computeDefaultJudgment({ ...DJ, default_judgment_refusal_date: '2026-02-10' });
  const e = d.entry_into_force;
  assert.equal(e.branch, 'refused_not_appealed');
  assert.equal(e.resolved, true);
  assert.equal(d.appeal.deadline, '2026-03-10');
  assert.equal(e.date, '2026-03-11');
  assert.match(e.logic, /отказано/);
});

test('ст. 244, ветвь 3: обжаловано в апелляции — с датой определения и без', () => {
  const withoutRuling = computeDefaultJudgment({
    ...DJ,
    default_judgment_refusal_date: '2026-02-10',
    default_judgment_appeal_filed_date: '2026-03-02',
  });
  const w = withoutRuling.entry_into_force;
  assert.equal(w.branch, 'appealed');
  assert.equal(w.resolved, false);
  assert.equal(w.date, null);
  assert.deepEqual(w.missing_inputs, ['default_judgment_appeal_ruling_date']);
  assert.match(w.logic, /если оно не отменено/);

  const withRuling = computeDefaultJudgment({
    ...DJ,
    default_judgment_refusal_date: '2026-02-10',
    default_judgment_appeal_filed_date: '2026-03-02',
    default_judgment_appeal_ruling_date: '2026-06-15',
  });
  const r = withRuling.entry_into_force;
  assert.equal(r.branch, 'appealed');
  assert.equal(r.resolved, true);
  assert.equal(r.date, '2026-06-15');
});

test('ст. 244: заявление об отмене удовлетворено — вступления в силу не наступает', () => {
  const d = computeDefaultJudgment({
    ...DJ,
    default_judgment_cancellation_request_date: '2026-01-09',
    default_judgment_cancellation_date: '2026-01-20',
  });
  const e = d.entry_into_force;
  assert.equal(e.branch, 'cancellation_granted');
  assert.equal(e.applicable, false);
  assert.equal(e.resolved, false);
  assert.equal(e.date, null);
  assert.match(e.message, /отменено/);
  // Отмена перебивает и ветвь апелляции — состояние, а не расчёт даты.
  const alsoAppealed = computeDefaultJudgment({
    ...DJ,
    default_judgment_cancellation_date: '2026-01-20',
    default_judgment_appeal_filed_date: '2026-03-02',
    default_judgment_appeal_ruling_date: '2026-06-15',
  });
  assert.equal(alsoAppealed.entry_into_force.branch, 'cancellation_granted');
  assert.equal(alsoAppealed.entry_into_force.date, null);
});

test('заочное: предъявление ИЛ — 3 года со дня вступления в силу', () => {
  // Ветвь refused_not_appealed: событие разрешено (13.03 → 12.03.2026 + 1).
  const d = computeDefaultJudgment({ ...DJ, default_judgment_refusal_date: '2026-02-10' });
  assert.equal(d.entry_into_force.date, '2026-03-11');
  assert.ok(d.enforcement);
  assert.equal(d.enforcement.id, 'default_judgment_enforcement_presentation');
  assert.equal(d.enforcement.anchor, '2026-03-11');
  assert.equal(d.enforcement.deadline, '2029-03-12'); // вс 11.03.2029 → пн 12.03
  assert.match(d.enforcement.norm.primary, /229-ФЗ/);

  // Обжаловано и определение известно: ИЛ от даты вступления в силу.
  const appealed = computeDefaultJudgment({
    ...DJ,
    default_judgment_refusal_date: '2026-02-10',
    default_judgment_appeal_filed_date: '2026-03-02',
    default_judgment_appeal_ruling_date: '2026-06-15',
  });
  assert.equal(appealed.enforcement.anchor, '2026-06-15');
});

test('заочное: ИЛ отсутствует при удовлетворённом заявлении об отмене', () => {
  // cancellation_granted — вступления в силу нет вовсе, узла ИЛ тоже.
  const d = computeDefaultJudgment({
    ...DJ,
    default_judgment_cancellation_request_date: '2026-01-09',
    default_judgment_cancellation_date: '2026-01-20',
  });
  assert.equal(d.entry_into_force.branch, 'cancellation_granted');
  assert.equal(d.enforcement, null);
});

test('заочное: кассация в КСОЮ — обе точки отсчёта', () => {
  // Не обжаловалось (refused_not_appealed): со дня вступления в силу.
  const notAppealed = computeDefaultJudgment(
    { ...DJ, default_judgment_refusal_date: '2026-02-10' },
    '2026-04-01',
  );
  assert.ok(notAppealed.cassation);
  assert.equal(notAppealed.cassation.id, 'default_judgment_cassation_ksoyu');
  assert.equal(notAppealed.cassation.anchor, notAppealed.entry_into_force.date);
  assert.match(notAppealed.cassation.norm.primary, /ст\. 376\.1/);

  // Обжаловалось: со дня изготовления мотивированного апелляционного определения,
  // с альтернативой по п. 12 ПП ВС при различии дат принятия и изготовления.
  const appealed = computeDefaultJudgment(
    {
      ...DJ,
      default_judgment_refusal_date: '2026-02-10',
      default_judgment_appeal_filed_date: '2026-03-02',
      default_judgment_appeal_ruling_date: '2026-06-15', // принятие
      default_judgment_appeal_ruling_reasoned_date: '2026-06-22', // изготовление
    },
    '2026-07-01',
  );
  assert.equal(appealed.cassation.anchor, '2026-06-22'); // изготовление
  assert.ok(appealed.cassation.alternative);
  assert.equal(appealed.cassation.alternative.anchor, '2026-06-15'); // принятие
});

// Исчерпание способов обжалования для заочного решения (3.7): у ответчика перед
// апелляцией обязательно заявление об отмене (ст. 237, позиция ВС РФ).
test('заочное, ответчик без заявления об отмене: предупреждение есть даже при апелляции', () => {
  const d = computeDefaultJudgment(
    {
      ...DJ,
      default_judgment_appeal_filed_date: '2026-01-20',
      default_judgment_appeal_ruling_date: '2026-05-10',
      default_judgment_appeal_ruling_reasoned_date: '2026-05-15',
    },
    '2026-06-01',
  );
  assert.equal(d.entry_into_force.branch, 'appealed');
  assert.ok(d.cassation.exhaustion_warning, 'без заявления об отмене — предупреждение');
  // Специальный текст про заявление об отмене, а не общий про апелляцию.
  assert.match(d.cassation.exhaustion_warning.text, /заявление об отмене/);
  assert.match(d.cassation.exhaustion_warning.text, /ст\. 237/);
});

// Регрессия: пустые (не undefined, а '') поля заявления об отмене — как их может
// передать внешний слой — раньше через toISO давали «NaN-NaN-NaN», и проверка
// «есть определение об отказе» ложно срабатывала, гася предупреждение.
test('заочное, ответчик: пустые строки заявления/отказа не гасят предупреждение', () => {
  const d = computeDefaultJudgment(
    {
      ...DJ,
      default_judgment_subject: 'defendant',
      default_judgment_cancellation_request_date: '',
      default_judgment_refusal_date: '',
      default_judgment_appeal_filed_date: '2026-01-20',
      default_judgment_appeal_ruling_date: '2026-05-10',
      default_judgment_appeal_ruling_reasoned_date: '2026-05-15',
    },
    '2026-06-01',
  );
  assert.ok(d.cassation.exhaustion_warning, 'пустые строки = заявления нет → предупреждение');
  assert.match(d.cassation.exhaustion_warning.text, /заявление об отмене/);
});

test('заочное, ответчик с заявлением и отказом: предупреждение снимается по факту апелляции', () => {
  const base = { ...DJ, default_judgment_refusal_date: '2026-02-10' };
  // Заявление рассмотрено (отказ), но апелляции нет — общее предупреждение.
  const notAppealed = computeDefaultJudgment(base, '2026-04-01');
  assert.ok(notAppealed.cassation.exhaustion_warning);
  // Апелляция подана — способы исчерпаны, предупреждения нет.
  const appealed = computeDefaultJudgment(
    {
      ...base,
      default_judgment_appeal_filed_date: '2026-03-02',
      default_judgment_appeal_ruling_date: '2026-06-15',
      default_judgment_appeal_ruling_reasoned_date: '2026-06-20',
    },
    '2026-07-01',
  );
  assert.equal(appealed.cassation.exhaustion_warning, undefined);
});

test('заочное, иные лица: условие как в общем порядке, заявление об отмене не проверяется', () => {
  const others = { ...DJ, default_judgment_subject: 'other_persons' };
  // Не обжаловалось — общее предупреждение (без заявления об отмене).
  const notAppealed = computeDefaultJudgment(others, '2026-04-01');
  assert.ok(notAppealed.cassation.exhaustion_warning);
  assert.doesNotMatch(notAppealed.cassation.exhaustion_warning.text, /заявление об отмене/);
  // Обжаловалось — предупреждения нет, независимо от заявления об отмене.
  const appealed = computeDefaultJudgment(
    {
      ...others,
      default_judgment_appeal_filed_date: '2026-01-20',
      default_judgment_appeal_ruling_date: '2026-05-10',
      default_judgment_appeal_ruling_reasoned_date: '2026-05-15',
    },
    '2026-06-01',
  );
  assert.equal(appealed.cassation.exhaustion_warning, undefined);
});

test('заочное: кассации нет при удовлетворённом заявлении об отмене', () => {
  const d = computeDefaultJudgment(
    {
      ...DJ,
      default_judgment_cancellation_request_date: '2026-01-09',
      default_judgment_cancellation_date: '2026-01-20',
    },
    '2026-04-01',
  );
  assert.equal(d.entry_into_force.branch, 'cancellation_granted');
  assert.equal(d.cassation, null);
});

// --- Заочное решение против иностранного государства (ч. 1–4 ст. 417.10) ---
// Полный клон ветки default_judgment: та же механика главы 22, другие числа
// (2/1/2 месяца вместо 7 рабочих дней/1 месяца), без деления по субъекту.

const FDJ = { foreign_state_default_judgment_service_date: '2025-12-22' };

test('заочное (иностранное государство): узла нет без даты вручения копии', () => {
  assert.equal(computeDefaultJudgmentForeignState({}), null);
  assert.equal(computeChain(BASE, { today: '2026-03-01' }).default_judgment_foreign_state, null);
});

test('заочное (иностранное государство): 2 месяца на заявление об отмене (ч. 3 ст. 417.10)', () => {
  const d = computeDefaultJudgmentForeignState(FDJ);
  assert.equal(d.cancellation_request.anchor, '2025-12-22');
  assert.deepEqual(d.cancellation_request.duration, { value: 2, unit: 'month' });
  assert.equal(d.cancellation_request.deadline, '2026-02-24'); // вс 22.02 → пн 23.02... фактически 24.02
  assert.match(d.cancellation_request.norm.primary, /ч\. 3 ст\. 417\.10/);
  assert.doesNotMatch(d.cancellation_request.norm.primary, /ст\. 237/);
});

test('заочное (иностранное государство), режим no_request: месяц по истечении срока подачи', () => {
  const d = computeDefaultJudgmentForeignState(FDJ);
  assert.equal(d.appeal.anchor_kind, 'request_deadline');
  assert.equal(d.appeal.anchor, d.cancellation_request.deadline);
  assert.deepEqual(d.appeal.duration, { value: 1, unit: 'month' });
  assert.equal(d.appeal.deadline, '2026-03-24');
  assert.match(d.appeal.norm.primary, /ч\. 4 ст\. 417\.10/);
});

// Регрессия: у обычного заочного решения оба субъекта делят один и тот же
// месячный срок (DEFAULT_JUDGMENT_APPEAL_MODES), поэтому computeSimpleTerm с
// overrides там корректен. Здесь длительность различается по существу — не
// только норма/якорь, а сам расчёт (computeForeignStateAppealTerm), и это
// самое важное здесь: ровно 2 месяца, а не 1.
test('заочное (иностранное государство), режим after_request: РОВНО 2 месяца, а не 1', () => {
  const d = computeDefaultJudgmentForeignState({
    ...FDJ,
    foreign_state_default_judgment_cancellation_request_date: '2025-12-30',
    foreign_state_default_judgment_refusal_date: '2026-02-10',
  });
  assert.equal(d.appeal.anchor_kind, 'refusal');
  assert.equal(d.appeal.anchor, '2026-02-10');
  assert.deepEqual(d.appeal.duration, { value: 2, unit: 'month' });
  assert.equal(d.appeal.deadline, '2026-04-10'); // 10.02 + 2 месяца, не 10.03 (+1 месяц)
  assert.match(d.appeal.norm.primary, /ч\. 4 ст\. 417\.10/);
  assert.match(d.appeal.logic, /два месяца/i);
  assert.match(d.appeal.logic, /не один месяц общего порядка/);

  // Убеждаемся, что это не совпадение и не эффект переноса выходного: без
  // заявления срок был бы другим (от dj.cancellation_request.deadline, месяц).
  const noRequest = computeDefaultJudgmentForeignState(FDJ);
  assert.notEqual(d.appeal.deadline, noRequest.appeal.deadline);
});

test('заочное (иностранное государство): appeal_not_applicable при удовлетворённом заявлении', () => {
  const d = computeDefaultJudgmentForeignState({
    ...FDJ,
    foreign_state_default_judgment_cancellation_request_date: '2026-01-09',
    foreign_state_default_judgment_cancellation_date: '2026-01-20',
  });
  assert.equal(d.appeal, null);
  assert.match(d.appeal_not_applicable.norm, /ч\. 4 ст\. 417\.10/);
  assert.match(d.appeal_not_applicable.reason, /ч\. 1 ст\. 241/);
});

test('заочное (иностранное государство), ст. 244: все четыре ветви цитируют ч. 4 ст. 417.10, не ст. 237', () => {
  // Ветвь 1: не обжаловано.
  const notAppealed = computeDefaultJudgmentForeignState(FDJ);
  const e1 = notAppealed.entry_into_force;
  assert.equal(e1.branch, 'not_appealed');
  assert.equal(e1.resolved, true);
  assert.match(e1.logic, /ч\. 4 ст\. 417\.10/);
  assert.doesNotMatch(e1.logic, /ст\. 237/);

  // Ветвь 2: заявление подано, отказано, апелляции не было.
  const refused = computeDefaultJudgmentForeignState({
    ...FDJ,
    foreign_state_default_judgment_cancellation_request_date: '2025-12-30',
    foreign_state_default_judgment_refusal_date: '2026-02-10',
  });
  const e2 = refused.entry_into_force;
  assert.equal(e2.branch, 'refused_not_appealed');
  assert.equal(e2.resolved, true);
  assert.equal(e2.date, '2026-04-11'); // дедлайн апелляции 10.04 + 1
  assert.match(e2.logic, /ч\. 4 ст\. 417\.10/);
  assert.doesNotMatch(e2.logic, /ст\. 237/);

  // Ветвь 3: обжаловано — с датой определения и без.
  const appealedNoRuling = computeDefaultJudgmentForeignState({
    ...FDJ,
    foreign_state_default_judgment_refusal_date: '2026-02-10',
    foreign_state_default_judgment_appeal_filed_date: '2026-03-02',
  });
  const e3 = appealedNoRuling.entry_into_force;
  assert.equal(e3.branch, 'appealed');
  assert.equal(e3.resolved, false);
  assert.deepEqual(e3.missing_inputs, ['foreign_state_default_judgment_appeal_ruling_date']);

  const appealedWithRuling = computeDefaultJudgmentForeignState({
    ...FDJ,
    foreign_state_default_judgment_refusal_date: '2026-02-10',
    foreign_state_default_judgment_appeal_filed_date: '2026-03-02',
    foreign_state_default_judgment_appeal_ruling_date: '2026-06-15',
  });
  const e3r = appealedWithRuling.entry_into_force;
  assert.equal(e3r.resolved, true);
  assert.equal(e3r.date, '2026-06-15');

  // Ветвь 4 (cancellation_granted): удовлетворено — вступления в силу нет.
  const cancelled = computeDefaultJudgmentForeignState({
    ...FDJ,
    foreign_state_default_judgment_cancellation_request_date: '2026-01-09',
    foreign_state_default_judgment_cancellation_date: '2026-01-20',
  });
  const e4 = cancelled.entry_into_force;
  assert.equal(e4.branch, 'cancellation_granted');
  assert.equal(e4.resolved, false);
  assert.equal(e4.date, null);
  assert.match(e4.logic, /ч\. 1 ст\. 241/);
});

// Регрессия: в отличие от default_judgment (где у ответчика предупреждение
// зависит ещё и от рассмотренного заявления об отмене, 3.7), здесь право
// «сторонами» единое (ч. 4 ст. 417.10) — исчерпание считается ОБЩИМ правилом
// (generalExhaustion): предупреждение есть при !appealed независимо от того,
// подавалось ли заявление об отмене, и снимается при appealed независимо от
// того, было ли оно подано и рассмотрено.
test('заочное (иностранное государство): исчерпание — общее правило, не как у default_judgment', () => {
  // Не обжаловано, заявление об отмене вовсе не подавалось — предупреждение есть.
  const notAppealedNoRequest = computeDefaultJudgmentForeignState(FDJ, '2026-05-01');
  assert.ok(notAppealedNoRequest.cassation.exhaustion_warning);
  // И общий текст про апелляцию, а не про заявление об отмене (ст. 237) —
  // как это было бы у ответчика default_judgment.
  assert.doesNotMatch(notAppealedNoRequest.cassation.exhaustion_warning.text, /заявление об отмене/);

  // Обжаловано — предупреждения нет, ДАЖЕ БЕЗ поданного заявления об отмене.
  // У default_judgment для subject: 'defendant' в этой ситуации предупреждение
  // осталось бы (нужно ещё рассмотренное заявление, см. defaultJudgmentExhaustion).
  const appealedNoRequest = computeDefaultJudgmentForeignState(
    {
      ...FDJ,
      foreign_state_default_judgment_appeal_filed_date: '2026-01-20',
      foreign_state_default_judgment_appeal_ruling_date: '2026-05-10',
      foreign_state_default_judgment_appeal_ruling_reasoned_date: '2026-05-15',
    },
    '2026-06-01',
  );
  assert.equal(appealedNoRequest.entry_into_force.branch, 'appealed');
  assert.equal(appealedNoRequest.cassation.exhaustion_warning, undefined);
});

test('заочное (иностранное государство): кассация — базовый расчёт после вступления в силу', () => {
  const d = computeDefaultJudgmentForeignState(
    { ...FDJ, foreign_state_default_judgment_refusal_date: '2026-02-10' },
    '2026-05-01',
  );
  assert.ok(d.cassation);
  assert.equal(d.cassation.id, 'foreign_state_default_judgment_cassation_ksoyu');
  assert.equal(d.cassation.anchor, d.entry_into_force.date);
  assert.match(d.cassation.norm.primary, /ст\. 376\.1/);
});

test('заочное (иностранное государство): кассации нет при удовлетворённом заявлении об отмене', () => {
  const d = computeDefaultJudgmentForeignState(
    {
      ...FDJ,
      foreign_state_default_judgment_cancellation_request_date: '2026-01-09',
      foreign_state_default_judgment_cancellation_date: '2026-01-20',
    },
    '2026-04-01',
  );
  assert.equal(d.entry_into_force.branch, 'cancellation_granted');
  assert.equal(d.cassation, null);
});

test('заочное (иностранное государство): предъявление ИЛ — 3 года со дня вступления в силу', () => {
  const d = computeDefaultJudgmentForeignState({
    ...FDJ,
    foreign_state_default_judgment_refusal_date: '2026-02-10',
  });
  assert.ok(d.enforcement);
  assert.equal(d.enforcement.id, 'foreign_state_default_judgment_enforcement_presentation');
  assert.equal(d.enforcement.anchor, d.entry_into_force.date);
  assert.match(d.enforcement.norm.primary, /229-ФЗ/);
});

test('заочное (иностранное государство): ИЛ отсутствует при удовлетворённом заявлении об отмене', () => {
  const d = computeDefaultJudgmentForeignState({
    ...FDJ,
    foreign_state_default_judgment_cancellation_request_date: '2026-01-09',
    foreign_state_default_judgment_cancellation_date: '2026-01-20',
  });
  assert.equal(d.entry_into_force.branch, 'cancellation_granted');
  assert.equal(d.enforcement, null);
});

// --- Мировой судья без мотивированного решения (ч. 3–5 ст. 199) -------------

const MIR = { mirovoy_resolution_date: '2025-12-22' };

test('мировой: узла нет без даты объявления резолютивной части', () => {
  assert.equal(computeMirovoy({}), null);
  assert.equal(computeChain(BASE, { today: '2026-03-01' }).mirovoy, null);
});

test('мировой, участник присутствовал: 3 рабочих дня (п. 1 ч. 4 ст. 199)', () => {
  const m = computeMirovoy(MIR);
  assert.equal(m.attendance, 'present'); // значение по умолчанию
  assert.equal(m.reasoned_request.deadline, '2025-12-25');
  assert.match(m.reasoned_request.norm.primary, /п\. 1 ч\. 4 ст\. 199/);
  assert.match(m.reasoned_request.logic, /вправе не составлять/); // ч. 3 ст. 199
});

test('мировой, участник не присутствовал: 15 рабочих дней (п. 2 ч. 4 ст. 199)', () => {
  const m = computeMirovoy({ ...MIR, mirovoy_attendance: 'absent' });
  assert.equal(m.attendance, 'absent');
  assert.equal(m.reasoned_request.deadline, '2026-01-22');
  assert.match(m.reasoned_request.norm.primary, /п\. 2 ч\. 4 ст\. 199/);
  // Ветвь явки действительно меняет срок.
  assert.notEqual(m.reasoned_request.deadline, computeMirovoy(MIR).reasoned_request.deadline);
});

test('мировой: трёхдневный срок через январские каникулы растягивается впятеро', () => {
  // Резолютивная часть 30.12.2025: первый рабочий день течения — 12.01.2026,
  // три рабочих дня → 14.01.2026, то есть 15 календарных дней на «три дня».
  const m = computeMirovoy({ mirovoy_resolution_date: '2025-12-30' });
  assert.equal(m.reasoned_request.first_working_day, '2026-01-12');
  assert.equal(m.reasoned_request.deadline, '2026-01-14');
  const span = Math.round(
    (Date.parse('2026-01-14') - Date.parse('2025-12-30')) / 86_400_000,
  );
  assert.equal(span, 15);
  assert.ok(span > 3 * 4, 'календарный размах многократно превышает три дня');
});

test('мировой: 10 рабочих дней на составление решения (ч. 5 ст. 199)', () => {
  assert.equal(computeMirovoy(MIR).reasoned_making, null); // без заявления не считается
  const m = computeMirovoy({ ...MIR, mirovoy_request_date: '2025-12-25' });
  assert.equal(m.reasoned_making.anchor, '2025-12-25');
  assert.equal(m.reasoned_making.deadline, '2026-01-20');
  assert.match(m.reasoned_making.norm.primary, /ч\. 5 ст\. 199/);
});

test('мировой: апелляция без мотивированного решения — от резолютивной части', () => {
  const m = computeMirovoy(MIR);
  assert.equal(m.appeal.anchor, '2025-12-22');
  assert.equal(m.appeal.anchor_kind, 'resolution');
  assert.equal(m.appeal.deadline, '2026-01-22');
  assert.match(m.appeal.logic, /вправе не составлять/);
});

test('мировой: апелляция с мотивированным решением — от дня его составления', () => {
  const m = computeMirovoy({ ...MIR, mirovoy_reasoned_date: '2026-01-15' });
  assert.equal(m.appeal.anchor, '2026-01-15');
  assert.equal(m.appeal.anchor_kind, 'reasoned');
  assert.equal(m.appeal.deadline, '2026-02-16'); // 15.02.2026 — воскресенье
  assert.notEqual(m.appeal.deadline, computeMirovoy(MIR).appeal.deadline);
});

test('мировой: месячный срок апелляции с переносом последнего дня (ч. 2 ст. 108)', () => {
  // Мотивированное решение 15.01.2026 → 15.02.2026 (вс) → перенос на 16.02.2026.
  const m = computeMirovoy({ ...MIR, mirovoy_reasoned_date: '2026-01-15' });
  assert.equal(m.appeal.raw_deadline, '2026-02-15');
  assert.equal(m.appeal.deadline, '2026-02-16');
  assert.equal(m.appeal.shifted, true);
});

// --- Надзор в Президиум ВС РФ (глава 41.1 ГПК) ------------------------------

test('надзор: 3 месяца от даты вынесения определения коллегии ВС (ч. 2 ст. 391.2)', () => {
  const t = computeIndependentTerms({ vs_ruling_date: '2025-09-01' }).supervision;
  assert.equal(t.anchor, '2025-09-01');
  assert.equal(t.deadline, '2025-12-01');
  assert.match(t.norm.primary, /ч\. 2 ст\. 391\.2/);
  assert.match(t.norm.clarification, /390\.17/);
});

test('надзор считается от вынесения, а не от возможной даты мотивировки', () => {
  // Определение коллегии ВС вступает в силу со дня вынесения (ст. 390.17),
  // поэтому дата изготовления мотивированного определения на срок не влияет —
  // в отличие от кассации в ВС по ч. 1 ст. 390.3.
  const base = { vs_ruling_date: '2025-09-01' };
  const withReasoned = {
    ...base,
    // поля мотивировки соседних узлов не должны сдвигать надзорный срок
    ksoyu_ruling_reasoned_date: '2025-09-20',
    appeal_ruling_reasoned_date: '2025-09-20',
  };
  assert.equal(
    computeIndependentTerms(withReasoned).supervision.deadline,
    computeIndependentTerms(base).supervision.deadline,
  );
  assert.equal(computeIndependentTerms(withReasoned).supervision.anchor, '2025-09-01');
  assert.match(computeIndependentTerms(base).supervision.logic, /390\.17/);
  assert.match(computeIndependentTerms(base).supervision.logic, /390\.3/); // пояснение разницы
});

test('надзор: узла нет без даты определения коллегии ВС (п. 6 ч. 2 ст. 391.1)', () => {
  assert.equal(computeIndependentTerms({}).supervision, null);
  // Дата определения КСОЮ узел надзора не открывает — это другая инстанция.
  assert.equal(computeIndependentTerms({ ksoyu_ruling_date: '2025-09-01' }).supervision, null);
  assert.equal(computeChain(BASE, { today: '2026-03-01' }).supervision, null);
});

test('надзор: перенос последнего дня (ч. 2 ст. 108)', () => {
  // 11.01.2026 + 3 месяца = 11.04.2026 (суббота) → 13.04.2026 (понедельник).
  const t = computeIndependentTerms({ vs_ruling_date: '2026-01-11' }).supervision;
  assert.equal(t.raw_deadline, '2026-04-11');
  assert.equal(t.deadline, '2026-04-13');
  assert.equal(t.shifted, true);
});

// --- Возврат кассационной жалобы: обжалование определения (ч. 1 ст. 379.2) --

test('возврат кассационной жалобы: 1 месяц со дня вынесения определения (ч. 1 ст. 379.2)', () => {
  const t = computeIndependentTerms({ cassation_return_ruling_date: '2025-09-01' })
    .cassation_return_ruling_appeal;
  assert.equal(t.anchor, '2025-09-01');
  assert.equal(t.offset_start, 1);
  assert.equal(t.deadline, '2025-10-01');
  assert.deepEqual(t.duration, { value: 1, unit: 'month' });
  assert.match(t.norm.primary, /ч\. 1 ст\. 379\.2/);
});

test('возврат кассационной жалобы: перенос последнего дня (ч. 2 ст. 108)', () => {
  // 14.02.2026 + 1 месяц = 14.03.2026 (суббота) → 16.03.2026 (понедельник).
  const t = computeIndependentTerms({ cassation_return_ruling_date: '2026-02-14' })
    .cassation_return_ruling_appeal;
  assert.equal(t.raw_deadline, '2026-03-14');
  assert.equal(t.deadline, '2026-03-16');
  assert.equal(t.shifted, true);

  // Новогодние каникулы: 11.12.2025 + 1 месяц = 11.01.2026 (вс) → 12.01.2026.
  const holiday = computeIndependentTerms({ cassation_return_ruling_date: '2025-12-11' })
    .cassation_return_ruling_appeal;
  assert.equal(holiday.raw_deadline, '2026-01-11');
  assert.equal(holiday.deadline, '2026-01-12');
});

test('возврат кассационной жалобы: узла нет без даты определения', () => {
  assert.equal(computeIndependentTerms({}).cassation_return_ruling_appeal, null);
  // Дата определения КСОЮ по существу кассации этот узел не открывает: возврат
  // жалобы — отдельное определение, и вводится оно своим полем.
  assert.equal(
    computeIndependentTerms({ ksoyu_ruling_date: '2025-09-01' }).cassation_return_ruling_appeal,
    null,
  );
});

test('возврат кассационной жалобы: узел независим от категории дела и ветви цепочки', () => {
  // Возвратить жалобу кассационный суд может по делу любой категории, поэтому
  // расчёт не должен зависеть ни от данных цепочки, ни от их отсутствия.
  const alone = computeIndependentTerms({ cassation_return_ruling_date: '2025-09-01' })
    .cassation_return_ruling_appeal;
  assert.ok(alone, 'узел считается по одной своей дате');

  const withBranches = computeIndependentTerms({
    cassation_return_ruling_date: '2025-09-01',
    reasoned_decision_date: '2025-03-11',
    mirovoy_resolution_date: '2025-07-06',
    default_judgment_service_date: '2025-07-05',
    simplified_resolution_date: '2025-07-03',
    ksoyu_ruling_reasoned_date: '2025-08-05',
  }).cassation_return_ruling_appeal;
  assert.equal(withBranches.deadline, alone.deadline);
  assert.equal(withBranches.anchor, alone.anchor);

  // И через computeChain — тот же узел, той же датой.
  const chain = computeChain(
    { ...BASE, cassation_return_ruling_date: '2025-09-01' },
    { today: '2025-09-10' },
  );
  assert.equal(chain.cassation_return_ruling_appeal.deadline, alone.deadline);
  assert.equal(computeChain(BASE, { today: '2025-09-10' }).cassation_return_ruling_appeal, null);
});

test('возврат кассационной жалобы: одна редакция, переиздание 79-ФЗ ветвления не даёт', () => {
  // Статья переиздана Федеральным законом от 09.04.2026 № 79-ФЗ, но по существу
  // не изменилась — темпорального ветвления по дате быть не должно.
  assert.equal(CASSATION_RETURN_RULING_APPEAL.norm_versions.length, 1);
  const [version] = CASSATION_RETURN_RULING_APPEAL.norm_versions;
  assert.equal(version.from, null);
  assert.equal(version.to, null);

  const before = computeIndependentTerms({ cassation_return_ruling_date: '2026-03-13' })
    .cassation_return_ruling_appeal;
  const after = computeIndependentTerms({ cassation_return_ruling_date: '2026-03-13' })
    .cassation_return_ruling_appeal;
  assert.equal(before.deadline, after.deadline);
  assert.equal(before.norm.primary, after.norm.primary);
});

test('возврат кассационной жалобы: контекст в logic — 10 дней суда и день первоначального обращения', () => {
  const t = computeIndependentTerms({ cassation_return_ruling_date: '2025-09-01' })
    .cassation_return_ruling_appeal;
  // Десятидневный срок рассмотрения самим судом (ч. 2, первое предложение) —
  // срок суда: только упоминание в тексте, отдельного расчёта нет.
  assert.match(t.logic, /[Дд]есятидневный/);
  assert.match(t.logic, /срок суда/);
  // Правило ч. 2 (второе предложение): при отмене определения жалоба считается
  // поданной в день первоначального обращения.
  assert.match(t.logic, /день первоначального обращения/);
  assert.match(t.norm.clarification, /первоначального обращения/);
  // Отдельным узлом десятидневный срок не заводится.
  assert.equal(
    computeIndependentTerms({ cassation_return_ruling_date: '2025-09-01' })
      .cassation_return_ruling_review,
    undefined,
  );
});

// --- Отмена постановления третейского суда о компетенции (ч. 2 ст. 422.1) --

test('третейский суд: 1 месяц со дня получения постановления (ч. 2 ст. 422.1)', () => {
  const t = computeIndependentTerms({
    arbitration_competence_ruling_received_date: '2025-09-01',
  }).arbitration_competence_appeal;
  assert.equal(t.anchor, '2025-09-01');
  assert.equal(t.offset_start, 1);
  assert.equal(t.deadline, '2025-10-01');
  assert.deepEqual(t.duration, { value: 1, unit: 'month' });
  assert.match(t.norm.primary, /ч\. 2 ст\. 422\.1/);
});

test('третейский суд: перенос последнего дня (ч. 2 ст. 108)', () => {
  // 14.02.2026 + 1 месяц = 14.03.2026 (суббота) → 16.03.2026 (понедельник).
  const t = computeIndependentTerms({
    arbitration_competence_ruling_received_date: '2026-02-14',
  }).arbitration_competence_appeal;
  assert.equal(t.raw_deadline, '2026-03-14');
  assert.equal(t.deadline, '2026-03-16');
  assert.equal(t.shifted, true);
});

test('третейский суд: узла нет без даты получения постановления', () => {
  assert.equal(computeIndependentTerms({}).arbitration_competence_appeal, null);
  assert.equal(computeChain(BASE, { today: '2025-09-10' }).arbitration_competence_appeal, null);
});

test('третейский суд: узел независим от категории дела и ветви цепочки', () => {
  const alone = computeIndependentTerms({
    arbitration_competence_ruling_received_date: '2025-09-01',
  }).arbitration_competence_appeal;
  assert.ok(alone, 'узел считается по одной своей дате');

  const chain = computeChain(
    { ...BASE, arbitration_competence_ruling_received_date: '2025-09-01' },
    { today: '2025-09-10' },
  );
  assert.equal(chain.arbitration_competence_appeal.deadline, alone.deadline);
});

test('третейский суд: точка отсчёта — получение постановления, а не его вынесение', () => {
  assert.equal(
    ARBITRATION_COMPETENCE_APPEAL.anchor.event,
    'arbitration_competence_ruling_received_date',
  );
  const t = computeIndependentTerms({
    arbitration_competence_ruling_received_date: '2025-09-01',
  }).arbitration_competence_appeal;
  assert.match(t.logic, /получения/);
  assert.match(t.logic, /не от дня[\s\S]*вынесения/);
});

// --- Мировое соглашение в исполнении: кассация (ч. 11 ст. 153.10) ----------

test('мировое соглашение в исполнении: 1 месяц со дня вынесения определения (ч. 11 ст. 153.10)', () => {
  const t = computeIndependentTerms({
    settlement_approval_ruling_date: '2025-09-01',
  }).settlement_approval_cassation_appeal;
  assert.equal(t.anchor, '2025-09-01');
  assert.equal(t.offset_start, 1);
  assert.equal(t.deadline, '2025-10-01');
  assert.deepEqual(t.duration, { value: 1, unit: 'month' });
  assert.match(t.norm.primary, /ч\. 11 ст\. 153\.10/);
});

test('мировое соглашение в исполнении: перенос последнего дня (ч. 2 ст. 108)', () => {
  // 14.02.2026 + 1 месяц = 14.03.2026 (суббота) → 16.03.2026 (понедельник).
  const t = computeIndependentTerms({
    settlement_approval_ruling_date: '2026-02-14',
  }).settlement_approval_cassation_appeal;
  assert.equal(t.raw_deadline, '2026-03-14');
  assert.equal(t.deadline, '2026-03-16');
  assert.equal(t.shifted, true);
});

test('мировое соглашение в исполнении: узла нет без даты определения', () => {
  assert.equal(computeIndependentTerms({}).settlement_approval_cassation_appeal, null);
  assert.equal(
    computeChain(BASE, { today: '2025-09-10' }).settlement_approval_cassation_appeal,
    null,
  );
});

test('мировое соглашение в исполнении: узел независим от категории дела и ветви цепочки', () => {
  const alone = computeIndependentTerms({
    settlement_approval_ruling_date: '2025-09-01',
  }).settlement_approval_cassation_appeal;
  assert.ok(alone, 'узел считается по одной своей дате');

  const chain = computeChain(
    { ...BASE, settlement_approval_ruling_date: '2025-09-01' },
    { today: '2025-09-10' },
  );
  assert.equal(chain.settlement_approval_cassation_appeal.deadline, alone.deadline);
});

test('мировое соглашение в исполнении: обжалуется сразу в кассацию, минуя апелляцию', () => {
  const t = computeIndependentTerms({
    settlement_approval_ruling_date: '2025-09-01',
  }).settlement_approval_cassation_appeal;
  assert.match(t.logic, /минуя апелляцию/);
  // Часть 4 ст. 153.10 (месячный срок суда на рассмотрение вопроса об
  // утверждении) сознательно не реализована — это срок суда, а не участника.
  assert.equal(SETTLEMENT_APPROVAL_CASSATION_APPEAL.norm_versions.length, 1);
});

// --- Предъявление судебного приказа к исполнению (ч. 3 ст. 21 229-ФЗ) ------

test('судебный приказ: 3 года со дня выдачи, перенос через выходные', () => {
  const t = computeIndependentTerms({ court_order_issued_date: '2023-04-12' })
    .court_order_presentation;
  assert.equal(t.anchor, '2023-04-12');
  assert.equal(t.raw_deadline, '2026-04-12'); // воскресенье
  assert.equal(t.deadline, '2026-04-13'); // перенос на понедельник (ч. 2 ст. 108)
  assert.equal(t.shifted, true);
  assert.match(t.norm.primary, /ч\. 3 ст\. 21/);
});

test('судебный приказ: узла нет без даты выдачи', () => {
  assert.equal(computeIndependentTerms({}).court_order_presentation, null);
  assert.equal(computeChain(BASE, { today: '2026-03-01' }).court_order_presentation, null);
});

test('судебный приказ: узел не зависит от полей общей цепочки', () => {
  // Приказное производство (глава 11 ГПК) — самостоятельный трек: наличие
  // court_order_issued_date рядом с датой мотивированного решения не должно
  // ничего менять ни в одном узле, кроме собственного расчёта.
  const chain = computeChain(
    { ...BASE, court_order_issued_date: '2023-04-12' },
    { today: '2026-03-01' },
  );
  assert.ok(chain.court_order_presentation);
  assert.equal(chain.court_order_presentation.deadline, '2026-04-13');
});

// --- Возражения должника на судебный приказ (ст. 128 ГПК) -------------------

test('возражения должника: 10 рабочих дней со дня получения копии приказа (ст. 128)', () => {
  const t = computeIndependentTerms({ court_order_copy_received_date: '2026-03-02' })
    .court_order_objection;
  assert.equal(t.anchor, '2026-03-02');
  assert.equal(t.first_working_day, '2026-03-03'); // течение со следующего дня
  assert.equal(t.deadline, '2026-03-17');
  assert.equal(t.shifted, false); // ч. 2 ст. 108 к срокам в рабочих днях не применяется
  assert.match(t.norm.primary, /ст\. 128/);
  assert.deepEqual(t.norm.calculation, ['ч. 3 (абз. 2) ст. 107 ГПК РФ']);
  assert.deepEqual(t.duration, { value: 10, unit: 'working_day' });
});

test('возражения должника: рабочие дни, а не календарные — перенос через каникулы', () => {
  // Копия получена 26.12.2025 (пятница). Течение — с 29.12 (понедельник);
  // 31.12.2025 и 01–09.01.2026 нерабочие, поэтому десятый рабочий день —
  // 21.01.2026, а не 05.01.2026, как было бы при календарном счёте.
  const t = computeIndependentTerms({ court_order_copy_received_date: '2025-12-26' })
    .court_order_objection;
  assert.equal(t.first_working_day, '2025-12-29');
  assert.equal(t.deadline, '2026-01-21');
});

test('возражения должника: течение начинается с первого рабочего дня', () => {
  // Копия получена 20.02.2026 (пятница): 21–22 выходные, 23 февраля праздник —
  // отсчёт идёт с 24.02, а не со следующего календарного дня.
  const t = computeIndependentTerms({ court_order_copy_received_date: '2026-02-20' })
    .court_order_objection;
  assert.equal(t.first_working_day, '2026-02-24');
  assert.equal(t.deadline, '2026-03-10');
});

test('возражения должника: узла нет без даты получения копии', () => {
  assert.equal(computeIndependentTerms({}).court_order_objection, null);
  assert.equal(computeChain(BASE, { today: '2026-03-01' }).court_order_objection, null);
  // Дата выдачи приказа взыскателю этот узел не открывает — это другой момент
  // процедуры и другой input.
  assert.equal(
    computeIndependentTerms({ court_order_issued_date: '2023-04-12' }).court_order_objection,
    null,
  );
});

test('возражения должника и предъявление приказа считаются независимо', () => {
  // Оба поля ситуации «Судебный приказ» друг от друга не зависят: можно
  // заполнить только одно, только другое, оба или ни одного.
  const onlyObjection = computeIndependentTerms({ court_order_copy_received_date: '2026-03-02' });
  assert.ok(onlyObjection.court_order_objection);
  assert.equal(onlyObjection.court_order_presentation, null);

  const onlyPresentation = computeIndependentTerms({ court_order_issued_date: '2023-04-12' });
  assert.equal(onlyPresentation.court_order_objection, null);
  assert.ok(onlyPresentation.court_order_presentation);

  const both = computeIndependentTerms({
    court_order_copy_received_date: '2026-03-02',
    court_order_issued_date: '2023-04-12',
  });
  // Каждый узел считается от своей даты — соседнее поле его не сдвигает.
  assert.equal(both.court_order_objection.deadline, onlyObjection.court_order_objection.deadline);
  assert.equal(
    both.court_order_presentation.deadline,
    onlyPresentation.court_order_presentation.deadline,
  );

  const neither = computeIndependentTerms({});
  assert.equal(neither.court_order_objection, null);
  assert.equal(neither.court_order_presentation, null);
});

test('возражения должника: перерывы ст. 22 ФЗ № 229-ФЗ к сроку не применяются', () => {
  // Перерыв — механика срока предъявления исполнительного документа; срок на
  // возражения по ст. 128 к исполнительному производству отношения не имеет.
  const t = computeIndependentTerms({
    court_order_copy_received_date: '2026-03-02',
    enforcement_interruptions: [{ type: 'presentment', date: '2026-03-05' }],
  }).court_order_objection;
  assert.equal(t.deadline, '2026-03-17');
  assert.equal(t.interruptible, undefined);
  assert.equal(t.interruptions, undefined);
});

test('возражения должника: логика упоминает пятидневный срок суда как контекст', () => {
  const t = computeIndependentTerms({ court_order_copy_received_date: '2026-03-02' })
    .court_order_objection;
  assert.match(t.logic, /Пятидневный срок/);
  assert.match(t.logic, /получение копии/);
  assert.match(t.midnight_rule, /ч\. 3 ст\. 108/);
});

// --- Возвращение ребёнка / права доступа (глава 22.2 ГПК) -------------------

test('глава 22.2: апелляция — 10 рабочих дней со дня решения в окончательной форме', () => {
  const t = computeIndependentTerms({ child_return_reasoned_decision_date: '2026-03-02' })
    .child_return_appeal;
  assert.equal(t.anchor, '2026-03-02');
  assert.equal(t.first_working_day, '2026-03-03'); // течение со следующего дня
  assert.equal(t.deadline, '2026-03-17');
  assert.equal(t.shifted, false); // ч. 2 ст. 108 к срокам в рабочих днях не применяется
  assert.match(t.norm.primary, /ч\. 1 ст\. 244\.17/);
  assert.deepEqual(t.norm.calculation, ['ч. 3 (абз. 2) ст. 107 ГПК РФ']);
  assert.deepEqual(t.duration, { value: 10, unit: 'working_day' });
});

test('глава 22.2: частная жалоба — 10 рабочих дней со дня вынесения определения', () => {
  const t = computeIndependentTerms({ child_return_interim_ruling_date: '2026-03-02' })
    .child_return_private_complaint;
  assert.equal(t.anchor, '2026-03-02');
  assert.equal(t.first_working_day, '2026-03-03');
  assert.equal(t.deadline, '2026-03-17');
  assert.equal(t.shifted, false);
  assert.match(t.norm.primary, /ч\. 1 ст\. 244\.18/);
  assert.deepEqual(t.norm.calculation, ['ч. 3 (абз. 2) ст. 107 ГПК РФ']);
  assert.deepEqual(t.duration, { value: 10, unit: 'working_day' });
});

test('глава 22.2: сроки короче общего порядка — не месяц и не 15 дней', () => {
  // Смысл всей категории: общий узел дал бы для этих дел неверный результат.
  const { appeal } = computeChain({ reasoned_decision_date: '2026-03-02' }, { today: '2026-03-01' });
  assert.equal(appeal.deadline, '2026-04-02'); // месяц по ст. 321
  const terms = computeIndependentTerms({
    child_return_reasoned_decision_date: '2026-03-02',
    interim_ruling_date: '2026-03-02',
    child_return_interim_ruling_date: '2026-03-02',
  });
  assert.equal(terms.child_return_appeal.deadline, '2026-03-17'); // 10 рабочих дней
  // Частная жалоба общего порядка (ст. 332) — 15 рабочих дней, глава 22.2 — 10.
  assert.equal(terms.private_complaint.deadline, '2026-03-24');
  assert.equal(terms.child_return_private_complaint.deadline, '2026-03-17');
});

test('глава 22.2: рабочие дни, а не календарные — перенос через каникулы', () => {
  // Решение в окончательной форме 26.12.2025 (пятница). Течение — с 29.12;
  // 31.12.2025 и 01–09.01.2026 нерабочие, поэтому десятый рабочий день —
  // 21.01.2026, а не 05.01.2026, как было бы при календарном счёте.
  const t = computeIndependentTerms({ child_return_reasoned_decision_date: '2025-12-26' })
    .child_return_appeal;
  assert.equal(t.first_working_day, '2025-12-29');
  assert.equal(t.deadline, '2026-01-21');

  const p = computeIndependentTerms({ child_return_interim_ruling_date: '2025-12-26' })
    .child_return_private_complaint;
  assert.equal(p.first_working_day, '2025-12-29');
  assert.equal(p.deadline, '2026-01-21');
});

test('глава 22.2: течение начинается с первого рабочего дня', () => {
  // 20.02.2026 (пятница): 21–22 выходные, 23 февраля праздник — отсчёт идёт
  // с 24.02, а не со следующего календарного дня.
  const t = computeIndependentTerms({ child_return_reasoned_decision_date: '2026-02-20' })
    .child_return_appeal;
  assert.equal(t.first_working_day, '2026-02-24');
  assert.equal(t.deadline, '2026-03-10');

  const p = computeIndependentTerms({ child_return_interim_ruling_date: '2026-02-20' })
    .child_return_private_complaint;
  assert.equal(p.first_working_day, '2026-02-24');
  assert.equal(p.deadline, '2026-03-10');
});

test('глава 22.2: узлов нет без своих дат', () => {
  const empty = computeIndependentTerms({});
  assert.equal(empty.child_return_appeal, null);
  assert.equal(empty.child_return_private_complaint, null);
  const chain = computeChain(BASE, { today: '2026-03-01' });
  assert.equal(chain.child_return_appeal, null);
  assert.equal(chain.child_return_private_complaint, null);
  // Даты общей ветви и общей частной жалобы эти узлы не открывают: у главы 22.2
  // свои поля.
  const other = computeIndependentTerms({
    reasoned_decision_date: '2026-03-02',
    interim_ruling_date: '2026-03-02',
  });
  assert.equal(other.child_return_appeal, null);
  assert.equal(other.child_return_private_complaint, null);
});

test('глава 22.2: апелляция и частная жалоба считаются независимо', () => {
  // Оба поля ситуации друг от друга не зависят: можно заполнить только одно,
  // только другое, оба или ни одного. Якоря разные, поэтому и даты разные.
  const onlyAppeal = computeIndependentTerms({
    child_return_reasoned_decision_date: '2026-03-02',
  });
  assert.ok(onlyAppeal.child_return_appeal);
  assert.equal(onlyAppeal.child_return_private_complaint, null);

  const onlyPrivate = computeIndependentTerms({ child_return_interim_ruling_date: '2026-02-20' });
  assert.equal(onlyPrivate.child_return_appeal, null);
  assert.ok(onlyPrivate.child_return_private_complaint);

  const both = computeIndependentTerms({
    child_return_reasoned_decision_date: '2026-03-02',
    child_return_interim_ruling_date: '2026-02-20',
  });
  // Каждый узел считается от своего якоря — соседнее поле его не сдвигает.
  assert.equal(both.child_return_appeal.deadline, onlyAppeal.child_return_appeal.deadline);
  assert.equal(
    both.child_return_private_complaint.deadline,
    onlyPrivate.child_return_private_complaint.deadline,
  );
  assert.equal(both.child_return_appeal.deadline, '2026-03-17');
  assert.equal(both.child_return_private_complaint.deadline, '2026-03-10');

  const neither = computeIndependentTerms({});
  assert.equal(neither.child_return_appeal, null);
  assert.equal(neither.child_return_private_complaint, null);
});

test('глава 22.2: узлы доступны и через computeChain', () => {
  const chain = computeChain(
    {
      ...BASE,
      child_return_reasoned_decision_date: '2026-03-02',
      child_return_interim_ruling_date: '2026-02-20',
    },
    { today: '2026-03-01' },
  );
  assert.equal(chain.child_return_appeal.deadline, '2026-03-17');
  assert.equal(chain.child_return_private_complaint.deadline, '2026-03-10');
  assert.match(chain.child_return_appeal.midnight_rule, /ч\. 3 ст\. 108/);
  assert.match(chain.child_return_private_complaint.midnight_rule, /ч\. 3 ст\. 108/);
});

// --- Усыновление (удочерение) ребёнка (глава 29 ГПК) -------------------------

test('усыновление: апелляция — 10 рабочих дней со дня решения в окончательной форме', () => {
  const t = computeIndependentTerms({ adoption_reasoned_decision_date: '2026-03-02' })
    .adoption_appeal;
  assert.equal(t.anchor, '2026-03-02');
  assert.equal(t.first_working_day, '2026-03-03'); // течение со следующего дня
  assert.equal(t.deadline, '2026-03-17');
  assert.equal(t.shifted, false); // ч. 2 ст. 108 к срокам в рабочих днях не применяется
  assert.match(t.norm.primary, /ч\. 2\.1 ст\. 274/);
  assert.deepEqual(t.norm.calculation, ['ч. 3 (абз. 2) ст. 107 ГПК РФ']);
  assert.deepEqual(t.duration, { value: 10, unit: 'working_day' });
});

test('усыновление: рабочие дни, а не календарные — перенос через каникулы', () => {
  // Решение в окончательной форме 26.12.2025 (пятница). Течение — с 29.12;
  // 31.12.2025 и 01–09.01.2026 нерабочие, поэтому десятый рабочий день —
  // 21.01.2026, а не 05.01.2026, как было бы при календарном счёте.
  const t = computeIndependentTerms({ adoption_reasoned_decision_date: '2025-12-26' })
    .adoption_appeal;
  assert.equal(t.first_working_day, '2025-12-29');
  assert.equal(t.deadline, '2026-01-21');
});

test('усыновление: узла нет без даты решения в окончательной форме', () => {
  assert.equal(computeIndependentTerms({}).adoption_appeal, null);
  assert.equal(computeChain(BASE, { today: '2026-03-01' }).adoption_appeal, null);
  // Дата решения общей ветви этот узел не открывает — у главы 29 своё поле.
  assert.equal(
    computeIndependentTerms({ reasoned_decision_date: '2026-03-02' }).adoption_appeal,
    null,
  );
});

test('усыновление: узел доступен и через computeChain', () => {
  const chain = computeChain(
    { ...BASE, adoption_reasoned_decision_date: '2026-03-02' },
    { today: '2026-03-01' },
  );
  assert.equal(chain.adoption_appeal.deadline, '2026-03-17');
  assert.match(chain.adoption_appeal.midnight_rule, /ч\. 3 ст\. 108/);
});

// --- Периодические платежи: предъявление к исполнению (ч. 4 ст. 21 229-ФЗ) --

test('периодические платежи: 3 года со дня окончания периода, перенос через выходные', () => {
  const t = computeIndependentTerms({ periodic_payment_period_end_date: '2023-04-12' })
    .periodic_payments_presentation;
  assert.equal(t.anchor, '2023-04-12');
  assert.equal(t.raw_deadline, '2026-04-12'); // воскресенье
  assert.equal(t.deadline, '2026-04-13'); // перенос на понедельник (ч. 2 ст. 108)
  assert.equal(t.shifted, true);
  assert.match(t.norm.primary, /ч\. 4 ст\. 21/);
});

test('периодические платежи: бессрочное взыскание — not_applicable без дедлайна', () => {
  const t = computeIndependentTerms({ periodic_payment_indefinite: true })
    .periodic_payments_presentation;
  assert.ok(t);
  assert.equal(t.status, 'not_applicable');
  assert.equal(t.deadline, undefined);
  assert.match(t.reason, /бессрочно/);
  assert.match(t.norm, /ч\. 4 ст\. 21/);
});

test('периодические платежи: бессрочность важнее введённой даты окончания периода', () => {
  const t = computeIndependentTerms({
    periodic_payment_period_end_date: '2023-04-12',
    periodic_payment_indefinite: true,
  }).periodic_payments_presentation;
  assert.equal(t.status, 'not_applicable');
});

test('периодические платежи: узла нет без даты окончания периода и без отметки о бессрочности', () => {
  assert.equal(computeIndependentTerms({}).periodic_payments_presentation, null);
  assert.equal(computeChain(BASE, { today: '2026-03-01' }).periodic_payments_presentation, null);
});

test('периодические платежи: узел не зависит от полей общей цепочки', () => {
  const chain = computeChain(
    { ...BASE, periodic_payment_period_end_date: '2023-04-12' },
    { today: '2026-03-01' },
  );
  assert.ok(chain.periodic_payments_presentation);
  assert.equal(chain.periodic_payments_presentation.deadline, '2026-04-13');
});

// --- Перерыв срока предъявления (ч. 1–3 ст. 22 ФЗ № 229-ФЗ) -----------------
//
// Базовые ориентиры: BASE + today 01.05.2025 → вступление в силу 12.04.2025,
// предъявление ИЛ без перерывов — 12.04.2028.
const ENF_BASE_ANCHOR = '2025-04-12';
const ENF_BASE_DEADLINE = '2028-04-12';

// Расчёт ИЛ общей цепочки с заданным списком перерывов.
function enforcementWith(interruptions) {
  return computeChain(
    { ...BASE, enforcement_interruptions: interruptions },
    { today: '2025-05-01' },
  ).enforcement;
}

test('applyInterruptions: без событий якорь не меняется', () => {
  assert.equal(applyInterruptions('2025-04-12', undefined), '2025-04-12');
  assert.equal(applyInterruptions('2025-04-12', null), '2025-04-12');
  assert.equal(applyInterruptions('2025-04-12', []), '2025-04-12');
});

test('applyInterruptions: якорь — последнее по хронологии событие, а не по порядку ввода', () => {
  const anchor = applyInterruptions('2025-04-12', [
    { type: 'partial_execution', date: '2027-02-10' },
    { type: 'presentment', date: '2026-06-01' },
    { type: 'returned_no_assets', date: '2026-11-30' },
  ]);
  assert.equal(anchor, '2027-02-10');
});

test('перерыв: без событий расчёт ИЛ не меняется (регресс)', () => {
  const plain = enforcementWith(undefined);
  assert.equal(plain.anchor, ENF_BASE_ANCHOR);
  assert.equal(plain.deadline, ENF_BASE_DEADLINE);
  // Полей перерыва нет вовсе — карточке нечего показывать.
  assert.equal(plain.interruptions, undefined);
  assert.equal(plain.base_anchor, undefined);
  assert.equal(plain.interruption_warning, undefined);
  assert.deepEqual(enforcementWith([]), plain);
});

test('перерыв: одно событие — три года от его даты, исходный якорь сохранён', () => {
  const enf = enforcementWith([{ type: 'presentment', date: '2026-06-01' }]);
  assert.equal(enf.anchor, '2026-06-01');
  assert.equal(enf.deadline, '2029-06-01'); // ч. 2 ст. 22: срок течёт заново
  assert.equal(enf.base_anchor, ENF_BASE_ANCHOR);
  assert.match(enf.interruption_norm, /ст\. 22/);
  assert.equal(enf.interruption_warning.norm, 'ч. 3.1 ст. 22 ФЗ № 229-ФЗ');
});

test('перерыв: несколько событий вразнобой — берётся хронологически последнее', () => {
  const enf = enforcementWith([
    { type: 'partial_execution', date: '2027-02-10' },
    { type: 'presentment', date: '2026-06-01' },
    { type: 'returned_no_assets', date: '2026-11-30' },
  ]);
  // Последнее по дате — 10.02.2027, хотя во вводе оно первое.
  assert.equal(enf.anchor, '2027-02-10');
  assert.equal(enf.raw_deadline, '2030-02-10'); // воскресенье
  assert.equal(enf.deadline, '2030-02-11'); // перенос по ч. 2 ст. 108
  // Перезапуск, а не накопление: три года ровно, а не 3 × 3.
  assert.equal(enf.shifted, true);
  // История отсортирована по дате по возрастанию.
  assert.deepEqual(
    enf.interruptions.map((e) => e.date),
    ['2026-06-01', '2026-11-30', '2027-02-10'],
  );
});

test('перерыв: событие раньше базового якоря не учитывается и видно в истории', () => {
  const enf = enforcementWith([{ type: 'presentment', date: '2025-01-10' }]);
  // Дедлайн не может оказаться раньше базового: прерывать ещё не начавшийся
  // срок нечем.
  assert.equal(enf.anchor, ENF_BASE_ANCHOR);
  assert.equal(enf.deadline, ENF_BASE_DEADLINE);
  // Но событие не выброшено молча — оно в истории с причиной.
  assert.equal(enf.interruptions.length, 1);
  assert.equal(enf.interruptions[0].ignored, true);
  assert.equal(enf.interruptions[0].ignored_reason, 'before_anchor');
});

test('перерыв: раннее событие не отменяет более позднего', () => {
  const enf = enforcementWith([
    { type: 'presentment', date: '2025-01-10' }, // раньше якоря — мимо
    { type: 'partial_execution', date: '2026-06-01' },
  ]);
  assert.equal(enf.anchor, '2026-06-01');
  assert.equal(enf.deadline, '2029-06-01');
});

test('перерыв: событие без даты и с неизвестным основанием в расчёт не идёт', () => {
  const events = interruptionEvents(ENF_BASE_ANCHOR, [
    { type: 'presentment', date: null },
    { type: 'creditor_request', date: '2026-06-01' }, // ч. 3.1 — вне модели
  ]);
  assert.deepEqual(
    events.map((e) => e.ignored_reason),
    ['unknown_type', 'no_date'], // события без даты уходят в конец списка
  );
  assert.equal(applyInterruptions(ENF_BASE_ANCHOR, [{ type: 'creditor_request', date: '2026-06-01' }]), ENF_BASE_ANCHOR);
});

test('перерыв: событие в день базового якоря дедлайн не меняет', () => {
  const enf = enforcementWith([{ type: 'presentment', date: ENF_BASE_ANCHOR }]);
  assert.equal(enf.deadline, ENF_BASE_DEADLINE);
  assert.equal(enf.interruptions[0].ignored, undefined);
});

test('перерыв: судебный приказ считается от последнего события (ч. 1 ст. 22)', () => {
  const plain = computeIndependentTerms({ court_order_issued_date: '2023-04-12' })
    .court_order_presentation;
  assert.equal(plain.deadline, '2026-04-13');
  assert.equal(plain.interruptions, undefined);

  const interrupted = computeIndependentTerms({
    court_order_issued_date: '2023-04-12',
    enforcement_interruptions: [{ type: 'presentment', date: '2024-03-05' }],
  }).court_order_presentation;
  assert.equal(interrupted.anchor, '2024-03-05');
  assert.equal(interrupted.deadline, '2027-03-05');
  assert.equal(interrupted.base_anchor, '2023-04-12');
});

test('перерыв: периодические платежи не прерываются (ч. 4 ст. 21 вне объёма ст. 22)', () => {
  // Список перерывов общий на все узлы предъявления, но у периодических
  // платежей срок не фиксированная величина — модификатор к нему не применяется.
  const events = [{ type: 'presentment', date: '2025-06-01' }];
  const plain = computeIndependentTerms({ periodic_payment_period_end_date: '2023-04-12' })
    .periodic_payments_presentation;
  const withEvents = computeIndependentTerms({
    periodic_payment_period_end_date: '2023-04-12',
    enforcement_interruptions: events,
  }).periodic_payments_presentation;
  assert.deepEqual(withEvents, plain);
  assert.equal(withEvents.deadline, '2026-04-13');
  assert.equal(withEvents.interruptible, undefined);
  assert.equal(withEvents.interruptions, undefined);

  // Бессрочная ветка тоже не меняется — там дедлайна нет в принципе.
  const indefinite = computeIndependentTerms({
    periodic_payment_indefinite: true,
    enforcement_interruptions: events,
  }).periodic_payments_presentation;
  assert.equal(indefinite.status, 'not_applicable');
  assert.equal(indefinite.interruptions, undefined);
});

test('обе ветки предъявления считаются вместе и не мешают друг другу', () => {
  const terms = computeIndependentTerms({
    court_order_issued_date: '2023-04-12',
    periodic_payment_period_end_date: '2023-04-12',
    enforcement_interruptions: [{ type: 'partial_execution', date: '2024-03-05' }],
  });
  // Приказ прерван, периодические платежи — нет, при одном и том же вводе.
  assert.equal(terms.court_order_presentation.deadline, '2027-03-05');
  assert.equal(terms.periodic_payments_presentation.deadline, '2026-04-13');
});

test('перерыв: работает во всех ветвях предъявления ИЛ', () => {
  const events = [{ type: 'returned_no_assets', date: '2027-03-01' }];

  const simplified = computeSimplified(
    {
      simplified_resolution_date: '2025-03-11',
      simplified_appeal_filed_date: '2025-03-20',
      simplified_appeal_ruling_date: '2025-06-02',
      enforcement_interruptions: events,
    },
    '2025-07-01',
  ).enforcement;
  assert.equal(simplified.anchor, '2027-03-01');
  assert.equal(simplified.deadline, '2030-03-01');

  const mirovoy = computeMirovoy(
    {
      mirovoy_resolution_date: '2025-03-11',
      mirovoy_appeal_ruling_date: '2025-06-02',
      enforcement_interruptions: events,
    },
    '2025-07-01',
  ).enforcement;
  assert.equal(mirovoy.anchor, '2027-03-01');
  assert.equal(mirovoy.deadline, '2030-03-01');

  const dj = computeDefaultJudgment(
    {
      default_judgment_service_date: '2025-03-11',
      default_judgment_appeal_filed_date: '2025-04-01',
      default_judgment_appeal_ruling_date: '2025-06-02',
      enforcement_interruptions: events,
    },
    '2025-07-01',
  ).enforcement;
  assert.equal(dj.anchor, '2027-03-01');
  assert.equal(dj.deadline, '2030-03-01');
});

// --- Кассация по делам мировых судей (глава 40.1 ГПК, ФЗ № 79-ФЗ) -----------

const MIR_CASS = {
  mirovoy_resolution_date: '2026-01-15',
  mirovoy_appeal_ruling_reasoned_date: '2026-03-01',
};

test('кассация мировых: отсчёт от мотивированного апелляционного определения', () => {
  const c = computeMirovoy(MIR_CASS, '2026-07-01').cassation;
  assert.equal(c.anchor_kind, 'appeal_reasoned');
  assert.equal(c.anchor, '2026-03-01');
  assert.equal(c.deadline, '2026-06-01');
  assert.match(c.logic, /мотивированного апелляционного определения/);
});

test('кассация мировых: отсчёт от вступления в силу, если апелляции не было', () => {
  // Решение 15.01.2026 → апелляция 16.02.2026 → вступление в силу 17.02.2026.
  const m = computeMirovoy({ mirovoy_resolution_date: '2026-01-15' }, '2026-07-01');
  assert.equal(m.appeal.deadline, '2026-02-16');
  assert.equal(m.cassation.anchor_kind, 'entry_into_force');
  assert.equal(m.cassation.anchor, '2026-02-17');
  assert.equal(m.cassation.deadline, '2026-05-18'); // 17.05.2026 — воскресенье
  assert.match(m.cassation.logic, /вступления обжалуемого постановления/);
});

test('кассация мировых: граница маршрута 09.05 / 10.05.2026', () => {
  const before = computeMirovoy({ ...MIR_CASS, cassation_filed_date: '2026-05-09' }, '2026-07-01');
  const after = computeMirovoy({ ...MIR_CASS, cassation_filed_date: '2026-05-10' }, '2026-07-01');
  assert.equal(before.cassation.version_id, 'ksoyu_before_79fz');
  assert.match(before.cassation.norm.primary, /376\.1/);
  assert.equal(after.cassation.version_id, 'presidium_from_79fz');
  assert.match(after.cassation.norm.primary, /375\.2/);
  // Срок в обоих маршрутах считается одинаково — меняется только суд и норма.
  assert.equal(before.cassation.deadline, after.cassation.deadline);
});

test('кассация мировых: переходное положение помечается только для прежнего маршрута', () => {
  const before = computeMirovoy({ ...MIR_CASS, cassation_filed_date: '2026-05-09' }, '2026-07-01');
  assert.match(before.cassation.transitional_note, /по прежним правилам/);
  assert.match(before.cassation.court, /Кассационный суд общей юрисдикции/);
  const after = computeMirovoy({ ...MIR_CASS, cassation_filed_date: '2026-05-10' }, '2026-07-01');
  assert.equal(after.cassation.transitional_note, undefined);
  assert.match(after.cassation.court, /Президиум областного/);
});

test('кассация мировых: при планировании маршрут по текущей дате', () => {
  assert.equal(computeMirovoy(MIR_CASS, '2026-05-09').cassation.version_id, 'ksoyu_before_79fz');
  assert.equal(computeMirovoy(MIR_CASS, '2026-05-10').cassation.version_id, 'presidium_from_79fz');
});

test('кассация мировых: узла нет без данных апелляции районного суда', () => {
  // Апелляционного определения нет и срок апелляционного обжалования ещё течёт.
  const m = computeMirovoy({ mirovoy_resolution_date: '2026-01-15' }, '2026-02-01');
  assert.equal(m.cassation, null);
  // Без текущей даты тоже нечего показывать.
  assert.equal(computeMirovoy({ mirovoy_resolution_date: '2026-01-15' }).cassation, null);
});

// --- Мировой: вступление в силу (ч. 1 ст. 209) и предъявление ИЛ ------------

test('мировой, вступление в силу: три ветви события', () => {
  // Резолютивная часть 22.12.2025 → апелляция (present) истекает 22.01.2026.
  // not_appealed: срок апелляции истёк, жалоба не подавалась.
  const notAppealed = computeMirovoy(MIR, '2026-03-01');
  assert.equal(notAppealed.entry_into_force.branch, 'not_appealed');
  assert.equal(notAppealed.entry_into_force.resolved, true);
  assert.equal(notAppealed.entry_into_force.date, '2026-01-23'); // дедлайн 22.01 + 1
  assert.match(notAppealed.entry_into_force.norm, /ч\. 1 ст\. 209/);

  // pending: срок апелляции ещё течёт.
  const pending = computeMirovoy(MIR, '2026-01-10');
  assert.equal(pending.entry_into_force.branch, 'pending');
  assert.equal(pending.entry_into_force.resolved, false);
  assert.equal(pending.entry_into_force.date, null);
  assert.match(pending.entry_into_force.message, /не ранее 2026-01-23/);

  // appealed: разрешается датой ПРИНЯТИЯ апелляционного определения.
  const appealed = computeMirovoy(
    { ...MIR, mirovoy_appeal_ruling_date: '2026-05-10' },
    '2026-06-01',
  );
  assert.equal(appealed.entry_into_force.branch, 'appealed');
  assert.equal(appealed.entry_into_force.resolved, true);
  assert.equal(appealed.entry_into_force.date, '2026-05-10'); // день принятия
});

test('мировой, appealed: известно только изготовление — просим дату принятия', () => {
  // Обжаловано (есть изготовление для кассации), но даты принятия нет — событие
  // не разрешено, дату вступления в силу не выдумываем.
  const m = computeMirovoy(
    { ...MIR, mirovoy_appeal_ruling_reasoned_date: '2026-05-15' },
    '2026-06-01',
  );
  assert.equal(m.entry_into_force.branch, 'appealed');
  assert.equal(m.entry_into_force.resolved, false);
  assert.equal(m.entry_into_force.date, null);
  assert.deepEqual(m.entry_into_force.missing_inputs, ['mirovoy_appeal_ruling_date']);
});

test('мировой, предъявление ИЛ — 3 года со дня вступления в силу', () => {
  // not_appealed: ИЛ от даты события (23.01.2026).
  const notAppealed = computeMirovoy(MIR, '2026-03-01');
  assert.ok(notAppealed.enforcement);
  assert.equal(notAppealed.enforcement.id, 'mirovoy_enforcement_presentation');
  assert.equal(notAppealed.enforcement.anchor, '2026-01-23');
  assert.equal(notAppealed.enforcement.deadline, '2029-01-23'); // + 3 года
  assert.match(notAppealed.enforcement.norm.primary, /229-ФЗ/);

  // appealed: ИЛ от даты принятия апелляционного определения.
  const appealed = computeMirovoy(
    { ...MIR, mirovoy_appeal_ruling_date: '2026-05-10' },
    '2026-06-01',
  );
  assert.equal(appealed.enforcement.anchor, '2026-05-10');
});

test('мировой: ИЛ отсутствует, пока вступление в силу не разрешено (pending)', () => {
  const pending = computeMirovoy(MIR, '2026-01-10');
  assert.equal(pending.entry_into_force.resolved, false);
  assert.equal(pending.enforcement, null);
});

// --- Исчерпание способов обжалования (абз. 2 ч. 1 ст. 376, ч. 2 ст. 375.1) ---

test('исчерпание: КСОЮ в ветви not_appealed несёт предупреждение', () => {
  const c = computeChain({ reasoned_decision_date: '2025-03-11' }, { today: '2025-05-01' });
  assert.equal(c.entry_into_force.branch, 'not_appealed');
  const w = c.cassation.exhaustion_warning;
  assert.ok(w, 'предупреждение должно быть');
  assert.equal(w.code, 'appeal_not_exhausted');
  assert.match(w.norm, /абз\. 2 ч\. 1 ст\. 376/);
  assert.match(w.norm, /ч\. 2 ст\. 375\.1/);
  assert.match(w.clarification, /№ 17/);
  assert.match(w.text, /возврату без рассмотрения/);
  assert.match(w.calculation_note, /судебный приказ/);
  // Расчёт остаётся: предупреждение его не отменяет.
  assert.equal(c.cassation.deadline, '2025-07-14'); // 12.07.2025 — суббота
});

test('исчерпание: в ветви appealed предупреждения нет', () => {
  const c = computeChain(
    {
      reasoned_decision_date: '2025-03-11',
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      appeal_ruling_reasoned_date: '2025-06-02',
    },
    { today: '2025-07-01' },
  );
  assert.equal(c.entry_into_force.branch, 'appealed');
  assert.equal(c.cassation.exhaustion_warning, undefined);
});

test('исчерпание: кассация мировых несёт предупреждение только без апелляции', () => {
  const notAppealed = computeMirovoy({ mirovoy_resolution_date: '2026-01-15' }, '2026-07-01');
  assert.equal(notAppealed.cassation.anchor_kind, 'entry_into_force');
  assert.equal(notAppealed.cassation.exhaustion_warning.code, 'appeal_not_exhausted');

  const appealed = computeMirovoy(MIR_CASS, '2026-07-01');
  assert.equal(appealed.cassation.anchor_kind, 'appeal_reasoned');
  assert.equal(appealed.cassation.exhaustion_warning, undefined);
});

test('ст. 237: при удовлетворении заявления апелляционный срок не исчисляется', () => {
  const d = computeDefaultJudgment({
    ...DJ,
    default_judgment_cancellation_request_date: '2026-01-09',
    default_judgment_cancellation_date: '2026-01-20',
  });
  assert.equal(d.appeal, null, 'срока нет — считать нечего');
  assert.equal(d.appeal_blocked, null, 'это не «не хватает данных»');
  assert.ok(d.appeal_not_applicable);
  assert.match(d.appeal_not_applicable.message, /отменено/);
  assert.match(d.appeal_not_applicable.reason, /ч\. 1 ст\. 241/);
  assert.match(d.appeal_not_applicable.reason, /определения об отказе/);

  // Введённая дата определения об отказе состояния не меняет: удовлетворение и
  // отказ взаимоисключающи, приоритет у отмены решения.
  const withRefusal = computeDefaultJudgment({
    ...DJ,
    default_judgment_refusal_date: '2026-02-10',
    default_judgment_cancellation_date: '2026-01-20',
  });
  assert.equal(withRefusal.appeal, null);
  assert.ok(withRefusal.appeal_not_applicable);
});

// --- Пересмотр по вновь открывшимся/новым обстоятельствам (глава 42 ГПК) ---

const REVIEW_NORM_PATTERNS = {
  newly_discovered_fact: /п\. 1 ч\. 3 ст\. 392/,
  false_testimony_or_crime: /пп\. 2, 3 ч\. 3 ст\. 392/,
  annulled_underlying_act: /п\. 1 ч\. 4 ст\. 392/,
  transaction_invalidated: /п\. 2 ч\. 4 ст\. 392/,
  ks_ruling: /п\. 3 ч\. 4 ст\. 392/,
  unauthorized_construction: /п\. 6 ч\. 4/,
};

// Шесть оснований с единым якорем (review_circumstance_date) — седьмое,
// vs_practice_change, устроено иначе (см. блок тестов ниже) и в этот список
// не входит.
const SIMPLE_REVIEW_GROUND_IDS = [
  'newly_discovered_fact',
  'false_testimony_or_crime',
  'annulled_underlying_act',
  'transaction_invalidated',
  'ks_ruling',
  'unauthorized_construction',
];

test('пересмотр: семь оснований на месте, включая практику ВС (п. 5 ч. 4 ст. 392)', () => {
  assert.deepEqual(
    REVIEW_GROUNDS.map((g) => g.id),
    [...SIMPLE_REVIEW_GROUND_IDS, 'vs_practice_change'],
  );
  assert.equal(REVIEW_GROUNDS.length, 7);
});

test('пересмотр: три месяца от даты обстоятельства для каждого из шести простых оснований (ч. 1 ст. 394)', () => {
  for (const groundId of SIMPLE_REVIEW_GROUND_IDS) {
    const t = computeIndependentTerms({
      review_ground: groundId,
      review_circumstance_date: '2025-09-01',
    }).review_new_circumstances_filing;
    assert.ok(t, `основание ${groundId}: узел должен считаться`);
    assert.equal(t.anchor, '2025-09-01');
    assert.equal(t.offset_start, 1);
    assert.equal(t.deadline, '2025-12-01');
    assert.deepEqual(t.duration, { value: 3, unit: 'month' });
    assert.match(t.norm.primary, REVIEW_NORM_PATTERNS[groundId]);
    assert.match(t.norm.primary, /ч\. 1 ст\. 394/);
  }
});

test('пересмотр: перенос последнего дня (ч. 2 ст. 108)', () => {
  // 11.01.2026 + 3 месяца = 11.04.2026 (суббота) → 13.04.2026 (понедельник).
  const t = computeIndependentTerms({
    review_ground: 'newly_discovered_fact',
    review_circumstance_date: '2026-01-11',
  }).review_new_circumstances_filing;
  assert.equal(t.raw_deadline, '2026-04-11');
  assert.equal(t.deadline, '2026-04-13');
  assert.equal(t.shifted, true);
});

test('пересмотр: узла нет без основания, без даты либо с нераспознанным основанием', () => {
  assert.equal(computeIndependentTerms({}).review_new_circumstances_filing, null);
  assert.equal(
    computeIndependentTerms({ review_circumstance_date: '2025-09-01' })
      .review_new_circumstances_filing,
    null,
  );
  assert.equal(
    computeIndependentTerms({ review_ground: 'newly_discovered_fact' })
      .review_new_circumstances_filing,
    null,
  );
  // Нераспознанное основание (не путать с настоящим id практики ВС —
  // vs_practice_change) не должно молча посчитаться по какой-то из семи норм.
  assert.equal(
    computeIndependentTerms({
      review_ground: 'plenum_practice',
      review_circumstance_date: '2025-09-01',
    }).review_new_circumstances_filing,
    null,
  );
});

test('пересмотр: узел независим от цепочки обжалования и от категории дела', () => {
  const alone = computeIndependentTerms({
    review_ground: 'ks_ruling',
    review_circumstance_date: '2025-09-01',
  }).review_new_circumstances_filing;
  assert.ok(alone);

  const withBranches = computeIndependentTerms({
    review_ground: 'ks_ruling',
    review_circumstance_date: '2025-09-01',
    reasoned_decision_date: '2025-03-11',
    mirovoy_resolution_date: '2025-07-06',
    default_judgment_service_date: '2025-07-05',
    simplified_resolution_date: '2025-07-03',
  }).review_new_circumstances_filing;
  assert.equal(withBranches.deadline, alone.deadline);
  assert.equal(withBranches.anchor, alone.anchor);

  const chain = computeChain(
    { ...BASE, review_ground: 'ks_ruling', review_circumstance_date: '2025-09-01' },
    { today: '2025-09-10' },
  );
  assert.equal(chain.review_new_circumstances_filing.deadline, alone.deadline);
  assert.equal(computeChain(BASE, { today: '2025-09-10' }).review_new_circumstances_filing, null);
});

test('пересмотр: заведомо ложные показания — logic упоминает ч. 3.1 ст. 392, но не заводит вторую дату', () => {
  const t = computeIndependentTerms({
    review_ground: 'false_testimony_or_crime',
    review_circumstance_date: '2025-09-01',
  }).review_new_circumstances_filing;
  assert.match(t.logic, /ч\. 3\.1 ст\. 392/);
});

test('пересмотр: самовольная постройка — logic поясняет, почему ст. 395 не указана', () => {
  const t = computeIndependentTerms({
    review_ground: 'unauthorized_construction',
    review_circumstance_date: '2025-09-01',
  }).review_new_circumstances_filing;
  assert.match(t.logic, /395.*не перечисляет/);
});

// --- Практика ВС (п. 5 ч. 4 ст. 392, ч. 1 и ч. 3 ст. 394): минимум из двух ---

test('практика ВС: обычный случай — трёхмесячный компонент раньше потолка, итог по нему', () => {
  // Публикация 01.09.2025 → +3 мес. = 01.12.2025. Последний акт вступил в силу
  // незадолго до этого (01.08.2025) — потолок (+6 мес. = 01.02.2026, с переносом
  // 02.02.2026) наступает позже и не контролирует.
  const t = computeIndependentTerms({
    review_ground: 'vs_practice_change',
    review_publication_date: '2025-09-01',
    review_last_act_entry_into_force_date: '2025-08-01',
  }).review_new_circumstances_filing;
  assert.ok(t);
  assert.equal(t.controlling, 'three_month');
  assert.equal(t.deadline, '2025-12-01');
  assert.deepEqual(t.duration, { value: 3, unit: 'month' });
  assert.equal(t.vs_practice_change.three_month.deadline, '2025-12-01');
  assert.equal(t.vs_practice_change.six_month_cap.deadline, '2026-02-02');
  assert.equal(t.vs_practice_change.discovered_during_cassation, false);
  assert.match(t.norm.primary, /п\. 5 ч\. 4 ст\. 392/);
  assert.match(t.norm.primary, /ч\. 3 ст\. 394/);
});

test('практика ВС: обычный случай — шестимесячный потолок раньше, итог по потолку', () => {
  // Публикация далеко в будущем от вступления в силу последнего акта: потолок
  // (+6 мес. от вступления в силу) наступает раньше трёхмесячного компонента.
  const t = computeIndependentTerms({
    review_ground: 'vs_practice_change',
    review_publication_date: '2025-09-01',
    review_last_act_entry_into_force_date: '2025-01-01',
  }).review_new_circumstances_filing;
  assert.ok(t);
  assert.equal(t.controlling, 'six_month');
  assert.equal(t.deadline, '2025-07-01');
  assert.deepEqual(t.duration, { value: 6, unit: 'month' });
  assert.equal(t.vs_practice_change.three_month.deadline, '2025-12-01');
  assert.equal(t.vs_practice_change.six_month_cap.deadline, '2025-07-01');
});

test('практика ВС: обнаружено при рассмотрении кассационной/надзорной жалобы — якорь меняется, потолок остаётся', () => {
  const t = computeIndependentTerms({
    review_ground: 'vs_practice_change',
    review_discovered_during_cassation: true,
    review_refusal_ruling_received_date: '2025-09-01',
    // Публикация тоже указана — при включённом toggle она должна игнорироваться.
    review_publication_date: '2020-01-01',
    // Последний акт вступил в силу незадолго до этого — потолок (+6 мес.)
    // наступает позже трёхмесячного компонента (+3 мес. от копии определения)
    // и в этом расчёте не контролирует.
    review_last_act_entry_into_force_date: '2025-08-01',
  }).review_new_circumstances_filing;
  assert.ok(t);
  assert.equal(t.vs_practice_change.discovered_during_cassation, true);
  assert.equal(t.vs_practice_change.three_month.anchor_field, 'review_refusal_ruling_received_date');
  assert.equal(t.vs_practice_change.three_month.anchor, '2025-09-01');
  assert.equal(t.controlling, 'three_month');
  assert.equal(t.deadline, '2025-12-01');
  // Потолок по-прежнему посчитан и учтён (с переносом нерабочего 01.02.2026 —
  // воскресенья — на 02.02.2026), просто не контролирует в этом случае.
  assert.equal(t.vs_practice_change.six_month_cap.deadline, '2026-02-02');
  assert.match(t.logic, /кассационной\/надзорной жалобы/);
});

test('практика ВС: равенство дат — детерминированный результат, не падает', () => {
  // 01.06.2025 + 3 мес. = 01.09.2025; 01.03.2025 + 6 мес. = 01.09.2025 — те же сутки.
  const t = computeIndependentTerms({
    review_ground: 'vs_practice_change',
    review_publication_date: '2025-06-01',
    review_last_act_entry_into_force_date: '2025-03-01',
  }).review_new_circumstances_filing;
  assert.ok(t);
  assert.equal(t.vs_practice_change.three_month.deadline, t.vs_practice_change.six_month_cap.deadline);
  assert.equal(t.deadline, '2025-09-01');
  // Тай-брейк фиксирован — трёхмесячный компонент, сравнение нестрогое (<=).
  assert.equal(t.controlling, 'three_month');
});

test('практика ВС: перенос последнего дня применяется к обоим компонентам (ч. 2 ст. 108)', () => {
  // Потолок: 11.10.2025 + 6 мес. = 11.04.2026 (суббота) → 13.04.2026.
  const t = computeIndependentTerms({
    review_ground: 'vs_practice_change',
    review_publication_date: '2026-03-01', // трёхмесячный компонент заведомо позже
    review_last_act_entry_into_force_date: '2025-10-11',
  }).review_new_circumstances_filing;
  assert.equal(t.controlling, 'six_month');
  assert.equal(t.vs_practice_change.six_month_cap.raw_deadline, '2026-04-11');
  assert.equal(t.vs_practice_change.six_month_cap.deadline, '2026-04-13');
  assert.equal(t.shifted, true);
  assert.equal(t.deadline, '2026-04-13');
});

test('практика ВС: unresolved — точно указывает, какого поля не хватает', () => {
  assert.deepEqual(
    computeIndependentTerms({ review_ground: 'vs_practice_change' }).review_new_circumstances_missing,
    ['review_publication_date', 'review_last_act_entry_into_force_date'],
  );
  assert.deepEqual(
    computeIndependentTerms({
      review_ground: 'vs_practice_change',
      review_publication_date: '2025-09-01',
    }).review_new_circumstances_missing,
    ['review_last_act_entry_into_force_date'],
  );
  assert.deepEqual(
    computeIndependentTerms({
      review_ground: 'vs_practice_change',
      review_last_act_entry_into_force_date: '2025-01-01',
    }).review_new_circumstances_missing,
    ['review_publication_date'],
  );
  // toggle включён — не хватает даты получения копии, а не публикации.
  assert.deepEqual(
    computeIndependentTerms({
      review_ground: 'vs_practice_change',
      review_discovered_during_cassation: true,
      review_publication_date: '2025-09-01', // не тот якорь при включённом toggle
      review_last_act_entry_into_force_date: '2025-01-01',
    }).review_new_circumstances_missing,
    ['review_refusal_ruling_received_date'],
  );
  // Узла при этом нет — как и у остальных незаполненных независимых узлов.
  assert.equal(
    computeIndependentTerms({ review_ground: 'vs_practice_change' }).review_new_circumstances_filing,
    null,
  );
  // У шести простых оснований missing всегда null — промежуточного состояния
  // «основание выбрано, но не хватает части полей» там не бывает.
  for (const groundId of SIMPLE_REVIEW_GROUND_IDS) {
    assert.equal(
      computeIndependentTerms({ review_ground: groundId }).review_new_circumstances_missing,
      null,
    );
  }
});

test('практика ВС: узел независим от цепочки обжалования и от категории дела', () => {
  const alone = computeIndependentTerms({
    review_ground: 'vs_practice_change',
    review_publication_date: '2025-09-01',
    review_last_act_entry_into_force_date: '2024-01-01',
  }).review_new_circumstances_filing;
  assert.ok(alone);

  const chain = computeChain(
    {
      ...BASE,
      review_ground: 'vs_practice_change',
      review_publication_date: '2025-09-01',
      review_last_act_entry_into_force_date: '2024-01-01',
    },
    { today: '2025-09-10' },
  );
  assert.equal(chain.review_new_circumstances_filing.deadline, alone.deadline);
  assert.equal(chain.review_new_circumstances_filing.controlling, alone.controlling);
});

// --- Восстановление пропущенного срока подачи заявления о пересмотре (ч. 2 ст. 394) ---

test('восстановление срока пересмотра: узла нет, если основной срок не посчитан', () => {
  assert.equal(computeIndependentTerms({}).review_new_circumstances_restoration, null);
  assert.equal(
    computeIndependentTerms({ review_ground: 'newly_discovered_fact' })
      .review_new_circumstances_restoration,
    null,
  );
});

test('восстановление срока пересмотра: шесть месяцев от того же якоря, что и основной срок (простое основание)', () => {
  const terms = computeIndependentTerms({
    review_ground: 'newly_discovered_fact',
    review_circumstance_date: '2025-09-01',
  });
  const restoration = terms.review_new_circumstances_restoration;
  assert.ok(restoration);
  // Якорь восстановления — тот же, что и у основного срока (не его дедлайн).
  assert.equal(restoration.anchor, terms.review_new_circumstances_filing.anchor);
  assert.equal(restoration.anchor, '2025-09-01');
  assert.deepEqual(restoration.duration, { value: 6, unit: 'month' });
  // 01.09.2025 + 6 мес. = 01.03.2026 (воскресенье) → 02.03.2026 (понедельник).
  assert.equal(restoration.raw_deadline, '2026-03-01');
  assert.equal(restoration.deadline, '2026-03-02');
  assert.equal(restoration.shifted, true);
  assert.equal(restoration.norm.primary, 'ч. 2 ст. 394 ГПК РФ');
});

test('восстановление срока пересмотра: одинаковый якорь для любого из шести простых оснований', () => {
  for (const groundId of SIMPLE_REVIEW_GROUND_IDS) {
    const terms = computeIndependentTerms({
      review_ground: groundId,
      review_circumstance_date: '2025-09-01',
    });
    const restoration = terms.review_new_circumstances_restoration;
    assert.ok(restoration, `основание ${groundId}: узел восстановления должен считаться`);
    assert.equal(restoration.anchor, '2025-09-01');
    assert.equal(restoration.deadline, '2026-03-02');
  }
});

test('восстановление срока пересмотра: практика ВС — якорь берётся от КОНТРОЛИРУЮЩЕГО компонента (трёхмесячный)', () => {
  // Тот же кейс, что и «обычный случай — трёхмесячный компонент раньше
  // потолка»: контролирует трёхмесячный компонент, его якорь — 2025-09-01
  // (дата публикации), а не якорь шестимесячного потолка (2025-08-01).
  const terms = computeIndependentTerms({
    review_ground: 'vs_practice_change',
    review_publication_date: '2025-09-01',
    review_last_act_entry_into_force_date: '2025-08-01',
  });
  const primary = terms.review_new_circumstances_filing;
  const restoration = terms.review_new_circumstances_restoration;
  assert.equal(primary.controlling, 'three_month');
  assert.ok(restoration);
  assert.equal(restoration.anchor, primary.anchor);
  assert.equal(restoration.anchor, '2025-09-01');
  assert.equal(restoration.deadline, '2026-03-02');
});

test('восстановление срока пересмотра: практика ВС — якорь берётся от КОНТРОЛИРУЮЩЕГО компонента (шестимесячный потолок)', () => {
  // Тот же кейс, что и «шестимесячный потолок раньше»: контролирует потолок,
  // его якорь — 2025-01-01 (дата вступления в силу последнего акта), а не
  // якорь трёхмесячного компонента (2025-09-01, дата публикации).
  const terms = computeIndependentTerms({
    review_ground: 'vs_practice_change',
    review_publication_date: '2025-09-01',
    review_last_act_entry_into_force_date: '2025-01-01',
  });
  const primary = terms.review_new_circumstances_filing;
  const restoration = terms.review_new_circumstances_restoration;
  assert.equal(primary.controlling, 'six_month');
  assert.ok(restoration);
  assert.equal(restoration.anchor, primary.anchor);
  assert.equal(restoration.anchor, '2025-01-01');
  assert.equal(restoration.deadline, '2025-07-01');
});
