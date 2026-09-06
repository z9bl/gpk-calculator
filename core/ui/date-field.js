// Поле даты ДД.ММ.ГГГГ: маска, разбор и правило показа ошибки.
//
// Здесь только чистые функции над строками — ни DOM, ни состояния. Вынесено из
// web/app.js, чтобы поведение маски проверялось тестами: баг «27.02.2025 после
// удаления одного символа → 20.22.025» жил именно в этой логике, а браузерная
// проверка ловит его только вручную.

/** 'ДД.ММ.ГГГГ' → 'YYYY-MM-DD' | null (с проверкой реальности даты). */
export function ruToISO(str) {
  const m = String(str).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null; // напр. 31.02.2025
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** 'YYYY-MM-DD' → 'ДД.ММ.ГГГГ' ('' для пустого значения). */
export function isoToRu(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * Сборка ДД.ММ.ГГГГ из голых цифр. Применяется только там, где строка и так
 * пересобирается целиком: ввод в конец и вставка.
 */
export function maskFromDigits(digits) {
  const d = digits.slice(0, 8);
  if (d.length > 4) return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`;
  if (d.length > 2) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return d;
}

/**
 * Значение «в наборе»: выглядит ровно так, как маска собрала бы из этих цифр, и
 * день с месяцем пока не противоречат календарю.
 *
 * Нужны обе проверки, и вот почему — на двух состояниях из отчёта о баге:
 *   «2.02.2025» — маска из его цифр собрала бы «20.22.025», форма не совпала,
 *                 отсекается по форме;
 *   «20.22.025» — форма как раз совпадает (это и есть результат маски от тех же
 *                 цифр), отсекается только проверкой месяца.
 */
export function isDatePrefix(value) {
  if (value.length >= 10) return false;
  // Хвостовой разделитель — нормальное состояние набора: «27.» получается, если
  // стереть месяц из «27.0». Сама маска его не ставит, поэтому сравниваем без него.
  const core = value.endsWith('.') ? value.slice(0, -1) : value;
  if (maskFromDigits(core.replace(/\D/g, '')) !== core) return false;
  const [day, month] = value.split('.');
  if (day && day.length === 2 && (Number(day) < 1 || Number(day) > 31)) return false;
  if (month && month.length === 2 && (Number(month) < 1 || Number(month) > 12)) return false;
  return true;
}

/**
 * Текст ошибки поля. Показываем для любого непустого значения, которое не
 * читается как дата и не является строкой в наборе.
 *
 * Молчать нельзя: без значения расчёт переключается на другую ветку, и без
 * видимой ошибки это выглядит как результат, а не как испорченный ввод.
 */
export function dateFieldError(raw) {
  if (raw === '' || ruToISO(raw) != null || isDatePrefix(raw)) return '';
  return 'Неверная дата. Формат ДД.ММ.ГГГГ.';
}

/**
 * Как должно выглядеть поле после правки.
 *
 * Маска применяется, только когда строка и так пересобирается целиком: при
 * вставке и при вводе в конец. Правка внутри строки (удаление символа или
 * вставка в середину) остаётся как есть — иначе цифры переползают по разрядам и
 * 27.02.2025 после удаления одного символа превращается в 20.22.025.
 *
 * @param {string} value — значение поля сразу после правки браузером
 * @param {number} caret — позиция каретки после правки
 * @param {string} inputType — InputEvent.inputType ('' если недоступен)
 * @returns {{value: string, caret: number}}
 */
export function applyDateEdit(value, caret, inputType = '') {
  // Мусор (буквы, пробелы) убираем всегда — частью даты он быть не может.
  let next = value.replace(/[^\d.]/g, '');
  let nextCaret = Math.max(0, caret - (value.length - next.length));

  const deleting = inputType.startsWith('delete');
  const pasting = inputType === 'insertFromPaste' || inputType === 'insertFromDrop';
  const atEnd = caret >= value.length;

  if (pasting || (!deleting && atEnd)) {
    next = maskFromDigits(next.replace(/\D/g, ''));
    nextCaret = next.length;
  }

  return { value: next, caret: Math.min(nextCaret, next.length) };
}
