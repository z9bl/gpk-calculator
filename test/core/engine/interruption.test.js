// Юнит-тесты механики перерыва срока (core/engine/interruption.js) в
// изоляции: допустимые основания и текст нормы передаются параметрами, поэтому
// здесь синтетические (но по форме реалистичные) данные и ни одного импорта из
// src/ или apk/. Согласованность с реальными основаниями перерыва
// исполнительного производства проверяют интеграционные тесты.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  interruptionEvents,
  applyInterruptions,
  withInterruptions,
  computeInterruptibleTerm,
} from '../../../core/engine/interruption.js';
import { computeSimpleTerm, toISO } from '../../../core/engine/term.js';

const VALID = new Set(['presentment', 'partial_execution', 'returned_no_assets']);
const BASE = '2025-03-11';

const CONFIG = {
  norm: 'ч. 1 ст. 22 ФЗ № 229-ФЗ',
  logic: 'Срок начинается заново со дня перерыва.',
  warning: { text: 'Только для исполнительных документов.' },
};

// Трёхлетний срок с единственной редакцией нормы (форма term из core).
const TERM = {
  id: 'enforcement_presentment',
  title: 'Предъявление исполнительного документа',
  duration: { value: 3, unit: 'year' },
  anchor: { offset_start: 1 },
  weekend_shift: true,
  logic: 'Три года со дня, следующего за вступлением в силу.',
  norm_versions: [{ norm: 'ч. 1 ст. 21 ФЗ № 229-ФЗ' }],
  interruptible: true,
};

// --- interruptionEvents ------------------------------------------------------

test('interruptionEvents: пустой, отсутствующий или не-массив → []', () => {
  assert.deepEqual(interruptionEvents(BASE, [], VALID), []);
  assert.deepEqual(interruptionEvents(BASE, null, VALID), []);
  assert.deepEqual(interruptionEvents(BASE, undefined, VALID), []);
  assert.deepEqual(interruptionEvents(BASE, 'presentment', VALID), []);
});

test('interruptionEvents: события сортируются по дате по возрастанию', () => {
  const events = interruptionEvents(
    BASE,
    [
      { type: 'returned_no_assets', date: '2026-09-01' },
      { type: 'presentment', date: '2025-06-01' },
      { type: 'partial_execution', date: '2026-01-15' },
    ],
    VALID,
  );
  assert.deepEqual(events, [
    { type: 'presentment', date: '2025-06-01' },
    { type: 'partial_execution', date: '2026-01-15' },
    { type: 'returned_no_assets', date: '2026-09-01' },
  ]);
});

test('interruptionEvents: без даты → ignored no_date, уходит в конец', () => {
  const events = interruptionEvents(
    BASE,
    [
      { type: 'presentment' },
      { type: 'partial_execution', date: '2025-06-01' },
      { type: 'presentment', date: '' },
    ],
    VALID,
  );
  assert.deepEqual(events, [
    { type: 'partial_execution', date: '2025-06-01' },
    { type: 'presentment', date: null, ignored: true, ignored_reason: 'no_date' },
    { type: 'presentment', date: null, ignored: true, ignored_reason: 'no_date' },
  ]);
});

test('interruptionEvents: основание вне validTypeIds → ignored unknown_type', () => {
  const events = interruptionEvents(
    BASE,
    [{ type: 'made_up', date: '2025-06-01' }, { date: '2025-07-01' }],
    VALID,
  );
  assert.deepEqual(events, [
    { type: 'made_up', date: '2025-06-01', ignored: true, ignored_reason: 'unknown_type' },
    { type: null, date: '2025-07-01', ignored: true, ignored_reason: 'unknown_type' },
  ]);
});

test('interruptionEvents: дата раньше базового якоря → ignored before_anchor', () => {
  const events = interruptionEvents(
    BASE,
    [
      { type: 'presentment', date: '2025-03-10' },
      { type: 'presentment', date: BASE }, // ровно в день якоря — допустимо
    ],
    VALID,
  );
  assert.deepEqual(events, [
    { type: 'presentment', date: '2025-03-10', ignored: true, ignored_reason: 'before_anchor' },
    { type: 'presentment', date: BASE },
  ]);
});

test('interruptionEvents: приоритет причин — no_date, затем unknown_type, затем before_anchor', () => {
  const [a, b] = interruptionEvents(
    BASE,
    [
      { type: 'made_up', date: '2020-01-01' }, // неизвестный тип и до якоря
      { type: 'made_up' }, // неизвестный тип и без даты
    ],
    VALID,
  );
  assert.equal(a.ignored_reason, 'unknown_type');
  assert.equal(b.ignored_reason, 'no_date');
});

test('interruptionEvents: якорь можно передать Date; без якоря отсев по before_anchor не работает', () => {
  const withDate = interruptionEvents(
    new Date(Date.UTC(2025, 2, 11)),
    [{ type: 'presentment', date: '2025-03-10' }],
    VALID,
  );
  assert.equal(withDate[0].ignored_reason, 'before_anchor');

  const noAnchor = interruptionEvents(
    null,
    [{ type: 'presentment', date: '2000-01-01' }],
    VALID,
  );
  assert.deepEqual(noAnchor, [{ type: 'presentment', date: '2000-01-01' }]);
});

test('interruptionEvents: не мутирует входной массив и события', () => {
  const input = [
    { type: 'presentment', date: '2026-01-01' },
    { type: 'presentment', date: '2025-06-01' },
  ];
  const snapshot = structuredClone(input);
  interruptionEvents(BASE, input, VALID);
  assert.deepEqual(input, snapshot);
});

// --- applyInterruptions ------------------------------------------------------

test('applyInterruptions: без событий возвращает baseAnchorDate без изменений', () => {
  assert.equal(applyInterruptions(BASE, [], VALID), BASE);
  assert.equal(applyInterruptions(BASE, null, VALID), BASE);
  const date = new Date(Date.UTC(2025, 2, 11));
  assert.equal(applyInterruptions(date, undefined, VALID), date); // тот же объект
});

test('applyInterruptions: одно валидное событие → его дата', () => {
  assert.equal(
    applyInterruptions(BASE, [{ type: 'presentment', date: '2025-08-20' }], VALID),
    '2025-08-20',
  );
});

test('applyInterruptions: несколько событий вразнобой → дата последнего по хронологии', () => {
  assert.equal(
    applyInterruptions(
      BASE,
      [
        { type: 'partial_execution', date: '2026-01-15' },
        { type: 'returned_no_assets', date: '2026-09-01' },
        { type: 'presentment', date: '2025-06-01' },
      ],
      VALID,
    ),
    '2026-09-01',
  );
});

test('applyInterruptions: проигнорированные события не влияют на результат', () => {
  // Самое позднее событие — с неизвестным основанием; ещё одно раньше якоря
  // и одно без даты. Остаётся единственное учтённое.
  assert.equal(
    applyInterruptions(
      BASE,
      [
        { type: 'made_up', date: '2030-01-01' },
        { type: 'presentment', date: '2025-01-01' },
        { type: 'presentment' },
        { type: 'partial_execution', date: '2025-09-09' },
      ],
      VALID,
    ),
    '2025-09-09',
  );
});

test('applyInterruptions: только проигнорированные события → базовый якорь', () => {
  assert.equal(
    applyInterruptions(
      BASE,
      [{ type: 'made_up', date: '2030-01-01' }, { type: 'presentment', date: '2025-01-01' }],
      VALID,
    ),
    BASE,
  );
});

// --- withInterruptions -------------------------------------------------------

test('withInterruptions: пустой events → тот же result без добавленных полей', () => {
  const result = { id: 'x', deadline: '2028-03-13' };
  const out = withInterruptions(result, BASE, [], CONFIG);
  assert.equal(out, result);
  assert.equal('base_anchor' in out, false);
  assert.equal('interruptions' in out, false);
});

test('withInterruptions: непустой events → base_anchor, interruptions и поля config', () => {
  const result = { id: 'x', deadline: '2028-03-13' };
  const events = [{ type: 'presentment', date: '2025-08-20' }];
  const out = withInterruptions(result, BASE, events, CONFIG);
  assert.deepEqual(out, {
    id: 'x',
    deadline: '2028-03-13',
    base_anchor: BASE,
    interruptions: events,
    interruption_norm: CONFIG.norm,
    interruption_logic: CONFIG.logic,
    interruption_warning: CONFIG.warning,
  });
  assert.deepEqual(result, { id: 'x', deadline: '2028-03-13' }); // исходный не тронут
});

test('withInterruptions: warning в config необязателен', () => {
  const out = withInterruptions(
    { id: 'x' },
    BASE,
    [{ type: 'presentment', date: '2025-08-20' }],
    { norm: 'n', logic: 'l' },
  );
  assert.equal(out.interruption_warning, undefined);
  assert.equal(out.interruption_norm, 'n');
});

test('withInterruptions: события только с ignored тоже сохраняются в истории', () => {
  // Непустой events (даже из одних ignored) — история сохраняется.
  const events = [{ type: 'made_up', date: '2025-06-01', ignored: true, ignored_reason: 'unknown_type' }];
  const out = withInterruptions({ id: 'x' }, BASE, events, CONFIG);
  assert.deepEqual(out.interruptions, events);
});

test('withInterruptions: result == null → null', () => {
  assert.equal(withInterruptions(null, BASE, [{ type: 'presentment', date: '2025-08-20' }], CONFIG), null);
  assert.equal(withInterruptions(undefined, BASE, [], CONFIG), undefined);
});

// --- computeInterruptibleTerm ------------------------------------------------

test('computeInterruptibleTerm: baseAnchorDate == null → null', () => {
  assert.equal(computeInterruptibleTerm(TERM, null, [], VALID, CONFIG), null);
  assert.equal(computeInterruptibleTerm(TERM, undefined, [], VALID, CONFIG), null);
  assert.equal(computeInterruptibleTerm(TERM, '', [], VALID, CONFIG), null);
});

test('computeInterruptibleTerm: без перерывов — обычный computeSimpleTerm', () => {
  const out = computeInterruptibleTerm(TERM, BASE, [], VALID, CONFIG);
  assert.deepEqual(out, computeSimpleTerm(TERM, BASE));
  assert.equal(out.anchor, BASE);
});

test('computeInterruptibleTerm: срок считается от последнего учтённого перерыва', () => {
  const interruptions = [
    { type: 'returned_no_assets', date: '2026-09-01' },
    { type: 'presentment', date: '2025-06-02' },
    { type: 'made_up', date: '2030-01-01' }, // не принимается
  ];
  const out = computeInterruptibleTerm(TERM, BASE, interruptions, VALID, CONFIG);
  const expected = computeSimpleTerm(TERM, '2026-09-01');

  // Сам расчёт — как у computeSimpleTerm от сдвинутого якоря.
  for (const key of ['anchor', 'raw_deadline', 'deadline', 'shifted', 'norm', 'id']) {
    assert.deepEqual(out[key], expected[key], key);
  }
  assert.equal(out.anchor, '2026-09-01');
  assert.notEqual(out.deadline, computeSimpleTerm(TERM, BASE).deadline);

  // История: исходный якорь, отсортированные события (с причиной отсева), config.
  assert.equal(out.base_anchor, BASE);
  assert.deepEqual(out.interruptions, [
    { type: 'presentment', date: '2025-06-02' },
    { type: 'returned_no_assets', date: '2026-09-01' },
    { type: 'made_up', date: '2030-01-01', ignored: true, ignored_reason: 'unknown_type' },
  ].sort((a, b) => (a.date < b.date ? -1 : 1)));
  assert.equal(out.interruption_norm, CONFIG.norm);
  assert.equal(out.interruption_logic, CONFIG.logic);
  assert.equal(out.interruption_warning, CONFIG.warning);
});

test('computeInterruptibleTerm: только непринятые события → якорь базовый, история сохранена', () => {
  const interruptions = [{ type: 'presentment', date: '2025-01-01' }];
  const out = computeInterruptibleTerm(TERM, BASE, interruptions, VALID, CONFIG);
  assert.equal(out.anchor, BASE);
  assert.equal(out.deadline, computeSimpleTerm(TERM, BASE).deadline);
  assert.equal(out.base_anchor, BASE);
  assert.deepEqual(out.interruptions, [
    { type: 'presentment', date: '2025-01-01', ignored: true, ignored_reason: 'before_anchor' },
  ]);
});

test('computeInterruptibleTerm: якорь-Date нормализуется в ISO в base_anchor', () => {
  const out = computeInterruptibleTerm(
    TERM,
    new Date(Date.UTC(2025, 2, 11)),
    [{ type: 'presentment', date: '2025-06-02' }],
    VALID,
    CONFIG,
  );
  assert.equal(out.base_anchor, toISO(BASE));
  assert.equal(out.anchor, '2025-06-02');
});
