// Короткий вход «Исполнительное производство» (ст. 21 ФЗ № 229-ФЗ) против
// существующих цепочек — полный поток от входных данных до карточки:
// inputs → buildView.
//
// Тест намеренно интеграционный (см. CLAUDE.md о границах test/): проверяется
// не арифметика ядра (она покрыта test/core/interruption через
// test/core/deduction.test.js и test/chain.test.js на синтетических данных), а
// то, что новый вход ведёт к ТОМУ ЖЕ расчёту, а не к его копии: одни и те же
// события ст. 22, введённые через новую ситуацию и через существующую ветвь,
// должны давать совпадающий результат во всём, кроме идентичности самого узла
// (id/title) и текста нормы, который у ветвей разный по самой норме.
//
// Если расчёт когда-нибудь задублируется и разойдётся, ломается именно этот
// тест, а не юнит-тесты каждой из сторон по отдельности.
//
// Сравнение возможно для двух типов документа из трёх. У периодических платежей
// второй стороны больше нет: их отдельный узел поглощён этим (см. блок
// «Периодические платежи» ниже — там сказано, что проверяется взамен и почему).

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildView } from '../../src/views.js';
import { ENFORCEMENT_DOCUMENT_TYPES } from '../../src/chain.js';

const NEW_NODE = 'enforcement_document_presentation';

// Те же ориентиры, что и у test/integration/enforcement-deduction.test.js:
// BASE + today 01.05.2025 → вступление в силу 15.04.2025, предъявление ИЛ без
// событий — 17.04.2028.
const BASE = { resolution_date: '2025-03-11', reasoned_decision_date: '2025-03-12' };
const TODAY = { today: '2025-05-01' };
const ENTRY_INTO_FORCE = '2025-04-15';

// Дата выдачи приказа взыскателю (ст. 130 ГПК) — то же поле, что и в ситуации
// «Судебный приказ»: короткий вход его переиспользует, а не заводит своё.
const ORDER_ISSUED = '2023-04-12';

const INTERRUPTION = { type: 'presentment', date: '2026-06-01' };
const RETURNED = { type: 'returned_no_assets', date: '2027-02-15' };
const PERIOD = { type: 'creditor_request', from: '2027-01-01', to: '2027-03-01' };

const cardOf = (inputs, id) => buildView({ ...BASE, ...inputs }, TODAY).cards.find((c) => c.id === id);

// Всё, что описывает РАСЧЁТ, — без того, чем узлы различаются по существу
// (id/title своего узла и норма своей части ст. 21).
function calculationOf(card) {
  assert.ok(card, 'карточка узла не найдена');
  const {
    id: _id,
    title: _title,
    norm: _norm,
    details: { logic: _logic, calculation: _calculation, ...details },
    ...rest
  } = card;
  return { ...rest, details };
}

// То же для карточек, собранных разными рендерерами: только поля, которые
// несёт сам расчёт ст. 22, без обвязки конкретного рендерера.
function interruptionStateOf(card) {
  assert.ok(card, 'карточка узла не найдена');
  return {
    status: card.status,
    deadline: card.deadline,
    interruptible: card.interruptible,
    base_anchor: card.base_anchor,
    restarted_from: card.restarted_from,
    interruptions: card.interruptions,
    interruption_warning: card.interruption_warning,
    deductions: card.deductions,
    deducted_days: card.deducted_days,
    deadline_before_deduction: card.deadline_before_deduction,
    deduction_exhausts_term: card.deduction_exhausts_term,
    deduction_assumption: card.deduction_assumption,
    deduction_overlap_warning: card.deduction_overlap_warning,
    calculation: card.details.calculation,
    midnight_rule: card.details.midnight_rule,
    interruption_norm: card.details.interruption_norm,
    interruption_logic: card.details.interruption_logic,
    deduction_norm: card.details.deduction_norm,
    deduction_logic: card.details.deduction_logic,
  };
}

// --- Базовые ориентиры (страховка от молчаливого сдвига остальных тестов) ---

test('базовые ориентиры: обе стороны сравнения считаются и дают ожидаемые даты', () => {
  assert.equal(cardOf({}, 'enforcement_presentation').deadline, '2028-04-17');
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
  assert.equal(cardOf({ court_order_issued_date: ORDER_ISSUED }, 'court_order_presentation').deadline, '2026-04-13');
});

// --- Судебный приказ: тот же ввод через два входа ---------------------------

test('судебный приказ: перерыв через новую ситуацию совпадает с перерывом через существующую ветвь', () => {
  const events = { enforcement_interruptions: [INTERRUPTION] };
  const viaChain = cardOf({ court_order_issued_date: ORDER_ISSUED, ...events }, 'court_order_presentation');
  const viaSituation = cardOf(
    { enforcement_document_type: 'court_order', court_order_issued_date: ORDER_ISSUED, ...events },
    NEW_NODE,
  );
  assert.deepEqual(calculationOf(viaSituation), calculationOf(viaChain));
  // И это не совпадение двух «ничего не посчитано»: перерыв действительно
  // сработал в обоих.
  assert.equal(viaSituation.restarted_from, INTERRUPTION.date);
  assert.equal(viaSituation.deadline, '2029-06-01');
});

test('судебный приказ: вычет через новую ситуацию совпадает с вычетом через существующую ветвь', () => {
  const events = { enforcement_interruptions: [PERIOD] };
  const viaChain = cardOf({ court_order_issued_date: ORDER_ISSUED, ...events }, 'court_order_presentation');
  const viaSituation = cardOf(
    { enforcement_document_type: 'court_order', court_order_issued_date: ORDER_ISSUED, ...events },
    NEW_NODE,
  );
  assert.deepEqual(calculationOf(viaSituation), calculationOf(viaChain));
  assert.equal(viaSituation.deducted_days, 59);
  assert.ok(viaSituation.deadline_before_deduction);
});

test('судебный приказ: перерыв и вычет вместе — тот же результат через оба входа', () => {
  const events = { enforcement_interruptions: [INTERRUPTION, PERIOD, RETURNED] };
  const viaChain = cardOf({ court_order_issued_date: ORDER_ISSUED, ...events }, 'court_order_presentation');
  const viaSituation = cardOf(
    { enforcement_document_type: 'court_order', court_order_issued_date: ORDER_ISSUED, ...events },
    NEW_NODE,
  );
  assert.deepEqual(calculationOf(viaSituation), calculationOf(viaChain));
  // Обе ветви ст. 22 видны на карточке: перерыв перезапустил срок от
  // последнего события, вычет уменьшил его.
  assert.equal(viaSituation.restarted_from, RETURNED.date);
  assert.equal(viaSituation.interruptions.length, 2);
  assert.equal(viaSituation.deductions.length, 1);
  assert.equal(viaSituation.deducted_days, 59);
});

// --- Вступившее в силу решение: тот же ввод через два входа -----------------

test('вступившее в силу решение: перерыв и вычет совпадают с общей цепочкой', () => {
  // Норма у общего узла и у варианта «решение» одна и та же (ч. 1 ст. 21), и
  // якорь тот же — дата вступления в силу; в общей цепочке она вычисляется,
  // здесь вводится, а дальше расчёт обязан быть тем же самым.
  const events = { enforcement_interruptions: [INTERRUPTION, PERIOD] };
  const viaChain = cardOf(events, 'enforcement_presentation');
  const viaSituation = cardOf(
    {
      enforcement_document_type: 'court_decision',
      enforcement_decision_entry_into_force_date: ENTRY_INTO_FORCE,
      ...events,
    },
    NEW_NODE,
  );
  // Здесь сравнение по явному списку полей расчёта, а не «всё, кроме
  // id/title/нормы», как у судебного приказа выше: карточки собираются разными
  // рендерерами (enforcementCard у узла общей цепочки, monthTermCard у нового),
  // и различия в их обвязке — stubs, duration, restoration_norm — к расчёту
  // не относятся.
  assert.deepEqual(interruptionStateOf(viaSituation), interruptionStateOf(viaChain));
  assert.equal(viaSituation.norm, viaChain.norm); // ч. 1 ст. 21 — одна и та же
  assert.equal(viaSituation.deadline, viaChain.deadline);
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
// Доказательство переиспользования движка держится на двух блоках выше
// (судебный приказ и вступившее в силу решение) — там обе стороны сравнения
// по-прежнему существуют.

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

test('прежнего отдельного узла периодических платежей не осталось ни в одной ситуации', () => {
  // Обратная сторона переноса: узел не должен вернуться через buildView под
  // старым id — иначе в модели снова два расчёта одной нормы.
  const all = buildView(
    {
      ...BASE,
      ...PERIODIC,
      periodic_payment_period_end_date: ORDER_ISSUED,
      periodic_payment_indefinite: false,
    },
    TODAY,
  );
  const ids = [...all.cards, ...all.incomplete].map((c) => c.id);
  assert.ok(!ids.includes('periodic_payments_presentation'));
  assert.ok(ids.includes(NEW_NODE));
});
