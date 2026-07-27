// Поле даты: маска, разбор и правило показа ошибки (web/app.js поверх этого
// модуля только читает DOM). Баг из отчёта: 27.02.2025 после удаления одного
// символа превращалось в 20.22.025, и расчёт молча уходил на другую ветку.

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyDateEdit, dateFieldError, isDatePrefix, ruToISO } from '../src/date-field.js';

// Ввод в конец строки: браузер ставит каретку в конец, inputType — insertText.
const typeAtEnd = (value) => applyDateEdit(value, value.length, 'insertText');
// Удаление: caret — позиция после удалённого символа.
const deleteAt = (value, caret) => applyDateEdit(value, caret, 'deleteContentBackward');

test('маска: набор в конец расставляет разделители', () => {
  assert.equal(typeAtEnd('1').value, '1');
  assert.equal(typeAtEnd('27').value, '27');
  assert.equal(typeAtEnd('270').value, '27.0');
  assert.equal(typeAtEnd('27.02').value, '27.02');
  assert.equal(typeAtEnd('27.022').value, '27.02.2');
  assert.equal(typeAtEnd('27.02.2025').value, '27.02.2025');
  // Каретка после переформатирования — в конце.
  assert.equal(typeAtEnd('270').caret, 4);
});

test('маска: лишние цифры сверх восьми отбрасываются', () => {
  assert.equal(typeAtEnd('27.02.20255').value, '27.02.2025');
});

test('баг: удаление символа из середины не переставляет цифры', () => {
  // 27.02.2025, удалена «7» (каретка встала на позицию 1).
  const after = deleteAt('2.02.2025', 1);
  assert.equal(after.value, '2.02.2025', 'значение остаётся как есть');
  assert.equal(after.caret, 1, 'каретка на месте правки');
  // Прежнее поведение давало здесь 20.22.025 — цифры переползали по разрядам.
  assert.notEqual(after.value, '20.22.025');
});

test('баг: испорченное редактированием значение даёт видимую ошибку', () => {
  // Оба состояния из отчёта: расчёт не должен молча уходить на другую ветку.
  assert.equal(ruToISO('2.02.2025'), null);
  assert.match(dateFieldError('2.02.2025'), /Неверная дата/);
  assert.equal(ruToISO('20.22.025'), null);
  assert.match(dateFieldError('20.22.025'), /Неверная дата/);
});

test('вставка символа в середину не сдвигает соседние цифры', () => {
  // 27.02.2025, в середину вставлена «9» → 27.902.2025 (каретка после неё).
  const after = applyDateEdit('27.902.2025', 4, 'insertText');
  assert.equal(after.value, '27.902.2025');
  assert.equal(after.caret, 4);
  assert.match(dateFieldError(after.value), /Неверная дата/);
});

test('удаление разделителя удаляет именно его', () => {
  const after = deleteAt('2702.2025', 2);
  assert.equal(after.value, '2702.2025');
  assert.equal(after.caret, 2);
  assert.match(dateFieldError(after.value), /Неверная дата/, 'без точки — не дата');
});

test('удаление с конца возвращает строку в состояние набора — ошибки нет', () => {
  const after = deleteAt('27.02.202', 9);
  assert.equal(after.value, '27.02.202');
  assert.equal(dateFieldError(after.value), '');
});

test('полная очистка поля: ни значения, ни ошибки', () => {
  const after = deleteAt('', 0);
  assert.equal(after.value, '');
  assert.equal(after.caret, 0);
  assert.equal(dateFieldError(''), '');
});

test('вставка из буфера форматируется целиком', () => {
  assert.equal(applyDateEdit('27022025', 8, 'insertFromPaste').value, '27.02.2025');
  assert.equal(applyDateEdit('27.02.2025', 10, 'insertFromPaste').value, '27.02.2025');
  // Вставка в середину — тоже пересборка целиком: разряды не должны разъезжаться.
  assert.equal(applyDateEdit('2702.20257', 4, 'insertFromPaste').value, '27.02.2025');
});

test('мусор из значения убирается всегда', () => {
  assert.equal(applyDateEdit('27a.02.2025', 3, 'insertText').value, '27.02.2025');
  assert.equal(deleteAt('27 .02.2025', 3).value, '27.02.2025');
});

test('ошибка не показывается, пока строка в наборе', () => {
  for (const v of ['', '2', '27', '27.', '27.0', '27.02', '27.02.', '27.02.2', '27.02.202']) {
    assert.equal(dateFieldError(v), '', `«${v}» — это набор, ругаться рано`);
  }
});

test('несуществующая дата даёт ошибку, хотя форма верна', () => {
  assert.equal(ruToISO('31.02.2025'), null);
  assert.match(dateFieldError('31.02.2025'), /Неверная дата/);
});

test('невозможные день и месяц отсекаются ещё в наборе', () => {
  assert.equal(isDatePrefix('32.0'), false);
  assert.equal(isDatePrefix('00.0'), false);
  assert.equal(isDatePrefix('27.13'), false);
  assert.equal(isDatePrefix('27.00'), false);
  assert.equal(isDatePrefix('27.12'), true);
  assert.match(dateFieldError('27.13'), /Неверная дата/);
});
