// Тест цепочки обжалования (раздел 8, задача 3 SPEC.md).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeChain,
  computeIndependentTerms,
  computeSimplified,
  computeDefaultJudgment,
  computeMirovoy,
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

test('заочное: кассация в КСОЮ — обе точки отсчёта, предупреждение об исчерпании отложено', () => {
  // Не обжаловалось (refused_not_appealed): со дня вступления в силу.
  const notAppealed = computeDefaultJudgment(
    { ...DJ, default_judgment_refusal_date: '2026-02-10' },
    '2026-04-01',
  );
  assert.ok(notAppealed.cassation);
  assert.equal(notAppealed.cassation.id, 'default_judgment_cassation_ksoyu');
  assert.equal(notAppealed.cassation.anchor, notAppealed.entry_into_force.date);
  assert.match(notAppealed.cassation.norm.primary, /ст\. 376\.1/);
  // Отложено до сверки п. 3 ПП ВС № 17 по заочному (раздел 9).
  assert.equal(notAppealed.cassation.exhaustion_warning, undefined);

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
