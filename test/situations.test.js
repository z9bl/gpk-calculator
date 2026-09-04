// Разбиение узлов по ситуациям (переключатель ветви в UI).
//
// Проверяем по списку узлов, которые реально выдаёт buildView, а не
// перечислением: иначе следующий добавленный узел молча окажется невидимым.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SITUATIONS,
  DEFAULT_SITUATION,
  situationById,
  allSituationNodes,
  allSituationFields,
} from '../src/situations.js';
import { buildView } from '../src/views.js';

// Данные, поднимающие все ветви разом.
const ALL_BRANCHES_INPUTS = {
  reasoned_decision_date: '2025-03-11',
  appeal_filed_date: '2025-04-05',
  appeal_ruling_date: '2025-06-02',
  appeal_ruling_reasoned_date: '2025-06-10',
  ksoyu_ruling_date: '2025-08-01',
  ksoyu_ruling_reasoned_date: '2025-08-05',
  protocol_signed_date: '2025-07-01',
  interim_ruling_date: '2025-07-02',
  simplified_resolution_date: '2025-07-03',
  simplified_reasoned_request_date: '2025-07-04',
  simplified_reasoned_date: '2025-07-10',
  default_judgment_service_date: '2025-07-05',
  default_judgment_refusal_date: '2025-08-10',
  vs_ruling_date: '2025-09-01',
  mirovoy_resolution_date: '2025-07-06',
  mirovoy_request_date: '2025-07-07',
  mirovoy_reasoned_date: '2025-07-15',
  mirovoy_appeal_ruling_date: '2025-08-15', // принятие → вступление в силу, ИЛ
  mirovoy_appeal_ruling_reasoned_date: '2025-08-20',
  court_order_issued_date: '2023-04-12',
  periodic_payment_period_end_date: '2023-04-12',
};

test('каждый узел из buildView попадает ровно в одну ситуацию', () => {
  const view = buildView(ALL_BRANCHES_INPUTS, { today: '2025-07-01' });
  const claimed = allSituationNodes();
  const claimedSet = new Set(claimed);

  const shown = [...view.cards, ...view.incomplete].map((n) => n.id);
  const orphans = [...new Set(shown)].filter((id) => !claimedSet.has(id));
  assert.deepEqual(orphans, [], 'узлы, не привязанные ни к одной ситуации');
});

test('узлы не дублируются между ситуациями', () => {
  const claimed = allSituationNodes();
  const seen = new Set();
  const duplicates = claimed.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  assert.deepEqual(duplicates, []);
});

test('поля ввода не дублируются между ситуациями', () => {
  const fields = allSituationFields();
  assert.equal(new Set(fields).size, fields.length);
});

test('в ситуациях нет узлов, которых модель не выдаёт', () => {
  // Обратная сторона первой проверки: разбиение не должно обрастать
  // несуществующими id, иначе оно перестаёт быть картой реальных узлов.
  const view = buildView(ALL_BRANCHES_INPUTS, { today: '2025-07-01' });
  const shown = new Set([...view.cards, ...view.incomplete].map((n) => n.id));
  const missing = allSituationNodes().filter((id) => !shown.has(id));
  assert.deepEqual(missing, [], 'узлы разбиения, которых нет в модели');
});

test('по умолчанию выбран общий порядок', () => {
  assert.equal(DEFAULT_SITUATION, 'general');
  assert.equal(situationById(DEFAULT_SITUATION).label, 'Решение суда в общем порядке');
  assert.equal(SITUATIONS[0].id, 'general');
  // Только у общей ветви поле даты решения статическое, в разметке страницы.
  assert.equal(SITUATIONS.filter((s) => s.primary_field).length, 1);
});

test('неизвестный id ситуации откатывается к общему порядку', () => {
  assert.equal(situationById('нет такой').id, 'general');
  assert.equal(situationById(undefined).id, 'general');
});

test('все семь ситуаций на месте и подписаны', () => {
  assert.deepEqual(
    SITUATIONS.map((s) => s.id),
    [
      'general',
      'mirovoy',
      'simplified',
      'default_judgment',
      'court_order',
      'periodic_payments',
      'separate',
    ],
  );
  for (const s of SITUATIONS) {
    assert.ok(s.label && s.label.length > 3, `${s.id}: нужна подпись`);
    assert.ok(s.nodes.length > 0, `${s.id}: ситуация без узлов`);
  }
});
