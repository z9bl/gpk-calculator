// Ситуация «Исполнительное производство» (ст. 21 ФЗ № 229-ФЗ) — полный поток
// от входных данных до карточки: inputs → buildView.
//
// Тест намеренно интеграционный (см. CLAUDE.md о границах test/): проверяется
// не арифметика ядра (она покрыта test/core/deduction.test.js и
// test/chain.test.js на синтетических данных), а то, что от поля ввода до
// карточки доезжают норма выбранного типа документа и обе ветви ст. 22.
//
// ЧТО ИЗМЕНИЛОСЬ ВО ВСЁМ ФАЙЛЕ. Он был написан как СРАВНЕНИЕ двух входов к
// одному расчёту: новая ситуация против узла предъявления в существующей
// цепочке (общая цепочка и приказное производство). Сравнивать больше не с
// чем — узлы предъявления убраны со всех цепочек, и этот вход остался
// единственным; именно так и задумывалось, когда ситуация заводилась. Прежние
// сравнения переписаны в прямые проверки расчёта на ТЕХ ЖЕ данных и с теми же
// ожидаемыми датами, плюс охранная проверка, что прежние узлы не вернулись.
// То же самое раньше произошло с периодическими платежами — см. блок о них
// ниже, там подход описан подробнее.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildView } from '../../src/views.js';
import { ENFORCEMENT_DOCUMENT_TYPES } from '../../src/chain.js';

const NEW_NODE = 'enforcement_document_presentation';

// Те же ориентиры, что и у test/integration/enforcement-deduction.test.js:
// вступление решения в силу 15.04.2025, предъявление без событий — 17.04.2028.
const BASE = { resolution_date: '2025-03-11', reasoned_decision_date: '2025-03-12' };
const TODAY = { today: '2025-05-01' };
const ENTRY_INTO_FORCE = '2025-04-15';

// Дата выдачи приказа взыскателю (ст. 130 ГПК) — поле варианта «судебный
// приказ». Прежде оно принадлежало ситуации «Судебный приказ» и здесь лишь
// переиспользовалось; вместе с расчётом предъявления оно переехало сюда.
const ORDER_ISSUED = '2023-04-12';

const INTERRUPTION = { type: 'presentment', date: '2026-06-01' };
const RETURNED = { type: 'returned_no_assets', date: '2027-02-15' };
const PERIOD = { type: 'creditor_request', from: '2027-01-01', to: '2027-03-01' };

const cardOf = (inputs, id) => buildView({ ...BASE, ...inputs }, TODAY).cards.find((c) => c.id === id);

// --- Базовые ориентиры (страховка от молчаливого сдвига остальных тестов) ---

test('базовые ориентиры (страховка от молчаливого сдвига остальных тестов)', () => {
  assert.equal(
    cardOf(
      {
        enforcement_document_type: 'court_decision',
        enforcement_decision_entry_into_force_date: ENTRY_INTO_FORCE,
      },
      NEW_NODE,
    ).deadline,
    '2028-04-17',
  );
  assert.equal(
    cardOf(
      { enforcement_document_type: 'court_order', court_order_issued_date: ORDER_ISSUED },
      NEW_NODE,
    ).deadline,
    '2026-04-13',
  );
  // Прежних узлов предъявления на хвостах цепочек и в приказном производстве
  // не осталось — те же входные данные их больше не открывают.
  assert.equal(cardOf({}, 'enforcement_presentation'), undefined);
  assert.equal(cardOf({ court_order_issued_date: ORDER_ISSUED }, 'court_order_presentation'), undefined);
});

// --- Судебный приказ: обе ветви ст. 22 на карточке --------------------------
//
// Прежде каждый из трёх тестов ниже сравнивал результат через эту ситуацию с
// результатом через узел приказного производства. Второго входа нет — узел
// приказного производства убран, его поле (дата выдачи приказа взыскателю)
// переехало сюда. Проверяются те же события на тех же датах и те же
// ожидаемые результаты, только без второй стороны сравнения.

const ORDER = { enforcement_document_type: 'court_order', court_order_issued_date: ORDER_ISSUED };

test('судебный приказ: перерыв перезапускает срок от даты события (ч. 1–3 ст. 22)', () => {
  const card = cardOf({ ...ORDER, enforcement_interruptions: [INTERRUPTION] }, NEW_NODE);
  assert.equal(card.restarted_from, INTERRUPTION.date);
  assert.equal(card.base_anchor, ORDER_ISSUED);
  assert.equal(card.deadline, '2029-06-01');
});

test('судебный приказ: вычет уменьшает срок, не сдвигая точку отсчёта (ч. 3.1 ст. 22)', () => {
  const card = cardOf({ ...ORDER, enforcement_interruptions: [PERIOD] }, NEW_NODE);
  assert.equal(card.deducted_days, 59);
  assert.equal(card.deadline_before_deduction, '2026-04-13');
  assert.equal(card.restarted_from, undefined);
});

test('судебный приказ: перерыв и вычет вместе видны на одной карточке', () => {
  const card = cardOf(
    { ...ORDER, enforcement_interruptions: [INTERRUPTION, PERIOD, RETURNED] },
    NEW_NODE,
  );
  // Обе ветви ст. 22 видны: перерыв перезапустил срок от последнего события,
  // вычет уменьшил его.
  assert.equal(card.restarted_from, RETURNED.date);
  assert.equal(card.interruptions.length, 2);
  assert.equal(card.deductions.length, 1);
  assert.equal(card.deducted_days, 59);
});

// --- Вступившее в силу решение: та же механика от введённой даты ------------

test('вступившее в силу решение: перерыв и вычет считаются от введённой даты', () => {
  // Прежде этот тест сравнивал расчёт с узлом на хвосте общей цепочки, где
  // дата вступления в силу вычислялась, а здесь вводится. Цепочка узла больше
  // не даёт; проверяем сам расчёт на тех же событиях.
  const card = cardOf(
    {
      enforcement_document_type: 'court_decision',
      enforcement_decision_entry_into_force_date: ENTRY_INTO_FORCE,
      enforcement_interruptions: [INTERRUPTION, PERIOD],
    },
    NEW_NODE,
  );
  assert.match(card.norm, /ч\. 1 ст\. 21/);
  assert.equal(card.base_anchor, ENTRY_INTO_FORCE);
  assert.equal(card.restarted_from, INTERRUPTION.date);
  assert.equal(card.deadline_before_deduction, '2029-06-01');
  assert.equal(card.deducted_days, 59);
  assert.equal(card.deadline, '2029-04-03');
});

// --- Периодические платежи: перенесённая логика прежнего отдельного узла ----
//
// ЧТО ИЗМЕНИЛОСЬ В ЭТОМ БЛОКЕ. Раньше здесь стояло сравнение «через новую
// ситуацию» против «через отдельную ситуацию периодических платежей» — тот же
// приём, что для судебного приказа выше. Сравнивать больше не с чем: отдельный
// узел periodic_payments_presentation и его ситуация поглощены вариантом
// документа 'periodic_payments' этого узла, и второго расчёта той же нормы в
// модели не осталось. Это и было целью переноса, поэтому прежняя форма теста
// потеряла смысл не из-за упрощения проверок, а потому что исчезла вторая
// сторона сравнения.
//
// Взамен проверяется то, что раньше проверялось на отдельном узле, — что вся
// его логика действительно работает ВНУТРИ нового: якорь и норма ч. 4,
// оговорка «пока срок не окончен — в любой момент», чекбокс бессрочности с
// веткой not_applicable и приоритетом над датой, и неприменимость ст. 22.
// Доказательство того, что движок именно переиспользуется, а не скопирован,
// держится теперь не на сравнении двух входов (второго нет ни у одного типа
// документа), а на том, что все три типа проходят через один и тот же
// computeInterruptibleTerm/computeSimpleTerm — см. тесты ст. 22 по типам
// документа ниже и test/core/ на саму арифметику.

const PERIODIC = { enforcement_document_type: 'periodic_payments' };

test('периодические платежи: якорь, норма ч. 4 и оговорка — на карточке нового узла', () => {
  const card = cardOf({ ...PERIODIC, periodic_payment_period_end_date: ORDER_ISSUED }, NEW_NODE);
  assert.equal(card.status, 'computed');
  assert.equal(card.deadline, '2026-04-13'); // 12.04.2026 — воскресенье, перенос
  assert.match(card.norm, /ч\. 4 ст\. 21/);
  // Оговорка ч. 4: без неё пользователь читал бы дедлайн как единственную
  // возможность предъявить документ.
  assert.match(card.details.logic, /в любой момент/);
});

test('периодические платежи: бессрочное взыскание — not_applicable внутри нового узла', () => {
  const card = cardOf({ ...PERIODIC, periodic_payment_indefinite: true }, NEW_NODE);
  assert.ok(card, 'карточка остаётся — это содержательный факт, не нехватка данных');
  assert.equal(card.status, 'not_applicable');
  assert.equal(card.deadline, null);
  assert.match(card.message, /бессрочное/);
  assert.match(card.details.logic, /бессрочно/);
});

test('периодические платежи: бессрочность перекрывает введённую дату', () => {
  const card = cardOf(
    {
      ...PERIODIC,
      periodic_payment_period_end_date: ORDER_ISSUED,
      periodic_payment_indefinite: true,
    },
    NEW_NODE,
  );
  assert.equal(card.status, 'not_applicable');
  assert.equal(card.deadline, null);
});

test('периодические платежи: чекбокс бессрочности не действует на другие типы документа', () => {
  // indefinite_field объявлен только у одного типа — тот же чекбокс при другом
  // типе документа расчёт не отменяет.
  const card = cardOf(
    {
      enforcement_document_type: 'court_order',
      court_order_issued_date: ORDER_ISSUED,
      periodic_payment_indefinite: true,
    },
    NEW_NODE,
  );
  assert.equal(card.status, 'computed');
  assert.equal(card.deadline, '2026-04-13');
  assert.match(card.norm, /ч\. 3 ст\. 21/);
});

// --- Блок «Добавить событие»: по типу документа, а не по узлу ---------------

test('ст. 22 применяется к двум типам документа и не применяется к периодическим платежам', () => {
  // От флага interruptible зависит показ блока «Добавить событие» на карточке
  // (renderInterruptions в web/app.js). Раньше различие держалось на том, что
  // узлов было два; теперь узел один, и различие несёт тип документа —
  // поведение прежнего отдельного узла (ст. 22 к ч. 4 ст. 21 не сведена)
  // сохранено при переносе.
  const events = { enforcement_interruptions: [INTERRUPTION] };
  for (const type of ENFORCEMENT_DOCUMENT_TYPES) {
    const card = cardOf(
      { enforcement_document_type: type.id, [type.anchor_field]: ORDER_ISSUED, ...events },
      NEW_NODE,
    );
    if (type.id === 'periodic_payments') {
      assert.equal(card.interruptible, undefined, 'ч. 4 ст. 21: блок событий не положен');
      assert.equal(card.interruptions, undefined);
      assert.equal(card.deadline, '2026-04-13', 'перерыв не должен был сдвинуть срок');
    } else {
      assert.equal(card.interruptible, true, `${type.id}: карточка не помечена interruptible`);
      assert.equal(card.restarted_from, INTERRUPTION.date);
    }
  }
});

test('ни одного прежнего узла предъявления не осталось ни в одной ситуации', () => {
  // Обратная сторона всех переносов: ни один из прежних узлов не должен
  // вернуться через buildView под старым id — иначе в модели снова окажется
  // несколько расчётов одной нормы. Входные данные нарочно сразу за все
  // ветви: общая цепочка, упрощённое, заочное, иностранное государство,
  // мировой судья, судебный приказ и периодические платежи.
  const all = buildView(
    {
      ...BASE,
      simplified_resolution_date: '2025-03-11',
      default_judgment_service_date: '2025-03-11',
      foreign_state_default_judgment_service_date: '2025-01-10',
      mirovoy_resolution_date: '2025-03-11',
      court_order_copy_received_date: '2025-03-11',
      ...PERIODIC,
      periodic_payment_period_end_date: ORDER_ISSUED,
      periodic_payment_indefinite: false,
    },
    TODAY,
  );
  const ids = [...all.cards, ...all.incomplete].map((c) => c.id);
  for (const gone of [
    'enforcement_presentation',
    'simplified_enforcement_presentation',
    'default_judgment_enforcement_presentation',
    'foreign_state_default_judgment_enforcement_presentation',
    'mirovoy_enforcement_presentation',
    'court_order_presentation',
    'periodic_payments_presentation',
  ]) {
    assert.ok(!ids.includes(gone), `узел ${gone} вернулся в модель`);
  }
  assert.ok(ids.includes(NEW_NODE));
  // Узлы вступления в силу на месте — убран был только хвост предъявления.
  assert.ok(ids.includes('entry_into_force'));
  assert.ok(ids.includes('simplified_entry_into_force'));
  assert.ok(ids.includes('default_judgment_entry_into_force'));
  assert.ok(ids.includes('mirovoy_entry_into_force'));
});
