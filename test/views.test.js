// Тест сборки карточек (раздел 8, задача 4а SPEC.md).
// Проверяем: для каждого набора входных данных структура содержит ровно те
// узлы, которые должны быть видны, и не содержит лишних.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildView } from '../src/views.js';

const BASE = { reasoned_decision_date: '2025-03-11' }; // апелляция → 11.04.2025

const ids = (nodes) => nodes.map((n) => n.id);
const byId = (nodes, id) => nodes.find((n) => n.id === id);

test('заглушки всегда присутствуют (2 шт., с explanation и norm)', () => {
  // Раскрытые заглушки: частная жалоба (ст. 332) и упрощённое производство
  // (глава 21.1) реализованы как узлы, поэтому заглушек осталось две —
  // заочное решение и мировой судья без мотивированного решения.
  const v = buildView(BASE, { today: '2025-05-01' });
  assert.equal(v.stubs.length, 2);
  assert.deepEqual(ids(v.stubs), ['default_judgment', 'justice_of_peace_no_reasoning']);
  for (const s of v.stubs) {
    assert.ok(s.explanation && s.norm && s.title);
  }
});

test('нет даты мотивированного решения → нет карточек цепочки, узел в incomplete', () => {
  const v = buildView({}, { today: '2025-05-01' });
  assert.deepEqual(ids(v.cards), []);
  assert.deepEqual(ids(v.incomplete), ['appeal_general']);
  assert.deepEqual(
    v.incomplete[0].missing_inputs.map((m) => m.id),
    ['reasoned_decision_date'],
  );
});

test('pending: видны апелляция и событие; кассация — в incomplete', () => {
  const v = buildView(BASE, { today: '2025-04-01' }); // до дедлайна апелляции
  assert.deepEqual(ids(v.cards), ['appeal_general', 'entry_into_force']);
  assert.deepEqual(ids(v.incomplete), ['cassation_ksoyu']);

  const entry = byId(v.cards, 'entry_into_force');
  assert.equal(entry.status, 'pending');
  assert.equal(entry.date, null);
  assert.match(entry.message, /не ранее 2025-04-12/);

  const appeal = byId(v.cards, 'appeal_general');
  assert.equal(appeal.status, 'computed');
  assert.equal(appeal.deadline, '2025-04-11');
  assert.equal(appeal.details.collapsed, true); // «подробнее» свёрнут
  assert.ok(appeal.details.logic && appeal.details.midnight_rule);
});

test('not_appealed: видны все три узла, incomplete пуст', () => {
  const v = buildView(BASE, { today: '2025-05-01' }); // после дедлайна
  assert.deepEqual(ids(v.cards), [
    'appeal_general',
    'entry_into_force',
    'cassation_ksoyu',
    'enforcement_presentation',
  ]);
  assert.deepEqual(ids(v.incomplete), []);

  const entry = byId(v.cards, 'entry_into_force');
  assert.equal(entry.status, 'resolved');
  assert.equal(entry.date, '2025-04-12');

  const cass = byId(v.cards, 'cassation_ksoyu');
  assert.equal(cass.status, 'computed');
  assert.equal(cass.alternative, undefined);
});

test('appealed (полные данные): три узла, без alternative', () => {
  const v = buildView(
    {
      ...BASE,
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      appeal_ruling_reasoned_date: '2025-06-02',
    },
    { today: '2025-07-01' },
  );
  assert.deepEqual(ids(v.cards), [
    'appeal_general',
    'entry_into_force',
    'cassation_ksoyu',
    'enforcement_presentation',
  ]);
  assert.deepEqual(ids(v.incomplete), []);
  const cass = byId(v.cards, 'cassation_ksoyu');
  assert.equal(cass.deadline, '2025-09-02');
  assert.equal(cass.alternative, undefined);
});

test('appealed с расхождением дат: появляется alternative', () => {
  const v = buildView(
    {
      ...BASE,
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      appeal_ruling_reasoned_date: '2025-06-10',
    },
    { today: '2025-07-01' },
  );
  const cass = byId(v.cards, 'cassation_ksoyu');
  assert.ok(cass.alternative);
  assert.equal(cass.deadline, '2025-09-10');
  assert.equal(cass.alternative.recommended_deadline, '2025-09-02');
});

test('прежняя редакция: карточка кассации считается по дате принятия, без reasoned', () => {
  // Подача до 01.09.2024 → редакция от вступления в силу; мотивированное
  // определение не требуется, карточка рассчитывается, alternative нет.
  const v = buildView(
    {
      ...BASE,
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      cassation_filed_date: '2024-08-31',
    },
    { today: '2025-07-01' },
  );
  assert.deepEqual(ids(v.cards), [
    'appeal_general',
    'entry_into_force',
    'cassation_ksoyu',
    'enforcement_presentation',
  ]);
  assert.deepEqual(ids(v.incomplete), []);
  const cass = byId(v.cards, 'cassation_ksoyu');
  assert.equal(cass.version_id, 'before_135fz');
  assert.match(cass.norm, /до ФЗ № 135-ФЗ/);
  assert.equal(cass.alternative, undefined);
});

test('пограничное окно: карточка кассации несёт boundary_warning с обеими датами', () => {
  const v = buildView(
    {
      reasoned_decision_date: '2024-03-01',
      appeal_filed_date: '2024-03-20',
      appeal_ruling_date: '2024-05-15',
      appeal_ruling_reasoned_date: '2024-06-20',
      cassation_filed_date: '2024-09-15',
    },
    { today: '2024-10-01' },
  );
  const cass = byId(v.cards, 'cassation_ksoyu');
  assert.ok(cass.boundary_warning);
  assert.equal(cass.boundary_warning.prev_redaction_deadline, '2024-08-15');
  assert.equal(cass.boundary_warning.current_deadline, '2024-09-20');
  assert.equal(cass.deadline, '2024-09-20'); // расчёт — по действующей редакции
});

test('ИЛ: узел появляется при resolved, несёт заглушки; в pending — отсутствует', () => {
  const resolved = buildView(BASE, { today: '2025-05-01' }); // not_appealed → resolved
  const il = byId(resolved.cards, 'enforcement_presentation');
  assert.ok(il, 'узел ИЛ есть, когда вступление в силу разрешено');
  assert.match(il.norm, /229-ФЗ/);
  assert.equal(il.stubs.length, 3); // судебный приказ, периодические платежи, перерыв
  assert.deepEqual(
    il.stubs.map((s) => s.id),
    ['court_order', 'periodic_payments', 'interruption'],
  );

  const pending = buildView(BASE, { today: '2025-04-01' }); // pending
  const allIds = [...pending.cards, ...pending.incomplete].map((n) => n.id);
  assert.ok(!allIds.includes('enforcement_presentation'), 'в pending узла ИЛ нет');
});

test('узел кассации в ВС появляется только после даты определения КСОЮ', () => {
  const withoutKsoyu = buildView(
    { ...BASE, appeal_filed_date: '2025-04-05', appeal_ruling_date: '2025-06-02', appeal_ruling_reasoned_date: '2025-06-02' },
    { today: '2025-07-01' },
  );
  const allIds = [...withoutKsoyu.cards, ...withoutKsoyu.incomplete].map((n) => n.id);
  assert.ok(!allIds.includes('cassation_vs'), 'без даты определения КСОЮ узла ВС нет');

  // Прежняя редакция (подача в ВС до 01.09.2024) → узел считается сразу от даты вынесения.
  const withKsoyu = buildView(
    {
      ...BASE,
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      appeal_ruling_reasoned_date: '2025-06-02',
      ksoyu_ruling_date: '2024-04-12',
      vs_cassation_filed_date: '2024-07-01',
    },
    { today: '2025-07-01' },
  );
  const vs = byId(withKsoyu.cards, 'cassation_vs');
  assert.ok(vs, 'с датой определения КСОЮ появляется карточка ВС');
  assert.equal(vs.version_id, 'before_135fz');
  assert.match(vs.norm, /390\.3/);
  assert.equal(vs.deadline, '2024-07-12');
});

test('узел ВС, новая редакция без мотивированного определения КСОЮ → incomplete', () => {
  const v = buildView(
    {
      ...BASE,
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      appeal_ruling_reasoned_date: '2025-06-02',
      ksoyu_ruling_date: '2025-05-01', // подача по умолчанию сегодня (2025) → новая редакция
    },
    { today: '2025-07-01' },
  );
  const vsInc = byId(v.incomplete, 'cassation_vs');
  assert.ok(vsInc);
  assert.deepEqual(vsInc.missing_inputs.map((m) => m.id), ['ksoyu_ruling_reasoned_date']);
});

test('новая редакция: норма — абз. 2 ч. 1 ст. 376.1', () => {
  const v = buildView(
    {
      ...BASE,
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      appeal_ruling_reasoned_date: '2025-06-02',
    },
    { today: '2025-07-01' },
  );
  const cass = byId(v.cards, 'cassation_ksoyu');
  assert.equal(cass.version_id, 'from_135fz');
  assert.match(cass.norm, /абз\. 2 ч\. 1 ст\. 376\.1/);
});

test('прежняя редакция без даты принятия: кассация incomplete без своего поля (поле — на событии)', () => {
  const v = buildView(
    { ...BASE, appeal_filed_date: '2025-04-05', cassation_filed_date: '2024-08-31' },
    { today: '2025-07-01' },
  );
  // событие ждёт дату принятия; кассация в прежней редакции зависит от неё же.
  assert.deepEqual(ids(v.incomplete), ['entry_into_force', 'cassation_ksoyu']);
  assert.deepEqual(
    byId(v.incomplete, 'entry_into_force').missing_inputs.map((m) => m.id),
    ['appeal_ruling_date'],
  );
  assert.deepEqual(byId(v.incomplete, 'cassation_ksoyu').missing_inputs, []);
});

test('appealed без дат определения: только апелляция; событие и кассация в incomplete', () => {
  const v = buildView({ ...BASE, appeal_filed_date: '2025-04-05' }, { today: '2025-07-01' });
  assert.deepEqual(ids(v.cards), ['appeal_general']);
  assert.deepEqual(ids(v.incomplete), ['entry_into_force', 'cassation_ksoyu']);
  assert.deepEqual(
    byId(v.incomplete, 'entry_into_force').missing_inputs.map((m) => m.id),
    ['appeal_ruling_date'],
  );
  assert.deepEqual(
    byId(v.incomplete, 'cassation_ksoyu').missing_inputs.map((m) => m.id),
    ['appeal_ruling_reasoned_date'],
  );
  // Оба недостающих поля должны быть доступны для ввода — каждое на своём узле,
  // без пустых missing_inputs (иначе поле не отрисуется в UI).
  for (const n of v.incomplete) {
    assert.ok(n.missing_inputs.length > 0, `${n.id}: должно быть недостающее поле`);
    for (const m of n.missing_inputs) assert.ok(m.label, `${m.id}: нужен label`);
  }
  const invited = v.incomplete.flatMap((n) => n.missing_inputs.map((m) => m.id));
  assert.deepEqual(invited.sort(), ['appeal_ruling_date', 'appeal_ruling_reasoned_date']);
});

test('appealed: введена только дата принятия определения → событие рассчитано, кассация ждёт мотивированного', () => {
  // Регрессия бага: раньше entry_into_force был incomplete с пустым
  // missing_inputs («данных недостаточно») и поле appeal_ruling_reasoned_date
  // висело только на кассации. Теперь дата принятия разрешает событие.
  const v = buildView(
    { ...BASE, appeal_filed_date: '2025-04-05', appeal_ruling_date: '2025-06-02' },
    { today: '2025-07-01' },
  );
  // Событие разрешено (есть дата принятия) → появляется и узел ИЛ.
  assert.deepEqual(ids(v.cards), ['appeal_general', 'entry_into_force', 'enforcement_presentation']);
  assert.deepEqual(ids(v.incomplete), ['cassation_ksoyu']);

  const entry = byId(v.cards, 'entry_into_force');
  assert.equal(entry.status, 'resolved');
  assert.equal(entry.date, '2025-06-02'); // дата принятия апелляционного определения

  // Кассация ждёт именно дату изготовления мотивированного определения,
  // и это непустое поле (а не «данных недостаточно»).
  const cass = byId(v.incomplete, 'cassation_ksoyu');
  assert.deepEqual(
    cass.missing_inputs.map((m) => m.id),
    ['appeal_ruling_reasoned_date'],
  );
});

test('просрочка: подача позже дедлайна → статус missed, дни, ст. 112', () => {
  const v = buildView({ ...BASE, appeal_filed_date: '2025-05-20' }, { today: '2025-07-01' });
  const appeal = byId(v.cards, 'appeal_general');
  assert.equal(appeal.status, 'missed');
  assert.equal(appeal.overdue.days, 39); // 11.04 → 20.05
  assert.match(appeal.overdue.norm, /112/);
});

test('предупреждение: мотивированное решение позже 10 дней (ч. 2 ст. 199)', () => {
  const v = buildView(
    { reasoned_decision_date: '2025-03-25', hearing_end_date: '2025-03-11' }, // 14 дней
    { today: '2025-05-01' },
  );
  const appeal = byId(v.cards, 'appeal_general');
  assert.ok(appeal.warnings && appeal.warnings.length === 1);
  assert.equal(appeal.warnings[0].code, 'reasoned_over_10_days');
});

test('в пределах 10 дней — предупреждения нет', () => {
  const v = buildView(
    { reasoned_decision_date: '2025-03-18', hearing_end_date: '2025-03-11' }, // 7 дней
    { today: '2025-05-01' },
  );
  assert.equal(byId(v.cards, 'appeal_general').warnings, undefined);
});

test('карточки сроков в рабочих днях: появляются по своему input, помечены unit', () => {
  const v = buildView(
    { ...BASE, protocol_signed_date: '2025-12-28', interim_ruling_date: '2025-12-26' },
    { today: '2026-02-01' },
  );
  const remarks = byId(v.cards, 'protocol_remarks');
  const review = byId(v.cards, 'protocol_remarks_review');
  const complaint = byId(v.cards, 'private_complaint');

  assert.ok(remarks && review && complaint);
  assert.equal(remarks.unit, 'working_day');
  assert.equal(remarks.deadline, '2026-01-14');
  assert.equal(remarks.first_working_day, '2025-12-29'); // виден первый день течения
  assert.equal(review.informational, true); // срок суда — справочно
  assert.equal(complaint.deadline, '2026-01-28');
  assert.match(complaint.norm, /ст\. 332/);
});

test('независимые сроки видны без даты мотивированного решения', () => {
  const v = buildView({ interim_ruling_date: '2025-12-26' }, { today: '2026-02-01' });
  assert.deepEqual(ids(v.cards), ['private_complaint']);
  // цепочка при этом честно помечена как нерассчитанная
  assert.deepEqual(ids(v.incomplete), ['appeal_general']);
});

test('упрощённое производство: три карточки без заявления, событие по ст. 232.4', () => {
  const v = buildView({ simplified_resolution_date: '2025-12-22' }, { today: '2026-03-01' });
  assert.deepEqual(ids(v.cards), [
    'simplified_reasoned_request',
    'simplified_appeal',
    'simplified_entry_into_force',
  ]);
  const appeal = byId(v.cards, 'simplified_appeal');
  assert.equal(appeal.unit, 'working_day');
  assert.equal(appeal.deadline, '2026-01-22');
  assert.match(appeal.note, /не составлялось/);

  const entry = byId(v.cards, 'simplified_entry_into_force');
  assert.equal(entry.kind, 'event');
  assert.equal(entry.status, 'resolved');
  assert.match(entry.norm, /232\.4/);
  assert.match(entry.norm, /ч\. 5/);
});

test('упрощённое: срок изготовления появляется после заявления, помечен справочным', () => {
  const v = buildView(
    { simplified_resolution_date: '2025-12-22', simplified_reasoned_request_date: '2025-12-24' },
    { today: '2026-03-01' },
  );
  const making = byId(v.cards, 'simplified_reasoned_making');
  assert.ok(making);
  assert.equal(making.informational, true);
  assert.equal(making.deadline, '2026-01-19');
});

test('упрощённое, ч. 7: событие не разрешено, показывает норму и чего не хватает', () => {
  const v = buildView(
    { simplified_resolution_date: '2025-12-22', simplified_appeal_filed_date: '2026-01-20' },
    { today: '2026-03-01' },
  );
  const entry = byId(v.cards, 'simplified_entry_into_force');
  assert.equal(entry.status, 'pending');
  assert.equal(entry.date, null);
  assert.match(entry.norm, /ч\. 7/);
  assert.match(entry.note, /не заложена/);
});
