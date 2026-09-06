// Каркас карточки узла для отображения. Предметно-независимо: строит карточку
// из уже посчитанного результата (term/calc), не знает ни о каком конкретном
// процессуальном кодексе или норме — читает только поля переданных данных.

import { toISODate, calendarNote, isWorkingDay } from '../calendar/calendar.js';
import { addDays } from '../engine/engine.js';

// Приводит Date | 'YYYY-MM-DD' | null/undefined к ISO-строке или null.
//
// Это НЕ каноническая toISO (core/engine/term.js) — отдельная, более простая
// реализация без защиты от пустой строки/битых дат, унаследованная от
// src/views.js вместе с markExpired. Дублирование уже отмечено аудитом
// (docs/core-extraction-audit.md, фрагмент 5) как отдельный, ещё не решённый
// вопрос; здесь оно только переносится, а не устраняется — замена на
// каноническую версию могла бы незаметно изменить поведение markExpired на
// граничных значениях (пустая строка, битая дата), а это прямо запрещено
// условием переноса.
function toISO(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const [y, m, d] = value.split('-').map(Number);
    return toISODate(new Date(Date.UTC(y, m - 1, d)));
  }
  return toISODate(value);
}

// Разница в календарных днях: bIso − aIso.
export function daysBetween(aIso, bIso) {
  const [ay, am, ad] = aIso.split('-').map(Number);
  const [by, bm, bd] = bIso.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

// Насколько фактическая дата вышла за последний допустимый день — в рабочих
// днях. Порог задан в рабочих днях, поэтому и расхождение считаем в них: по
// календарным новогодние каникулы раздували бы цифру втрое.
export function workingDaysAfter(allowedISO, actualISO) {
  let count = 0;
  let cursor = allowedISO;
  while (cursor < actualISO) {
    cursor = toISODate(addDays(cursor, 1));
    if (isWorkingDay(cursor)) count += 1;
  }
  return count;
}

// Недостающие input из списка ids → [{id, label}]. labels — словарь подписей
// полей (предметный, передаётся вызывающим кодом).
export function missingInputs(ids, inputs, labels) {
  return ids
    .filter((id) => inputs[id] == null)
    .map((id) => ({ id, label: labels[id] }));
}

export function incompleteNode(id, kind, title, reason, missing) {
  return { id, kind, title, status: 'not_computed', reason, missing_inputs: missing };
}

// --- Карточки узлов ---------------------------------------------------------

// Карточка простого срока с одной действующей редакцией нормы (term —
// исходная константа, calc — результат computeDeadline).
export function termCard(term, calc) {
  const version = term.norm_versions[0]; // контракт: одноверсионный срок
  const card = {
    id: term.id,
    kind: 'term',
    title: term.title,
    status: 'computed',
    deadline: calc.deadline,
    norm: version.norm.primary,
    details: {
      collapsed: true, // блок «подробнее» свёрнут по умолчанию
      logic: term.logic,
      calculation: version.norm.calculation,
      midnight_rule: term.midnight_rule,
    },
  };
  if (term.restoration_norm) card.restoration_norm = term.restoration_norm;
  attachCalendarWarning(card);
  return card;
}

// Примечание о достоверности календаря (draft/preliminary год + зона переносов).
// Для карточек-событий дату надо передать явно: у них поле date, а не deadline.
export function attachCalendarWarning(card, date = card.deadline) {
  if (date == null) return;
  const note = calendarNote(date);
  if (note) card.calendar_warning = note;
}

// Карточка срока, исчисляемого рабочими днями. Показывает первый день
// течения — иначе непонятно, почему дата такая далёкая после каникул.
export function workingDayCard(term, extra = {}) {
  const card = {
    id: term.id,
    kind: 'term',
    title: term.title,
    status: 'computed',
    deadline: term.deadline,
    norm: term.norm.primary,
    unit: 'working_day',
    duration: term.duration,
    first_working_day: term.first_working_day,
    details: {
      collapsed: true,
      logic: term.logic,
      calculation: term.norm.calculation,
      midnight_rule: term.midnight_rule,
    },
    ...extra,
  };
  if (term.anchor_note) card.note = term.anchor_note;
  if (term.restoration_norm) card.restoration_norm = term.restoration_norm;
  attachCalendarWarning(card);
  return card;
}

// Карточка срока, посчитанного через computeSimpleTerm/computeVersionedTerm
// (название осталось от первого случая применения, но функция не завязана на
// конкретную длительность или единицу).
//
// История перерывов (если у срока она есть) сюда не добавляется — это
// предметная надстройка, вызывающий код прикладывает её сам поверх карточки.
export function monthTermCard(term) {
  const card = {
    id: term.id,
    kind: 'term',
    title: term.title,
    status: 'computed',
    deadline: term.deadline,
    norm: term.norm.primary,
    duration: term.duration,
    details: {
      collapsed: true,
      logic: term.logic,
      calculation: term.norm.calculation,
      midnight_rule: term.midnight_rule,
    },
  };
  if (term.restoration_norm) card.restoration_norm = term.restoration_norm;
  attachCalendarWarning(card);
  return card;
}

// --- Истёкшие и пропущенные сроки --------------------------------------------
//
// Срок истекает в 24:00 последнего дня, поэтому дедлайн «сегодня» ещё не
// истёк — сравнение строгое.
//
// Отличать 'missed' от 'expired': 'missed' появляется, когда введена дата
// фактической подачи и она позже дедлайна — там установлен факт пропуска.
// 'expired' — факта нет, известно только, что срок прошёл.
//
// config — { factInputMap, missedFromFilingIds, labels }:
//   factInputMap — { [card.id]: inputId } — каким input подтверждается
//     совершение действия по узлу; узел, которого в карте нет, подтвердить
//     нечем, для него достаточно сравнения с текущей датой;
//   missedFromFilingIds — Set<string> id узлов, где факт — именно дата
//     подачи заявителем (только для них поздняя дата означает пропуск, а не
//     что-то другое — например, нарушение срока судом).
//
// Норма восстановления пропущенного срока читается из card.restoration_norm
// (заполняется тем, что построило карточку, — см. termCard/workingDayCard/
// monthTermCard выше) — не константа этого модуля: у разных сроков и
// процессуальных кодексов она может различаться. Если для узла, помечаемого
// 'missed', это поле не задано — явная ошибка, а не молчаливая подстановка
// какого-либо текста по умолчанию.
//
// @param {object[]} cards
// @param {object} inputs
// @param {string|null} today — 'YYYY-MM-DD'; без неё пометки нет.
// @param {{factInputMap: object, missedFromFilingIds: Set<string>}} config
export function markExpired(cards, inputs, today, config) {
  const { factInputMap, missedFromFilingIds } = config;
  for (const card of cards) {
    if (card.kind !== 'term' || card.status !== 'computed' || !card.deadline) continue;
    const factInput = factInputMap[card.id];
    const fact = factInput ? toISO(inputs?.[factInput]) : null;

    if (fact != null) {
      // Факт есть — дальше судим по нему, а не по календарю. Пропуск
      // устанавливается только там, где этот факт и есть дата подачи.
      if (missedFromFilingIds.has(card.id) && fact > card.deadline) {
        if (card.restoration_norm == null) {
          throw new Error(
            `markExpired: у узла "${card.id}" не задана норма восстановления ` +
              '(card.restoration_norm) — узел не может быть помечен как пропущенный.',
          );
        }
        card.status = 'missed';
        card.overdue = { days: daysBetween(card.deadline, fact), norm: card.restoration_norm };
      }
      continue;
    }

    if (today == null || card.deadline >= today) continue; // 24:00 последнего дня
    card.status = 'expired';
    card.expired = { days: daysBetween(card.deadline, today) };
  }
  return cards;
}
