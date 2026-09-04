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
  cassation_return_ruling_date: '2025-07-08',
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
  court_order_copy_received_date: '2025-07-02',
  court_order_issued_date: '2023-04-12',
  periodic_payment_period_end_date: '2023-04-12',
  child_return_reasoned_decision_date: '2025-07-02',
  child_return_interim_ruling_date: '2025-07-08',
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

test('судебный приказ: оба узла ситуации учтены в разбиении', () => {
  const situation = SITUATIONS.find((s) => s.id === 'court_order');
  assert.deepEqual(situation.nodes, ['court_order_objection', 'court_order_presentation']);
  assert.deepEqual(situation.fields, [
    'court_order_copy_received_date',
    'court_order_issued_date',
  ]);

  // Каждое поле открывает свой узел и только его — узлы независимы.
  const objectionOnly = buildView(
    { court_order_copy_received_date: '2025-07-02' },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    objectionOnly.cards.map((c) => c.id).filter((id) => situation.nodes.includes(id)),
    ['court_order_objection'],
  );
  const presentationOnly = buildView(
    { court_order_issued_date: '2023-04-12' },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    presentationOnly.cards.map((c) => c.id).filter((id) => situation.nodes.includes(id)),
    ['court_order_presentation'],
  );
});

test('возвращение ребёнка: оба узла ситуации учтены в разбиении', () => {
  const situation = SITUATIONS.find((s) => s.id === 'child_return');
  assert.deepEqual(situation.nodes, ['child_return_appeal', 'child_return_private_complaint']);
  assert.deepEqual(situation.fields, [
    'child_return_reasoned_decision_date',
    'child_return_interim_ruling_date',
  ]);
  // Своя ситуация, а не модификация общей ветви: primary_field не занимаем.
  assert.equal(situation.primary_field, undefined);

  // Каждое поле открывает свой узел и только его — узлы независимы.
  const appealOnly = buildView(
    { child_return_reasoned_decision_date: '2025-07-02' },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    appealOnly.cards.map((c) => c.id).filter((id) => situation.nodes.includes(id)),
    ['child_return_appeal'],
  );
  const privateOnly = buildView(
    { child_return_interim_ruling_date: '2025-07-08' },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    privateOnly.cards.map((c) => c.id).filter((id) => situation.nodes.includes(id)),
    ['child_return_private_complaint'],
  );

  // Узлы главы 22.2 не должны просачиваться в другие ветви: сроки специальные.
  for (const s of SITUATIONS.filter((x) => x.id !== 'child_return')) {
    for (const id of situation.nodes) {
      assert.ok(!s.nodes.includes(id), `${s.id}: узел ${id} не отсюда`);
    }
    for (const f of situation.fields) {
      assert.ok(!s.fields.includes(f), `${s.id}: поле ${f} не отсюда`);
    }
  }
});

test('возврат кассационной жалобы: узел в независимом пуле, а не в ветви категории', () => {
  const separate = SITUATIONS.find((s) => s.id === 'separate');
  assert.ok(
    separate.nodes.includes('cassation_return_ruling_appeal'),
    'узел должен лежать в пуле отдельных сроков — рядом с частной жалобой',
  );
  assert.ok(separate.fields.includes('cassation_return_ruling_date'));
  // Ни в одной ветви конкретной категории дела узла быть не должно.
  for (const s of SITUATIONS.filter((x) => x.id !== 'separate')) {
    assert.ok(
      !s.nodes.includes('cassation_return_ruling_appeal'),
      `${s.id}: узел не привязан к категории дела`,
    );
    assert.ok(!s.fields.includes('cassation_return_ruling_date'), `${s.id}: поле не отсюда`);
  }

  // Одной своей даты достаточно: узел появляется без данных любой ветви.
  const v = buildView({ cassation_return_ruling_date: '2025-07-08' }, { today: '2025-07-01' });
  assert.deepEqual(
    v.cards.map((c) => c.id),
    ['cassation_return_ruling_appeal'],
  );
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

test('все восемь ситуаций на месте и подписаны', () => {
  assert.deepEqual(
    SITUATIONS.map((s) => s.id),
    [
      'general',
      'mirovoy',
      'simplified',
      'default_judgment',
      'court_order',
      'periodic_payments',
      'child_return',
      'separate',
    ],
  );
  for (const s of SITUATIONS) {
    assert.ok(s.label && s.label.length > 3, `${s.id}: нужна подпись`);
    assert.ok(s.nodes.length > 0, `${s.id}: ситуация без узлов`);
  }
});
