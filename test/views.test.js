// Тест сборки карточек (раздел 8, задача 4а SPEC.md).
// Проверяем: для каждого набора входных данных структура содержит ровно те
// узлы, которые должны быть видны, и не содержит лишних.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildView } from '../src/views.js';

const BASE = { reasoned_decision_date: '2025-03-11' }; // апелляция → 11.04.2025

const ids = (nodes) => nodes.map((n) => n.id);
const byId = (nodes, id) => nodes.find((n) => n.id === id);

test('заглушки всегда присутствуют (4 шт., с explanation и norm)', () => {
  const v = buildView(BASE, { today: '2025-05-01' });
  assert.equal(v.stubs.length, 4);
  for (const s of v.stubs) {
    assert.ok(s.explanation && s.norm && s.title);
  }
});

test('нет даты мотивированного решения → нет карточек, узел в incomplete', () => {
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
  assert.deepEqual(ids(v.cards), ['appeal_general', 'entry_into_force', 'cassation_ksoyu']);
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
  assert.deepEqual(ids(v.cards), ['appeal_general', 'entry_into_force', 'cassation_ksoyu']);
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
