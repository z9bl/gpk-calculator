// Разбиение узлов по ситуациям (переключатель ветви в UI).
//
// Проверяем по списку узлов, которые реально выдаёт buildView, а не
// перечислением: иначе следующий добавленный узел молча окажется невидимым.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SITUATIONS,
  DEFAULT_SITUATION,
  CHILD_CASE_CATEGORIES,
  childCaseCategoryById,
} from '../src/situations.js';
import {
  situationById,
  allSituationNodes,
  allSituationFields,
  checkSituationCoverage,
} from '../core/view/situations.js';
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
  adoption_reasoned_decision_date: '2025-07-02',
  arbitration_competence_ruling_received_date: '2025-07-08',
  settlement_approval_ruling_date: '2025-07-08',
  sudebny_prikaz_received_date: '2025-07-08',
  treteisky_osparivanie_entry_into_force_date: '2025-07-08',
  treteisky_ispollist_entry_into_force_date: '2025-07-08',
  foreign_judgment_entry_into_force_date: '2023-04-12',
  foreign_judgment_recognition_aware_date: '2025-07-08',
  arbitration_award_setaside_received_date: '2025-07-08',
  foreign_state_default_judgment_service_date: '2025-07-05',
  foreign_state_default_judgment_refusal_date: '2025-08-10',
  review_ground: 'newly_discovered_fact',
  review_circumstance_date: '2025-07-02',
  // исполнительное производство (ст. 21 ФЗ № 229-ФЗ): без выбора типа документа
  // якорь неизвестен и узла нет вовсе. periodic_payment_period_end_date выше —
  // якорь варианта 'periodic_payments' того же узла (прежняя отдельная ситуация
  // «Периодические платежи» поглощена этой)
  enforcement_document_type: 'court_decision',
  enforcement_decision_entry_into_force_date: '2023-04-12',
};

test('каждый узел из buildView попадает ровно в одну ситуацию', () => {
  // Сама проверка инварианта (нет ни пропущенных, ни задвоенных узлов) —
  // предметно-независимая функция core/view/situations.js; здесь только
  // ГПК-специфичная часть: получить реальный список узлов через buildView.
  const view = buildView(ALL_BRANCHES_INPUTS, { today: '2025-07-01' });
  const shown = [...view.cards, ...view.incomplete].map((n) => n.id);
  assert.doesNotThrow(() => checkSituationCoverage(shown, SITUATIONS));
});

test('узлы не дублируются между ситуациями', () => {
  const claimed = allSituationNodes(SITUATIONS);
  const seen = new Set();
  const duplicates = claimed.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  assert.deepEqual(duplicates, []);
});

test('поля ввода не дублируются между ситуациями', () => {
  const fields = allSituationFields(SITUATIONS);
  assert.equal(new Set(fields).size, fields.length);
});

test('в ситуациях нет узлов, которых модель не выдаёт', () => {
  // Обратная сторона первой проверки: разбиение не должно обрастать
  // несуществующими id, иначе оно перестаёт быть картой реальных узлов.
  const view = buildView(ALL_BRANCHES_INPUTS, { today: '2025-07-01' });
  const shown = new Set([...view.cards, ...view.incomplete].map((n) => n.id));
  const missing = allSituationNodes(SITUATIONS).filter((id) => !shown.has(id));
  assert.deepEqual(missing, [], 'узлы разбиения, которых нет в модели');
});

test('судебный приказ: в ситуации остался один узел — возражения должника', () => {
  // ЧТО ИЗМЕНИЛОСЬ. Тест назывался «оба узла ситуации учтены в разбиении»:
  // приказное производство держало два узла — возражения должника (ст. 128) и
  // предъявление приказа к исполнению (ч. 3 ст. 21 ФЗ № 229-ФЗ). Второй убран
  // вместе с узлами предъявления на хвостах остальных цепочек: тот же расчёт
  // от той же даты даёт вариант «судебный приказ» ситуации «Исполнительное
  // производство», и поле court_order_issued_date переехало туда (иначе оно
  // оказалось бы закреплено за двумя ситуациями сразу).
  const situation = SITUATIONS.find((s) => s.id === 'court_order');
  assert.deepEqual(situation.nodes, ['court_order_objection']);
  assert.deepEqual(situation.fields, ['court_order_copy_received_date']);

  // Своё поле открывает свой узел.
  const objectionOnly = buildView(
    { court_order_copy_received_date: '2025-07-02' },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    objectionOnly.cards.map((c) => c.id).filter((id) => situation.nodes.includes(id)),
    ['court_order_objection'],
  );

  // Дата выдачи приказа теперь принадлежит ситуации «Исполнительное
  // производство» и там же открывает узел — при выбранном типе документа.
  const enforcement = SITUATIONS.find((s) => s.id === 'enforcement');
  assert.ok(enforcement.fields.includes('court_order_issued_date'));
  assert.ok(!situation.fields.includes('court_order_issued_date'));
  const presentation = buildView(
    { enforcement_document_type: 'court_order', court_order_issued_date: '2023-04-12' },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    presentation.cards.map((c) => c.id),
    ['enforcement_document_presentation'],
  );
});

test('узлов предъявления не осталось ни в одной цепочке обжалования', () => {
  // Охранный тест на перегруппировку — тот же принцип, что у «прежних ситуаций
  // child_return и adoption больше нет» ниже. Узел предъявления был на хвосте
  // пяти цепочек (общая, мировой судья, упрощённое, заочное, заочное против
  // иностранного государства) и в приказном производстве; теперь расчёт живёт
  // ровно в одной ситуации — «Исполнительное производство». Если копия
  // вернётся в чью-нибудь цепочку, в модели снова окажется несколько расчётов
  // одной нормы, и ломается этот тест.
  const gone = [
    'enforcement_presentation',
    'mirovoy_enforcement_presentation',
    'simplified_enforcement_presentation',
    'default_judgment_enforcement_presentation',
    'foreign_state_default_judgment_enforcement_presentation',
    'court_order_presentation',
    'periodic_payments_presentation',
  ];
  for (const s of SITUATIONS) {
    for (const id of gone) {
      assert.ok(!s.nodes.includes(id), `${s.id}: узел ${id} должен был быть убран`);
    }
  }
  // Единственный оставшийся — и он в своей ситуации.
  const enforcement = SITUATIONS.find((s) => s.id === 'enforcement');
  assert.deepEqual(enforcement.nodes, ['enforcement_document_presentation']);

  // Узлы вступления в силу на месте: убирался хвост предъявления, а не они.
  const entryNodes = [
    ['general', 'entry_into_force'],
    ['mirovoy', 'mirovoy_entry_into_force'],
    ['simplified', 'simplified_entry_into_force'],
    ['default_judgment', 'default_judgment_entry_into_force'],
    ['default_judgment_foreign_state', 'foreign_state_default_judgment_entry_into_force'],
  ];
  for (const [situationId, nodeId] of entryNodes) {
    assert.ok(
      SITUATIONS.find((s) => s.id === situationId).nodes.includes(nodeId),
      `${situationId}: узел вступления в силу должен остаться`,
    );
  }
});

test('дела о детях: три узла двух категорий в одной ситуации', () => {
  // Прежде это были две ситуации — child_return («Возврат ребёнка / права
  // доступа») и adoption («Усыновление (удочерение) ребёнка»). Они объединены
  // в одну, child_cases, с dropdown'ом категории; расчёт узлов не менялся,
  // поэтому проверки «каждое поле открывает свой узел и только его» ниже — те
  // же, что были в двух прежних тестах, просто в одном месте.
  const situation = SITUATIONS.find((s) => s.id === 'child_cases');
  assert.deepEqual(situation.nodes, [
    'child_return_appeal',
    'child_return_private_complaint',
    'adoption_appeal',
  ]);
  assert.deepEqual(situation.fields, [
    'child_case_category',
    'child_return_reasoned_decision_date',
    'child_return_interim_ruling_date',
    'adoption_reasoned_decision_date',
  ]);
  // Своя ситуация, а не модификация общей ветви: primary_field не занимаем.
  assert.equal(situation.primary_field, undefined);

  // Категории покрывают все поля даты ситуации и не пересекаются между собой:
  // от этого зависит и то, что показывает dropdown, и то, что он очищает при
  // переключении (renderChildCaseFields в web/app.js).
  assert.deepEqual(
    CHILD_CASE_CATEGORIES.map((c) => c.id),
    ['child_return', 'adoption'],
  );
  const categoryFields = CHILD_CASE_CATEGORIES.flatMap((c) => c.fields);
  assert.equal(new Set(categoryFields).size, categoryFields.length);
  assert.deepEqual(
    [...categoryFields].sort(),
    situation.fields.filter((f) => f !== 'child_case_category').sort(),
  );
  assert.equal(childCaseCategoryById('adoption').fields.length, 1);
  assert.equal(childCaseCategoryById('нет такой'), null);
  assert.equal(childCaseCategoryById(''), null);

  // Каждое поле открывает свой узел и только его — узлы независимы, и выбор
  // категории на расчёт не влияет вовсе (это поле интерфейса, а не модели).
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
  const adoptionOnly = buildView(
    { adoption_reasoned_decision_date: '2025-07-02' },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    adoptionOnly.cards.map((c) => c.id).filter((id) => situation.nodes.includes(id)),
    ['adoption_appeal'],
  );

  // Узлы специальных категорий не должны просачиваться в другие ветви: сроки
  // здесь короче общего порядка, и общий узел дал бы неверный результат.
  for (const s of SITUATIONS.filter((x) => x.id !== 'child_cases')) {
    for (const id of situation.nodes) {
      assert.ok(!s.nodes.includes(id), `${s.id}: узел ${id} не отсюда`);
    }
    for (const f of situation.fields) {
      assert.ok(!s.fields.includes(f), `${s.id}: поле ${f} не отсюда`);
    }
  }
});

test('прежних ситуаций child_return и adoption больше нет', () => {
  // Охранный тест на перегруппировку: обе поглощены ситуацией child_cases, и
  // вернуться поодиночке не должны — иначе узел окажется закреплён за двумя
  // ситуациями сразу либо исчезнет с экрана.
  for (const id of ['child_return', 'adoption']) {
    assert.equal(
      SITUATIONS.find((s) => s.id === id),
      undefined,
      `ситуация ${id} поглощена child_cases`,
    );
  }
  for (const label of ['Возврат ребёнка / права доступа', 'Усыновление (удочерение) ребёнка']) {
    assert.ok(
      !SITUATIONS.some((s) => s.label === label),
      `«${label}» — больше не отдельный пункт переключателя`,
    );
  }
  assert.equal(
    situationById('child_cases', SITUATIONS).label,
    'Дела о детях (возврат ребёнка, усыновление)',
  );
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

test('утверждение мирового соглашения: узел в независимом пуле, а не в ветви категории', () => {
  const separate = SITUATIONS.find((s) => s.id === 'separate');
  assert.ok(
    separate.nodes.includes('settlement_approval_cassation_appeal'),
    'узел должен лежать в пуле отдельных сроков — рядом с возвратом кассационной жалобы',
  );
  assert.ok(separate.fields.includes('settlement_approval_ruling_date'));
  for (const s of SITUATIONS.filter((x) => x.id !== 'separate')) {
    assert.ok(
      !s.nodes.includes('settlement_approval_cassation_appeal'),
      `${s.id}: узел не привязан к категории дела`,
    );
    assert.ok(!s.fields.includes('settlement_approval_ruling_date'), `${s.id}: поле не отсюда`);
  }

  // Одной своей даты достаточно: узел появляется без данных любой ветви.
  const v = buildView({ settlement_approval_ruling_date: '2025-07-08' }, { today: '2025-07-01' });
  assert.deepEqual(
    v.cards.map((c) => c.id),
    ['settlement_approval_cassation_appeal'],
  );
});

test('судебный приказ (кассация): узел в независимом пуле, а не в ветви категории', () => {
  const separate = SITUATIONS.find((s) => s.id === 'separate');
  assert.ok(
    separate.nodes.includes('sudebny_prikaz_cassation'),
    'узел должен лежать в пуле отдельных сроков — рядом с утверждением мирового соглашения',
  );
  // Два взаимоисключающих поля даты (вариант a/b) — оба в этом же пуле.
  assert.ok(separate.fields.includes('sudebny_prikaz_received_date'));
  assert.ok(separate.fields.includes('sudebny_prikaz_postal_arrival_date'));
  for (const s of SITUATIONS.filter((x) => x.id !== 'separate')) {
    assert.ok(
      !s.nodes.includes('sudebny_prikaz_cassation'),
      `${s.id}: узел не привязан к категории дела`,
    );
    assert.ok(!s.fields.includes('sudebny_prikaz_received_date'), `${s.id}: поле не отсюда`);
    assert.ok(
      !s.fields.includes('sudebny_prikaz_postal_arrival_date'),
      `${s.id}: поле не отсюда`,
    );
  }

  // Вариант (a) — прямая дата получения — одной этой даты достаточно.
  const viaReceived = buildView(
    { sudebny_prikaz_received_date: '2025-07-08' },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    viaReceived.cards.map((c) => c.id),
    ['sudebny_prikaz_cassation'],
  );

  // Вариант (b) — только дата прибытия на почту — узел появляется и от неё.
  const viaPostal = buildView(
    { sudebny_prikaz_postal_arrival_date: '2025-07-04' },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    viaPostal.cards.map((c) => c.id),
    ['sudebny_prikaz_cassation'],
  );
});

test('третейский суд: все четыре узла в своей ситуации, а не в пуле отдельных сроков', () => {
  // Прежде все четыре лежали в пуле «Отдельные сроки»; это перегруппировка —
  // нормы, якоря и поля узлов не менялись, менялось только то, на экране какой
  // ситуации они показаны. Порядок — процессуальный: компетенция (ч. 2
  // ст. 422.1) → отмена решения (ст. 418) → кассация по оспариванию (ч. 5
  // ст. 422) → кассация по выдаче исполнительного листа (ч. 5 ст. 427).
  const situation = SITUATIONS.find((s) => s.id === 'arbitration');
  assert.equal(situation.label, 'Третейский суд');
  assert.deepEqual(situation.nodes, [
    'arbitration_competence_appeal',
    'arbitration_award_setaside',
    'treteisky_osparivanie_cassation',
    'treteisky_ispollist_cassation',
  ]);
  assert.deepEqual(situation.fields, [
    'arbitration_competence_ruling_received_date',
    'arbitration_award_setaside_received_date',
    'arbitration_award_setaside_aware_date',
    'treteisky_osparivanie_entry_into_force_date',
    'treteisky_osparivanie_cassation_restoration_circumstance_date',
    'treteisky_ispollist_entry_into_force_date',
    'treteisky_ispollist_cassation_restoration_circumstance_date',
  ]);
  // Свой трек, а не модификация общей ветви: primary_field не занимаем.
  assert.equal(situation.primary_field, undefined);

  // Ни узлов, ни полей не должно остаться ни в «Отдельных сроках», ни где-то
  // ещё: узел, закреплённый за двумя ситуациями сразу, ломает разбиение.
  for (const s of SITUATIONS.filter((x) => x.id !== 'arbitration')) {
    for (const id of situation.nodes) {
      assert.ok(!s.nodes.includes(id), `${s.id}: узел ${id} не отсюда`);
    }
    for (const f of situation.fields) {
      assert.ok(!s.fields.includes(f), `${s.id}: поле ${f} не отсюда`);
    }
  }

  // Каждому узлу достаточно своей даты — узлы независимы и появляются поодиночке,
  // без данных любой ветви. Это и причина, по которой у ситуации нет dropdown'а:
  // по одному делу их может понадобиться несколько сразу.
  const cases = [
    [{ arbitration_competence_ruling_received_date: '2025-07-08' }, 'arbitration_competence_appeal'],
    [{ arbitration_award_setaside_received_date: '2025-07-08' }, 'arbitration_award_setaside'],
    [
      { treteisky_osparivanie_entry_into_force_date: '2025-07-08' },
      'treteisky_osparivanie_cassation',
    ],
    [{ treteisky_ispollist_entry_into_force_date: '2025-07-08' }, 'treteisky_ispollist_cassation'],
  ];
  for (const [inputs, nodeId] of cases) {
    const v = buildView(inputs, { today: '2025-07-01' });
    assert.deepEqual(
      v.cards.map((c) => c.id),
      [nodeId],
      `${nodeId}: одной своей даты должно быть достаточно`,
    );
  }

  // Вариант (b) узла отмены решения — лицо, не являющееся стороной (ч. 3
  // ст. 418): второе взаимоисключающее поле, оно тоже здесь.
  const nonParty = buildView(
    { arbitration_award_setaside_aware_date: '2025-07-08' },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    nonParty.cards.map((c) => c.id),
    ['arbitration_award_setaside'],
  );
});

test('признание и исполнение решений иностранных судов: оба узла главы 45 в своей ситуации', () => {
  // Прежде оба лежали в пуле «Отдельные сроки»; это перегруппировка — нормы,
  // якоря и поля узлов не менялись, менялось только то, на экране какой
  // ситуации они показаны. Порядок — порядок самой главы 45: сначала решения,
  // требующие принудительного исполнения (ст. 409–412), затем признание
  // решений, которые его не требуют (ст. 413–415).
  const situation = SITUATIONS.find((s) => s.id === 'foreign_judgment');
  assert.equal(situation.label, 'Признание и исполнение решений иностранных судов');
  assert.deepEqual(situation.nodes, [
    'foreign_judgment_enforcement_presentation',
    'foreign_judgment_recognition_objection',
  ]);
  assert.deepEqual(situation.fields, [
    'foreign_judgment_entry_into_force_date',
    'foreign_judgment_recognition_aware_date',
  ]);
  // Свой трек, а не модификация общей ветви: primary_field не занимаем.
  assert.equal(situation.primary_field, undefined);

  // Ни узлов, ни полей не должно остаться ни в «Отдельных сроках», ни где-то
  // ещё: узел, закреплённый за двумя ситуациями сразу, ломает разбиение.
  for (const s of SITUATIONS.filter((x) => x.id !== 'foreign_judgment')) {
    for (const id of situation.nodes) {
      assert.ok(!s.nodes.includes(id), `${s.id}: узел ${id} не отсюда`);
    }
    for (const f of situation.fields) {
      assert.ok(!s.fields.includes(f), `${s.id}: поле ${f} не отсюда`);
    }
  }

  // Каждое поле открывает свой узел и только его — узлы независимы и
  // появляются поодиночке. Это и причина, по которой у ситуации нет
  // dropdown'а: по делу может понадобиться и то и другое.
  const enforcementOnly = buildView(
    { foreign_judgment_entry_into_force_date: '2023-04-12' },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    enforcementOnly.cards.map((c) => c.id),
    ['foreign_judgment_enforcement_presentation'],
  );
  const objectionOnly = buildView(
    { foreign_judgment_recognition_aware_date: '2025-07-08' },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    objectionOnly.cards.map((c) => c.id),
    ['foreign_judgment_recognition_objection'],
  );
});

test('отдельные сроки: пул сократился, но не опустел', () => {
  // Что осталось в пуле после выделения «Третейского суда» и «Признания и
  // исполнения решений иностранных судов»: протокол и его рассмотрение,
  // частная жалоба, возврат кассационной жалобы, мировое соглашение и
  // кассация на судебный приказ.
  const separate = SITUATIONS.find((s) => s.id === 'separate');
  assert.deepEqual(separate.nodes, [
    'protocol_remarks',
    'protocol_remarks_review',
    'private_complaint',
    'cassation_return_ruling_appeal',
    'settlement_approval_cassation_appeal',
    'sudebny_prikaz_cassation',
  ]);
  assert.ok(separate.fields.length > 0, 'ситуация без полей ввода нерисуема');
  // Подпись пула перечисляет именно оставшиеся пункты.
  assert.equal(
    separate.label,
    'Отдельные сроки (протокол, частная жалоба, возврат кассационной жалобы)',
  );
});

test('заочное решение против иностранного государства: своя ситуация, узлы появляются по дате вручения', () => {
  const situation = SITUATIONS.find((s) => s.id === 'default_judgment_foreign_state');
  assert.deepEqual(situation.fields, ['foreign_state_default_judgment_service_date']);
  // Узла предъявления ИЛ в списке больше нет — он убран с хвоста всех цепочек
  // (см. тест «узлов предъявления не осталось ни в одной цепочке обжалования»);
  // вступление в силу по ч. 1 ст. 244 осталось на месте.
  assert.deepEqual(situation.nodes, [
    'foreign_state_default_judgment_cancellation_request',
    'foreign_state_default_judgment_appeal',
    'foreign_state_default_judgment_entry_into_force',
    'foreign_state_default_judgment_cassation_ksoyu',
  ]);
  // Своя ситуация, а не модификация default_judgment: primary_field не занимаем.
  assert.equal(situation.primary_field, undefined);

  const v = buildView(
    { foreign_state_default_judgment_service_date: '2025-12-22' },
    { today: '2026-01-01' },
  );
  assert.ok(
    v.cards.map((c) => c.id).includes('foreign_state_default_judgment_cancellation_request'),
  );

  // Узлы этой ситуации не должны просачиваться в default_judgment и обратно.
  for (const s of SITUATIONS.filter((x) => x.id !== 'default_judgment_foreign_state')) {
    for (const id of situation.nodes) {
      assert.ok(!s.nodes.includes(id), `${s.id}: узел ${id} не отсюда`);
    }
  }
});

test('по умолчанию выбран общий порядок', () => {
  assert.equal(DEFAULT_SITUATION, 'general');
  assert.equal(situationById(DEFAULT_SITUATION, SITUATIONS).label, 'Решение суда в общем порядке');
  assert.equal(SITUATIONS[0].id, 'general');
  // Только у общей ветви поле даты решения статическое, в разметке страницы.
  assert.equal(SITUATIONS.filter((s) => s.primary_field).length, 1);
});

test('неизвестный id ситуации откатывается к общему порядку', () => {
  assert.equal(situationById('нет такой', SITUATIONS).id, 'general');
  assert.equal(situationById(undefined, SITUATIONS).id, 'general');
});

test('все двенадцать ситуаций на месте и подписаны', () => {
  assert.deepEqual(
    SITUATIONS.map((s) => s.id),
    [
      'general',
      'mirovoy',
      'simplified',
      'default_judgment',
      'default_judgment_foreign_state',
      'court_order',
      'enforcement',
      'child_cases',
      'separate',
      'arbitration',
      'foreign_judgment',
      'review_new_circumstances',
    ],
  );
  for (const s of SITUATIONS) {
    assert.ok(s.label && s.label.length > 3, `${s.id}: нужна подпись`);
    assert.ok(s.nodes.length > 0, `${s.id}: ситуация без узлов`);
  }
});

test('состав переключателя после перегруппировки: дела о детях, третейский суд, иностранные суды', () => {
  // Структурный тест на все три перегруппировки разом — то, что видит
  // пользователь в списке ситуаций наверху формы.
  const labels = SITUATIONS.map((s) => s.label);

  // 1. Двух прежних пунктов в списке нет — они слились в один.
  assert.ok(!labels.includes('Возврат ребёнка / права доступа'));
  assert.ok(!labels.includes('Усыновление (удочерение) ребёнка'));
  assert.ok(labels.includes('Дела о детях (возврат ребёнка, усыновление)'));

  // 2. Третейский суд и глава 45 выделены каждый в свой пункт.
  assert.ok(labels.includes('Третейский суд'));
  assert.ok(labels.includes('Признание и исполнение решений иностранных судов'));

  // 3. «Отдельные сроки» сократились, но не опустели: из двенадцати узлов
  //    четыре уехали в «Третейский суд» и два — в главу 45, шесть остались.
  const separate = SITUATIONS.find((s) => s.id === 'separate');
  assert.equal(separate.nodes.length, 6);
  const arbitration = SITUATIONS.find((s) => s.id === 'arbitration');
  assert.equal(arbitration.nodes.length, 4);
  const foreign = SITUATIONS.find((s) => s.id === 'foreign_judgment');
  assert.equal(foreign.nodes.length, 2);
  for (const id of [...arbitration.nodes, ...foreign.nodes]) {
    assert.ok(!separate.nodes.includes(id), `${id}: остался в пуле отдельных сроков`);
  }

  // 4. Три «иностранные» ситуации — разные и непересекающиеся: глава 45
  //    (решение вынес иностранный суд), глава 45.1 (решение вынес российский
  //    суд против иностранного государства) и третейское разбирательство.
  const foreignState = SITUATIONS.find((s) => s.id === 'default_judgment_foreign_state');
  const triples = [foreign, foreignState, arbitration];
  for (const a of triples) {
    for (const b of triples) {
      if (a === b) continue;
      for (const id of a.nodes) assert.ok(!b.nodes.includes(id), `${b.id}: узел ${id} не отсюда`);
      for (const f of a.fields) assert.ok(!b.fields.includes(f), `${b.id}: поле ${f} не отсюда`);
    }
  }

  // Ни одна ситуация не осталась без узлов или без подписи.
  for (const s of SITUATIONS) {
    assert.ok(s.nodes.length > 0, `${s.id}: ситуация без узлов`);
    assert.ok(s.label && s.label.length > 3, `${s.id}: нужна подпись`);
  }
});

test('пересмотр по вновь открывшимся/новым обстоятельствам: узел и поля учтены в разбиении', () => {
  const situation = SITUATIONS.find((s) => s.id === 'review_new_circumstances');
  assert.deepEqual(situation.nodes, [
    'review_new_circumstances_filing',
    'review_new_circumstances_restoration',
  ]);
  assert.deepEqual(situation.fields, [
    'review_ground',
    'review_circumstance_date',
    'review_discovered_during_cassation',
    'review_publication_date',
    'review_refusal_ruling_received_date',
    'review_last_act_entry_into_force_date',
  ]);
  // Своя ситуация, а не модификация общей ветви: primary_field не занимаем.
  assert.equal(situation.primary_field, undefined);

  // Ни основания, ни узла без него — карточки нет.
  const withoutGround = buildView(
    { review_circumstance_date: '2025-07-02' },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    withoutGround.cards.map((c) => c.id).filter((id) => situation.nodes.includes(id)),
    [],
  );

  const withGround = buildView(
    { review_ground: 'newly_discovered_fact', review_circumstance_date: '2025-07-02' },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    withGround.cards.map((c) => c.id).filter((id) => situation.nodes.includes(id)),
    ['review_new_circumstances_filing', 'review_new_circumstances_restoration'],
  );
});

test('практика ВС (седьмое основание): та же ситуация, тот же узел, свои поля', () => {
  const situation = SITUATIONS.find((s) => s.id === 'review_new_circumstances');

  // Обычная (неоткрытая при кассации) ветвь.
  const v = buildView(
    {
      review_ground: 'vs_practice_change',
      review_publication_date: '2025-09-01',
      review_last_act_entry_into_force_date: '2024-01-01',
    },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    v.cards.map((c) => c.id).filter((id) => situation.nodes.includes(id)),
    ['review_new_circumstances_filing', 'review_new_circumstances_restoration'],
  );

  // Не хватает потолка — карточки нет, но и в orphan-узлы не проваливается
  // (missing-механизм — отдельная задача UI, не структурного теста).
  const incomplete = buildView(
    { review_ground: 'vs_practice_change', review_publication_date: '2025-09-01' },
    { today: '2025-07-01' },
  );
  assert.deepEqual(
    incomplete.cards.map((c) => c.id).filter((id) => situation.nodes.includes(id)),
    [],
  );
});

test('восстановление срока пересмотра (ч. 2 ст. 394): появляется в buildView для любого из семи оснований, без новых полей ввода', () => {
  const situation = SITUATIONS.find((s) => s.id === 'review_new_circumstances');
  // Никаких новых input не добавлено — тот же набор fields, что и раньше.
  assert.deepEqual(situation.fields, [
    'review_ground',
    'review_circumstance_date',
    'review_discovered_during_cassation',
    'review_publication_date',
    'review_refusal_ruling_received_date',
    'review_last_act_entry_into_force_date',
  ]);

  const SIMPLE_GROUNDS = [
    'newly_discovered_fact',
    'false_testimony_or_crime',
    'annulled_underlying_act',
    'transaction_invalidated',
    'ks_ruling',
    'unauthorized_construction',
  ];
  for (const groundId of SIMPLE_GROUNDS) {
    const v = buildView(
      { review_ground: groundId, review_circumstance_date: '2025-07-02' },
      { today: '2025-07-01' },
    );
    assert.ok(
      v.cards.some((c) => c.id === 'review_new_circumstances_restoration'),
      `основание ${groundId}: должен быть узел восстановления срока`,
    );
  }

  const vsPractice = buildView(
    {
      review_ground: 'vs_practice_change',
      review_publication_date: '2025-09-01',
      review_last_act_entry_into_force_date: '2024-01-01',
    },
    { today: '2025-07-01' },
  );
  assert.ok(vsPractice.cards.some((c) => c.id === 'review_new_circumstances_restoration'));
});
