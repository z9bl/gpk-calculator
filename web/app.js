// Интерфейс (раздел 8, задача 4б SPEC.md). Поверх buildView, без изменения
// логики: приложение только читает даты, вызывает buildView и рисует результат.

import { buildView, ACTION_FACT_INPUT } from '../src/views.js';
import { buildICS, icsTermsFromView, exportableCards } from '../src/ics.js';
import {
  googleCalendarUrl,
  termsAsText,
  calendarEventTitle,
  DEADLINE_CAPTION,
  DEADLINE_CAPTION_COURT,
} from '../src/export-links.js';
import { applyDateEdit, dateFieldError, isoToRu, ruToISO } from '../src/date-field.js';
import { SITUATIONS, DEFAULT_SITUATION, situationById } from '../src/situations.js';

// --- Метаданные полей (п. 4.1 SPEC.md) --------------------------------------

const INPUT_LABELS = {
  reasoned_decision_date: 'Дата изготовления мотивированного решения',
  hearing_end_date: 'Дата окончания разбирательства дела',
  appeal_filed_date: 'Дата подачи апелляционной жалобы',
  appeal_ruling_date: 'Дата принятия апелляционного определения',
  appeal_ruling_reasoned_date: 'Дата изготовления мотивированного апелляционного определения',
  cassation_filed_date: 'Дата подачи кассационной жалобы',
  ksoyu_ruling_date: 'Дата вынесения определения КСОЮ',
  ksoyu_ruling_reasoned_date: 'Дата изготовления мотивированного определения КСОЮ',
  vs_cassation_filed_date: 'Дата подачи кассационной жалобы в ВС РФ',
  protocol_signed_date: 'Дата подписания протокола судебного заседания',
  protocol_remarks_filed_date: 'Дата подачи замечаний на протокол',
  interim_ruling_date: 'Дата вынесения определения судом первой инстанции',
  simplified_resolution_date: 'Дата подписания резолютивной части решения (упрощённое производство)',
  simplified_reasoned_request_date: 'Дата подачи заявления о составлении мотивированного решения',
  simplified_reasoned_date: 'Дата составления мотивированного решения',
  simplified_appeal_filed_date: 'Дата подачи апелляционной жалобы (упрощённое производство)',
  simplified_appeal_ruling_date: 'Дата определения апелляционной инстанции (упрощённое производство)',
  default_judgment_service_date: 'Дата вручения ответчику копии заочного решения',
  default_judgment_cancellation_request_date: 'Дата подачи заявления об отмене заочного решения',
  default_judgment_refusal_date: 'Дата определения об отказе в отмене заочного решения',
  default_judgment_cancellation_date: 'Дата определения об отмене заочного решения',
  default_judgment_appeal_filed_date: 'Дата подачи апелляционной жалобы (заочное решение)',
  default_judgment_appeal_ruling_date: 'Дата определения апелляционной инстанции (заочное решение)',
  default_judgment_subject: 'Кто обжалует заочное решение',
  mirovoy_resolution_date: 'Дата объявления резолютивной части (мировой судья)',
  mirovoy_attendance: 'Участник присутствовал в судебном заседании',
  mirovoy_request_date: 'Дата подачи заявления о составлении мотивированного решения',
  mirovoy_reasoned_date: 'Дата составления мотивированного решения мировым судьёй',
  vs_ruling_date: 'Дата вынесения определения Судебной коллегии ВС РФ',
  mirovoy_appeal_ruling_reasoned_date:
    'Дата изготовления мотивированного апелляционного определения районного суда',
};
const INPUT_HINTS = {
  appeal_filed_date: 'Если жалоба подана, укажите дату',
  appeal_ruling_date: 'Дата оглашения апелляционного определения',
  appeal_ruling_reasoned_date: 'Если не откладывалось — совпадает с датой принятия',
  cassation_filed_date:
    'От даты подачи зависит, в какой редакции применяется ст. 376.1 — до 01.09.2024 или после',
  ksoyu_ruling_date:
    'От неё считается срок кассационной жалобы в Судебную коллегию ВС РФ (ст. 390.3)',
  ksoyu_ruling_reasoned_date: 'Отложение до 10 дней (ч. 7 ст. 390.1); если не откладывалось — совпадает с датой вынесения',
  vs_cassation_filed_date:
    'От даты подачи зависит, в какой редакции применяется ст. 390.3 — до 01.09.2024 или после',
  protocol_signed_date: 'Срок 5 рабочих дней (ч. 1 ст. 231 ГПК)',
  protocol_remarks_filed_date: 'Если не указана — срок рассмотрения считается от последнего дня подачи',
  interim_ruling_date: 'Срок 15 рабочих дней (ст. 332 ГПК)',
  simplified_resolution_date:
    'В упрощённом производстве все сроки считаются в рабочих днях (глава 21.1 ГПК)',
  simplified_reasoned_request_date:
    'После подачи заявления у суда есть 10 рабочих дней на изготовление решения (ч. 4 ст. 232.4)',
  simplified_reasoned_date:
    'Если решение составлено, срок на апелляцию считается от этой даты (ч. 8 ст. 232.4)',
  simplified_appeal_filed_date:
    'Если жалоба подана, решение вступит в силу после её рассмотрения (ч. 7 ст. 232.4)',
  simplified_appeal_ruling_date: 'С этого дня решение считается вступившим в силу (ч. 7 ст. 232.4)',
  default_judgment_service_date:
    'От неё считается семидневный срок на заявление об отмене (ч. 1 ст. 237)',
  default_judgment_cancellation_request_date:
    'Если заявление подано, для иных лиц срок на апелляцию считается от определения по нему ' +
    '(абз. 2 ч. 2 ст. 237)',
  default_judgment_refusal_date: 'От неё считается месячный срок апелляции',
  default_judgment_cancellation_date:
    'Если заявление удовлетворено: решение отменено, вступления в силу не наступает',
  default_judgment_appeal_filed_date:
    'Если решение обжаловано, оно вступит в силу после рассмотрения жалобы (ч. 1 ст. 244)',
  default_judgment_appeal_ruling_date: 'Дата вступления решения в силу, если оно не отменено',
  mirovoy_resolution_date:
    'По делу мирового судьи сроки считаются в рабочих днях (ч. 3–5 ст. 199 ГПК)',
  mirovoy_request_date:
    'После подачи заявления у мирового судьи есть 10 рабочих дней на составление решения ' +
    '(ч. 5 ст. 199)',
  mirovoy_reasoned_date:
    'Если решение составлено, срок на апелляцию считается от этой даты (п. 17 ПП ВС РФ от 22.06.2021 № 16)',
  vs_ruling_date: 'Надзор в Президиум ВС — 3 месяца (ч. 2 ст. 391.2). Не путать с определением КСОЮ',
  mirovoy_appeal_ruling_reasoned_date:
    'Если дело прошло апелляцию в районном суде — от неё считается кассационный срок',
};

// Подписи полей для истёкшего срока. Пока срок идёт, речь о возможной подаче;
// когда срок прошёл — уже о состоявшейся. По старому делу эти поля и есть
// основной способ восстановить картину, поэтому спрашивать надо прямо.
const INPUT_HINTS_EXPIRED = {
  appeal_filed_date:
    'Дата фактической подачи — дальше срок кассации считается от апелляционного определения',
  protocol_remarks_filed_date: 'Дата фактической подачи — от неё считается срок рассмотрения',
};

// Поля, чей срок уже истёк: заполняется в render() по статусам карточек.
const expiredFields = new Set();

// Узлы, которые имеет смысл переносить в календарь: тот же отбор, что у .ics.
const exportableIds = new Set();

// Узлы цепочки общего порядка — они требуют даты мотивированного решения.
const GENERAL_CHAIN_NODES = new Set([
  'appeal_general',
  'entry_into_force',
  'cassation_ksoyu',
  'cassation_vs',
  'enforcement_presentation',
]);

// Порядок узлов внутри экрана задаётся выбранной ситуацией (src/situations.js):
// раньше здесь лежал единый CHAIN_ORDER на все ветви сразу.


// --- Состояние --------------------------------------------------------------

const state = { inputs: {}, situation: DEFAULT_SITUATION };
const today = todayISO();

// --- Даты: формат ДД.ММ.ГГГГ ↔ ISO ------------------------------------------

function pad(n) { return String(n).padStart(2, '0'); }

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// isoToRu/ruToISO живут в src/date-field.js — они нужны и тестам.

// Название поля для фразы «Укажите …»: подписи начинаются с «Дата», а дальше
// уже идёт родительный падеж — остаётся отбросить уточнение в скобках.
function askFor(id) {
  const label = INPUT_LABELS[id] ?? '';
  return label.replace(/^Дата /, 'дату ').replace(/\s*\([^)]*\)$/, '');
}

function pluralDays(n) {
  const t = n % 10, h = n % 100;
  if (t === 1 && h !== 11) return 'день';
  if (t >= 2 && t <= 4 && !(h >= 12 && h <= 14)) return 'дня';
  return 'дней';
}

// Автоформатирование ввода: цифры → ДД.ММ.ГГГГ.
//
// Расчёт обновляется по каждому вводу (событие input), а не по уходу с поля:
// карточки появляются сразу, как только дата набрана полностью. Неполный и
// некорректный ввод трактуется как отсутствие значения — отрисовка от него не
// ломается.
//
// Слушаем только input. change здесь вреден: он срабатывает на уходе с поля, а
// перерисовка пересобирает карточки — поле, в которое пользователь только что
// кликнул, уничтожалось бы вместе с фокусом. Вставку мышью и автозаполнение
// input покрывает сам.
function attachDateMask(input, onCommit) {
  input.addEventListener('input', (event) => {
    const before = input.value;
    const next = applyDateEdit(before, input.selectionStart ?? before.length, event.inputType ?? '');
    if (next.value !== before) {
      input.value = next.value;
      input.setSelectionRange(next.caret, next.caret);
    }
    onCommit(input, { raw: next.value, iso: ruToISO(next.value) });
  });
}

// Сырой текст полей дат. Расчёт идёт по каждому вводу, а render() пересобирает
// поля заново — недобранная дата в state.inputs не попадает, поэтому её нужно
// хранить отдельно, иначе перерисовка стирала бы набранное на полпути.
const rawDates = new Map();

// Текст, который должно показывать поле: сырой ввод, если он есть, иначе —
// значение из state.
function dateFieldValue(id) {
  const raw = rawDates.get(id);
  if (raw != null) return raw;
  return state.inputs[id] ? isoToRu(state.inputs[id]) : '';
}

// Общая фиксация ввода даты: в state попадает только полная существующая дата,
// всё остальное — как отсутствие значения.
function commitDateInput(id, input, errorEl, { raw, iso }) {
  if (raw === '') rawDates.delete(id);
  else rawDates.set(id, raw);
  const error = dateFieldError(raw);
  errorEl.textContent = error;
  input.classList.toggle('invalid', error !== '');
  if (iso == null) delete state.inputs[id];
  else state.inputs[id] = iso;
  render();
}

// --- Утилиты DOM ------------------------------------------------------------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// --- Рендер карточек --------------------------------------------------------

function renderDetails(details) {
  // Нативный <details>/<summary>: свёрнут по умолчанию, раскрывается по клику.
  const wrap = el('details', 'more');
  wrap.appendChild(el('summary', null, 'Подробнее'));
  const dl = el('dl');
  if (details.logic) {
    dl.appendChild(el('dt', null, 'Логика исчисления'));
    dl.appendChild(el('dd', null, details.logic));
  }
  if (details.calculation && details.calculation.length) {
    dl.appendChild(el('dt', null, 'Нормы расчёта'));
    const dd = el('dd');
    details.calculation.forEach((c, i) => {
      if (i) dd.appendChild(document.createTextNode(', '));
      const code = el('code', null, c);
      dd.appendChild(code);
    });
    dl.appendChild(dd);
  }
  if (details.midnight_rule) {
    dl.appendChild(el('dt', null, 'Отсечка 24:00 / почта'));
    dl.appendChild(el('dd', null, details.midnight_rule));
  }
  wrap.appendChild(dl);
  return wrap;
}

function renderTermCard(card, opts = {}) {
  // Три уровня различаются по признакам модели, а не по спискам узлов:
  // informational: true — срок суда, kind: 'event' — событие (см. renderEvent).
  if (card.informational) return renderInfoTermCard(card);

  const c = el('div', 'card');
  c.appendChild(el('div', 'kicker', 'Срок'));
  const h = el('h2', null, card.title);
  if (opts.conditionBadge) {
    const b = el('span', 'badge assume', 'при отсутствии обжалования');
    h.appendChild(b);
  }
  if (card.unit === 'working_day') {
    h.appendChild(el('span', 'badge wd', 'рабочие дни'));
  }
  if (card.informational) {
    h.appendChild(el('span', 'badge info', 'справочно'));
  }
  c.appendChild(h);

  // Что означает дата: без подписи «13.08.2026» читается неоднозначно — как
  // дата вступления в силу или как начало течения срока.
  if (card.status !== 'not_applicable') {
    c.appendChild(el('div', 'deadline-caption', DEADLINE_CAPTION));
  }

  if (card.status === 'missed') {
    c.appendChild(el('div', 'deadline missed', isoToRu(card.deadline)));
    c.appendChild(el('div', 'norm', card.norm));
    const days = card.overdue.days;
    c.appendChild(
      el('div', 'miss', `Срок пропущен на ${days} ${pluralDays(days)}. Восстановление — ${card.overdue.norm}.`),
    );
  } else if (card.status === 'expired') {
    // Дедлайн прошёл, а даты подачи нет: факт пропуска не установлен, известно
    // только, что срок истёк. Формулировка поэтому мягче, чем у 'missed'.
    c.appendChild(el('div', 'deadline expired', isoToRu(card.deadline)));
    c.appendChild(el('div', 'norm', card.norm));
    const days = card.expired.days; // строгое сравнение — всегда не меньше 1
    c.appendChild(
      el(
        'div',
        'expired-note',
        `Срок истёк ${days} ${pluralDays(days)} назад. Дата подачи не введена — ` +
          'пропуск не подтверждён.',
      ),
    );
  } else if (card.status === 'not_applicable') {
    // Срока не возникает вовсе — вместо даты прочерк и причина, как у события
    // вступления в силу в том же состоянии.
    c.appendChild(el('div', 'deadline', '—'));
    if (card.message) c.appendChild(el('div', 'warn', card.message));
    c.appendChild(el('div', 'norm', card.norm));
  } else {
    c.appendChild(el('div', 'deadline', isoToRu(card.deadline)));
    c.appendChild(el('div', 'norm', card.norm));
  }

  // Для сроков в рабочих днях показываем первый день течения — иначе непонятно,
  // почему дата уехала так далеко (например, за январские каникулы).
  if (card.first_working_day) {
    c.appendChild(
      el('div', 'hint', `Отсчёт рабочих дней с ${isoToRu(card.first_working_day)}`),
    );
  }
  if (card.note) c.appendChild(el('div', 'note', card.note));

  if (opts.conditionNote) {
    c.appendChild(el('div', 'note', opts.conditionNote));
  }

  if (card.warnings) {
    for (const w of card.warnings) {
      const details = [el('div', null, w.text)];
      // Структурные даты предупреждения форматируем здесь: views отдаёт ISO.
      if (w.allowed_deadline && w.actual_date) {
        details.push(
          el(
            'div',
            null,
            `${w.dates_label ?? 'Срок отложения истекал'} ` +
              `${isoToRu(w.allowed_deadline)}, решение изготовлено ` +
              `${isoToRu(w.actual_date)}.`,
          ),
        );
      }
      // Величина расхождения — в тех же единицах, в каких задан порог.
      if (w.overdue_working_days) {
        const n = w.overdue_working_days;
        details.push(
          el('div', null, `Расхождение — ${n} рабочих ${pluralDays(n)} сверх срока.`),
        );
      }
      c.appendChild(collapsedWarning('Суд нарушил срок изготовления решения', details));
    }
  }

  if (card.calendar_warning) {
    c.appendChild(
      collapsedWarning('Календарь на этот год ещё не окончательный', [
        el('div', null, card.calendar_warning.text),
      ]),
    );
  }

  if (card.exhaustion_warning) c.appendChild(renderExhaustionWarning(card.exhaustion_warning));

  if (card.boundary_warning) c.appendChild(renderBoundaryWarning(card.boundary_warning));

  if (card.alternative) c.appendChild(renderAlternative(card));

  if (card.details) c.appendChild(renderDetails(card.details));
  if (exportableIds.has(card.id)) c.appendChild(googleCalendarLink(card));
  return c;
}

// Ссылка на предзаполненную форму события в Google Календаре — по одной на срок.
// Открывается в новой вкладке: расчёт на странице должен остаться на месте.
function googleCalendarLink(card) {
  const a = el('a', 'to-calendar', 'Добавить в Google Календарь');
  a.href = googleCalendarUrl({
    title: calendarEventTitle(card.title),
    deadline: card.deadline,
    norm: card.norm,
  });
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

// Предупреждение в одну строку; полный текст раскрывается по клику.
//
// Раньше жёлтый блок занимал больше места, чем сама дата, и вытеснял её из
// первого экрана. Свёрнутый вид оставляет суть, развёрнутый — все подробности.
// Нативный <details>: раскрытие по клику работает без нашего кода (раздел 9).
function collapsedWarning(summaryText, detailNodes, cls = 'warn') {
  const box = el('details', `${cls} collapsible`);
  const head = el('summary', null, summaryText);
  box.appendChild(head);
  const body = el('div', 'warn-body');
  for (const node of detailNodes) if (node) body.appendChild(node);
  box.appendChild(body);
  return box;
}

// Исчерпание способов обжалования: акт в апелляции не обжаловался.
// Расчёт остаётся — он верен для актов, не подлежащих апелляционному обжалованию.
function renderExhaustionWarning(w) {
  return collapsedWarning('Требуется исчерпание способов обжалования', [
    el('div', null, w.text),
    el('div', 'hint', w.calculation_note),
    el('div', 'hint', `${w.norm} · ${w.clarification}`),
  ]);
}

function renderBoundaryWarning(bw) {
  return collapsedWarning(
    `Редакции нормы дают разные даты: ${isoToRu(bw.prev_redaction_deadline)} и ` +
      `${isoToRu(bw.current_deadline)}`,
    [
      el(
        'div',
        null,
        `По прежней редакции срок истёк ${isoToRu(bw.prev_redaction_deadline)}; ` +
          `по действующей (с ${isoToRu(bw.cutoff)}) истекает ${isoToRu(bw.current_deadline)}.`,
      ),
      el('div', null, bw.reason),
    ],
  );
}

function renderAlternative(card) {
  const a = card.alternative;
  const box = el('div', 'alt');
  box.appendChild(el('div', null, 'Спорный срок: норма и разъяснение Пленума расходятся.'));

  const row1 = el('div', 'row');
  row1.appendChild(el('span', null, `По закону (${card.norm.split('(')[0].trim()})`));
  const v1 = el('span', card.deadline === a.recommended_deadline ? 'recommended' : null, isoToRu(card.deadline));
  row1.appendChild(v1);
  box.appendChild(row1);

  const row2 = el('div', 'row');
  row2.appendChild(el('span', null, `По ${a.norm}`));
  const v2 = el('span', a.deadline === a.recommended_deadline ? 'recommended' : null, isoToRu(a.deadline));
  row2.appendChild(v2);
  box.appendChild(row2);

  box.appendChild(el('div', 'why', `${a.reason} ${a.recommendation}`));
  return box;
}

// Уровень 2 — срок суда (informational: true). Тот же состав данных, но без
// крупной даты и рамки: его не надо успевать соблюсти, он справочный.
function renderInfoTermCard(card) {
  const c = el('div', 'card info-card');
  const head = el('div', 'info-head');
  const title = el('span', 'info-title', card.title);
  head.appendChild(title);
  head.appendChild(el('span', 'badge info', 'справочно'));
  c.appendChild(head);

  const line = el('div', 'info-line');
  line.appendChild(el('span', 'deadline-caption inline', `${DEADLINE_CAPTION_COURT}:`));
  line.appendChild(
    el(
      'span',
      card.status === 'expired' ? 'info-date expired' : 'info-date',
      card.deadline ? isoToRu(card.deadline) : '—',
    ),
  );
  line.appendChild(el('span', 'norm', card.norm));
  c.appendChild(line);

  if (card.status === 'expired' && card.expired) {
    const n = card.expired.days;
    c.appendChild(el('div', 'hint', `Срок истёк ${n} ${pluralDays(n)} назад.`));
  }
  if (card.first_working_day) {
    c.appendChild(el('div', 'hint', `Отсчёт рабочих дней с ${isoToRu(card.first_working_day)}`));
  }
  if (card.note) c.appendChild(el('div', 'hint', card.note));
  if (card.calendar_warning) {
    c.appendChild(
      collapsedWarning('Календарь на этот год ещё не окончательный', [
        el('div', null, card.calendar_warning.text),
      ]),
    );
  }
  if (card.details) c.appendChild(renderDetails(card.details));
  return c;
}

// Уровень 3 — событие. Строкой текста, без карточки: вступление в силу не
// дедлайн, успевать к нему нечего. Поля-уточнения, привязанные к событию,
// остаются под строкой — иначе ветвь стала бы недоступной для ввода.
function renderEvent(card, opts = {}) {
  const box = el('div', 'event-line');

  let text;
  if (card.status === 'resolved') text = `Вступило в силу ${isoToRu(card.date)}`;
  else if (card.not_earlier_than) text = `Вступит в силу не ранее ${isoToRu(card.not_earlier_than)}`;
  else text = card.message ?? 'Дата вступления в силу пока не определена';

  const head = el('div', 'event-head');
  head.appendChild(el('span', card.status === 'resolved' ? 'event-text done' : 'event-text', text));
  head.appendChild(el('span', 'norm', card.norm));
  box.appendChild(head);

  // Дата события читается иначе, чем дедлайн: это не «успеть до», а момент,
  // с которого постановление действует.
  if (card.status === 'resolved') {
    box.appendChild(
      el('div', 'hint', 'С этой даты постановление считается вступившим в законную силу.'),
    );
  }

  if (card.note) box.appendChild(el('div', 'hint', card.note));
  if (card.calendar_warning) {
    box.appendChild(
      collapsedWarning('Календарь на этот год ещё не окончательный', [
        el('div', null, card.calendar_warning.text),
      ]),
    );
  }
  if (card.details) box.appendChild(renderDetails(card.details));
  if (opts.assumptionNote) box.appendChild(el('div', 'note', opts.assumptionNote));
  return box;
}

// Поле-приглашение уточнить (одно из недостающих input).
function renderInviteField(id) {
  const wrap = el('div', 'field');
  const lab = el('label', null, INPUT_LABELS[id]);
  lab.setAttribute('for', `in-${id}`);
  wrap.appendChild(lab);
  const input = el('input');
  input.type = 'text';
  input.id = `in-${id}`;
  input.setAttribute('inputmode', 'numeric');
  input.placeholder = 'ДД.ММ.ГГГГ';
  input.autocomplete = 'off';
  input.value = dateFieldValue(id);
  wrap.appendChild(input);
  const hint = (expiredFields.has(id) && INPUT_HINTS_EXPIRED[id]) || INPUT_HINTS[id];
  if (hint) wrap.appendChild(el('p', 'hint', hint));
  const err = el('p', 'field-error');
  // Поле пересоздаётся при каждой перерисовке, поэтому состояние ошибки
  // восстанавливаем из сырого текста, а не держим в самом элементе.
  err.textContent = dateFieldError(input.value);
  if (err.textContent) input.classList.add('invalid');
  wrap.appendChild(err);

  attachDateMask(input, (el2, parsed) => commitDateInput(id, el2, err, parsed));
  return { wrap, input };
}

// Панель неполного узла: приглашение уточнить, а не пустая форма.
function renderIncompleteNode(node) {
  const box = el('div', 'invite');
  box.appendChild(el('h2', null, node.title));
  box.appendChild(el('p', 'reason', node.reason));
  for (const m of node.missing_inputs) box.appendChild(inviteFieldOrPointer(m.id));
  if (!node.missing_inputs.length) {
    box.appendChild(el('p', 'hint', 'Данных для расчёта пока недостаточно.'));
  }
  return box;
}

// --- Экспорт .ics -----------------------------------------------------------

let currentIcsTerms = []; // рассчитанные сроки с ics:true для кнопки «Скачать»


function updateExportButtons() {
  const empty = currentIcsTerms.length === 0;
  for (const id of ['download-ics', 'copy-terms', 'print-terms']) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = empty;
  }
}

// Текстовый список в буфер обмена. clipboard.writeText есть не везде (и требует
// защищённого соединения), поэтому при отказе — запасной путь через выделение
// временного поля.
async function copyTerms() {
  if (currentIcsTerms.length === 0) return;
  const text = termsAsText(currentIcsTerms, {
    today,
    situation: situationById(state.situation).label,
  });

  let ok = true;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    ok = copyViaSelection(text);
  }
  showCopyStatus(ok ? 'Скопировано' : 'Не удалось скопировать');
}

function copyViaSelection(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

let copyStatusTimer = null;
function showCopyStatus(message) {
  const box = document.getElementById('copy-status');
  if (!box) return;
  box.textContent = message;
  clearTimeout(copyStatusTimer);
  copyStatusTimer = setTimeout(() => {
    box.textContent = '';
  }, 3000);
}

// Печатная версия: заголовок с датой расчёта — остальное убирает CSS печати.
function printTerms() {
  if (currentIcsTerms.length === 0) return;
  window.print();
}

function renderPrintHeader(situation) {
  const box = document.getElementById('print-header');
  if (!box) return;
  box.textContent = '';
  box.appendChild(el('div', 'print-title', 'Процессуальные сроки по ГПК РФ'));
  box.appendChild(
    el('div', 'print-meta', `${situation.label} · расчёт от ${isoToRu(today)}`),
  );
}

const ICS_FILENAME = 'gpk-sroki.ics';

// Тип с charset — для скачивания файлом; для File в «Поделиться» параметр
// убираем: часть реализаций canShare не распознаёт тип с параметрами.
const ICS_TYPE_DOWNLOAD = 'text/calendar;charset=utf-8';
const ICS_TYPE_FILE = 'text/calendar';

async function downloadICS() {
  if (currentIcsTerms.length === 0) return;
  const ics = buildICS(currentIcsTerms, { referenceDate: today, now: new Date() });

  // iOS Safari не выполняет атрибут download у blob:-ссылки: она открывает
  // содержимое предпросмотром, и добавить события в календарь оттуда нельзя —
  // тип файла при этом ни при чём. Системный лист «Поделиться» такую
  // возможность даёт: Календарь в нём есть.
  const file = new File([ics], ICS_FILENAME, { type: ICS_TYPE_FILE });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      // Пользователь закрыл лист — это не сбой, скачивать вдогонку не нужно.
      if (err && err.name === 'AbortError') return;
      // Остальное (лист недоступен, отказ платформы) — уходим на скачивание.
    }
  }

  const blob = new Blob([ics], { type: ICS_TYPE_DOWNLOAD });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = ICS_FILENAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Освобождать ссылку в том же кадре нельзя: Safari успевает прервать
  // начатое скачивание. Пара сотен байт подождут.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// --- Главный рендер ---------------------------------------------------------

// Расчёт идёт по каждому вводу, а render() пересобирает поля заново — без
// восстановления фокуса каретка выпадала бы из поля на каждом нажатии.
// Поля адресуются по устойчивым id (`in-<input>`), поэтому хватает id и позиции
// каретки.
function captureFocus() {
  const active = document.activeElement;
  if (!active || active.tagName !== 'INPUT' || !active.id) return null;
  return { id: active.id, start: active.selectionStart, end: active.selectionEnd };
}

function restoreFocus(snapshot) {
  if (!snapshot) return;
  const next = document.getElementById(snapshot.id);
  if (!next || next === document.activeElement) return;
  next.focus();
  if (snapshot.start != null) next.setSelectionRange(snapshot.start, snapshot.end);
}

function render() {
  const focus = captureFocus();
  renderedFields.clear();
  const situation = situationById(state.situation);
  const visible = new Set(situation.nodes);

  // Расчёт от выбора ситуации не зависит: buildView по-прежнему считает все
  // ветви, переключатель лишь решает, что показать и что выгрузить.
  const view = buildView(state.inputs, { today });

  // Какие поля относятся к истёкшим срокам — от этого зависит формулировка их
  // подписей и приглашений.
  expiredFields.clear();
  for (const card of view.cards) {
    if (card.status !== 'expired') continue;
    const field = ACTION_FACT_INPUT[card.id];
    if (field) expiredFields.add(field);
  }

  const visibleCards = view.cards.filter((c) => visible.has(c.id));
  currentIcsTerms = icsTermsFromView({ cards: visibleCards });
  exportableIds.clear();
  for (const { card } of exportableCards({ cards: visibleCards })) exportableIds.add(card.id);
  updateExportButtons();
  renderPrintHeader(situation);

  renderSituationSwitch(situation);
  renderPrimaryField(situation);
  renderSituationFields(situation, Boolean(state.inputs[situation.primary_field]));

  const root = document.getElementById('results');
  root.textContent = '';

  // Без даты мотивированного решения цепочка общего порядка не считается.
  // Приглашение показываем только там, где эта дата и спрашивается.
  const chainAvailable = Boolean(state.inputs.reasoned_decision_date);
  if (!chainAvailable && situation.primary_field) {
    root.appendChild(
      el('p', 'empty', 'Введите дату мотивированного решения — появятся сроки цепочки обжалования.'),
    );
  }

  const cardById = (id) => view.cards.find((n) => n.id === id);
  const incById = (id) => view.incomplete.find((n) => n.id === id);

  // Ветвь not_appealed: событие разрешено, но жалоба не вводилась —
  // расчёт держится на предположении об отсутствии обжалования.
  const entry = cardById('entry_into_force');
  const notAppealedAssumption =
    !state.inputs.appeal_filed_date && entry && entry.status === 'resolved';

  for (const id of situation.nodes) {
    const card = cardById(id);
    if (card) {
      if (id === 'entry_into_force' && card.kind === 'event') {
        const opts = {};
        if (notAppealedAssumption) {
          opts.assumptionNote =
            'Расчёт исходит из предположения, что апелляционная жалоба не подавалась.';
        }
        const eventEl = renderEvent(card, opts);
        appendFollowUpFields(eventEl, id, card);
        root.appendChild(eventEl);
      } else if (card.kind === 'notice') {
        root.appendChild(renderNoticeCard(card));
      } else if (card.kind === 'event') {
        const eventEl = renderEvent(card);
        appendFollowUpFields(eventEl, id, card);
        root.appendChild(eventEl);
      } else {
        const opts = {};
        if (id === 'cassation_ksoyu' && notAppealedAssumption) {
          opts.conditionBadge = true;
          opts.conditionNote =
            'Действует при том же условии — что решение не обжаловалось в апелляции.';
        }
        const termEl = renderTermCard(card, opts);
        const redField = REDACTION_FIELD[id];
        if (redField) termEl.appendChild(renderRedactionField(redField));
        // На карточке замечаний — необязательная дата их подачи: от неё
        // считается срок рассмотрения судьёй (ч. 2 ст. 232).
        if (id === 'protocol_remarks') {
          const box = el('div', 'note');
          box.appendChild(
            el('div', null, 'Замечания уже поданы? Укажите дату — уточнится срок их рассмотрения.'),
          );
          box.appendChild(inviteFieldOrPointer('protocol_remarks_filed_date'));
          termEl.appendChild(box);
        }
        // После срока кассации в КСОЮ — приглашение ввести дату определения КСОЮ,
        // которое открывает узел кассации в ВС (condition: ksoyu_ruling_date).
        // Мировой судья: явка участника — влияет на длительность срока (3/15).
        if (id === 'mirovoy_reasoned_request') {
          const box = el('div', 'note');
          box.appendChild(
            renderChoiceField(
              'mirovoy_attendance',
              [
                { value: 'present', label: 'Присутствовал — 3 рабочих дня (п. 1 ч. 4 ст. 199)' },
                { value: 'absent', label: 'Не присутствовал — 15 рабочих дней (п. 2 ч. 4 ст. 199)' },
              ],
              state.inputs.mirovoy_attendance || 'present',
            ),
          );
          termEl.appendChild(box);
        }
        // Заочное решение: кто обжалует — влияет на точку отсчёта апелляции.
        if (id === 'default_judgment_cancellation_request') {
          const box = el('div', 'note');
          box.appendChild(
            renderChoiceField(
              'default_judgment_subject',
              [
                { value: 'defendant', label: 'Ответчик (абз. 1 ч. 2 ст. 237)' },
                { value: 'other_persons', label: 'Иные лица (абз. 2 ч. 2 ст. 237)' },
              ],
              state.inputs.default_judgment_subject || 'defendant',
            ),
          );
          termEl.appendChild(box);
        }
        // Заглушки рядом с узлом (напр. предъявление ИЛ).
        if (card.stubs) termEl.appendChild(renderRelatedStubs(card.stubs));
        appendFollowUpFields(termEl, id, card);
        root.appendChild(termEl);
      }
      continue;
    }
    // Пока нет даты решения, приглашения по цепочке общего порядка не плодим:
    // поле для неё уже есть наверху страницы. Приглашения независимых ветвей
    // (рабочие дни, упрощённое, заочное) от этого не зависят и показываются.
    if (!chainAvailable && GENERAL_CHAIN_NODES.has(id)) continue;
    const inc = incById(id);
    if (inc) {
      const incEl = renderIncompleteNode(inc);
      const redField = REDACTION_FIELD[id];
      if (redField) incEl.appendChild(renderRedactionField(redField));
      appendFollowUpFields(incEl, id, inc);
      root.appendChild(incEl);
    }
  }

  // Ветвь выбрана, но данных ещё нет — на экране не должно быть пусто без
  // объяснения. У общей ветви приглашение уже показано выше.
  if (!root.childElementCount && !situation.primary_field) {
    const first = situation.fields[0];
    root.appendChild(
      el('p', 'empty', `Укажите ${askFor(first)} — появятся сроки.`),
    );
  }

  restoreFocus(focus);
}

// Необязательные поля-уточнения, привязанные к конкретной карточке: ввод даты
// меняет расчёт соседних узлов (упрощённое производство, глава 21.1).
// Необязательные поля-уточнения, привязанные к карточке.
//
// Правило размещения: поле стоит у того узла, о документе которого идёт речь,
// а не у срока, на который оно влияет. Дата подачи апелляционной жалобы меняет
// момент вступления решения в силу — значит, её место у вступления в силу, а не
// в карточке кассации, куда она попадала как «недостающие данные».
//
// Каждый узел перечисляет свои поля; `when` откладывает вопрос до момента,
// когда он осмыслен.
const FOLLOW_UP_FIELDS = {
  entry_into_force: {
    prompt: () => {
      // Когда дата подачи уже введена, спрашивать «жалоба подана?» поздно —
      // блок становится просто набором дат по апелляции.
      if (state.inputs.appeal_filed_date) return 'Данные об апелляционном обжаловании.';
      return expiredFields.has('appeal_filed_date')
        ? 'Жалоба уже подана? Укажите дату — расчёт пойдёт от апелляционного определения.'
        : 'Апелляционная жалоба подана? Укажите дату — от неё зависит момент вступления решения в силу.';
    },
    fields: [
      { id: 'appeal_filed_date' },
      // Мотивированное апелляционное определение — тот же документ, что и само
      // определение выше: спрашиваем их рядом, а не в карточке кассации.
      { id: 'appeal_ruling_reasoned_date', when: () => Boolean(state.inputs.appeal_filed_date) },
    ],
  },
  cassation_ksoyu: {
    prompt: 'Определение КСОЮ уже вынесено? Укажите дату — появится срок кассации в ВС РФ.',
    fields: [
      { id: 'ksoyu_ruling_date' },
      // Мотивированное определение КСОЮ — про тот же документ, что и строка выше.
      { id: 'ksoyu_ruling_reasoned_date', when: () => Boolean(state.inputs.ksoyu_ruling_date) },
    ],
  },
  simplified_reasoned_request: {
    prompt: 'Заявление уже подано? Укажите дату — появится срок изготовления решения.',
    fields: [{ id: 'simplified_reasoned_request_date' }],
  },
  simplified_reasoned_making: {
    prompt: 'Мотивированное решение составлено? Укажите дату — срок на апелляцию будет считаться от неё.',
    fields: [{ id: 'simplified_reasoned_date' }],
  },
  simplified_entry_into_force: {
    prompt: 'Апелляционная жалоба подана? Укажите дату (ч. 7 ст. 232.4).',
    fields: [
      { id: 'simplified_appeal_filed_date' },
      {
        id: 'simplified_appeal_ruling_date',
        when: () => Boolean(state.inputs.simplified_appeal_filed_date),
      },
    ],
  },
  default_judgment_cancellation_request: {
    prompt: 'Заявление об отмене подано? Укажите дату.',
    fields: [
      { id: 'default_judgment_cancellation_request_date' },
      // Определение по заявлению — про тот же документ, поэтому спрашиваем здесь,
      // а не в карточке апелляционного срока, на который оно влияет. Без условия:
      // у ответчика месячный срок считается именно от него, и это самый частый
      // известный факт.
      { id: 'default_judgment_refusal_date' },
      // Удовлетворение — редкий исход, спрашиваем после того, как заявление подано.
      {
        id: 'default_judgment_cancellation_date',
        when: () => Boolean(state.inputs.default_judgment_cancellation_request_date),
      },
    ],
  },
  default_judgment_entry_into_force: {
    prompt: 'Заочное решение обжаловано в апелляции? Укажите дату подачи жалобы (ч. 1 ст. 244).',
    fields: [
      { id: 'default_judgment_appeal_filed_date' },
      {
        id: 'default_judgment_appeal_ruling_date',
        when: () => Boolean(state.inputs.default_judgment_appeal_filed_date),
      },
    ],
  },
  mirovoy_reasoned_request: {
    prompt: 'Заявление уже подано? Укажите дату — появится срок составления решения.',
    fields: [{ id: 'mirovoy_request_date' }],
  },
  mirovoy_reasoned_making: {
    prompt: 'Мотивированное решение составлено? Укажите дату — срок на апелляцию будет считаться от неё.',
    fields: [{ id: 'mirovoy_reasoned_date' }],
  },
  mirovoy_appeal: {
    prompt: 'Дело прошло апелляцию в районном суде? Укажите дату мотивированного определения.',
    fields: [{ id: 'mirovoy_appeal_ruling_reasoned_date' }],
  },
};

function appendFollowUpFields(cardEl, id, card) {
  const spec = FOLLOW_UP_FIELDS[id];
  if (!spec) return;
  // В состоянии not_applicable узла нет вовсе — уточняющие поля к нему ничего
  // не меняют, спрашивать не о чем.
  if (card && card.status === 'not_applicable') return;

  const fields = spec.fields.filter((f) => !f.when || f.when());
  if (!fields.length) return;

  const box = el('div', 'note');
  box.appendChild(el('div', null, typeof spec.prompt === 'function' ? spec.prompt() : spec.prompt));
  for (const f of fields) box.appendChild(inviteFieldOrPointer(f.id));
  cardEl.appendChild(box);
}

// Карточка-пометка: расчёт сознательно не выполняется (нет текста нормы).
// Сейчас таких узлов нет — ст. 244 раскрыта событием. Механизм оставлен: это
// UI-выражение правила раздела 9 SPEC, и он понадобится следующему узлу, для
// которого текста нормы не окажется.
function renderNoticeCard(card) {
  const c = el('div', 'card notice-card');
  c.appendChild(el('div', 'kicker', 'Не рассчитывается'));
  c.appendChild(el('h2', null, card.title));
  c.appendChild(el('div', 'deadline', '—'));
  c.appendChild(el('div', 'norm', card.norm));
  c.appendChild(el('div', 'warn', card.reason));
  return c;
}

// Поле выбора (не дата): например, субъект обжалования заочного решения.
function renderChoiceField(id, options, current) {
  const wrap = el('div', 'field');
  const lab = el('label', null, INPUT_LABELS[id]);
  lab.setAttribute('for', `in-${id}`);
  wrap.appendChild(lab);
  const select = el('select');
  select.id = `in-${id}`;
  for (const opt of options) {
    const o = el('option', null, opt.label);
    o.value = opt.value;
    if (opt.value === current) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener('change', () => {
    state.inputs[id] = select.value;
    render();
  });
  wrap.appendChild(select);
  return wrap;
}

// Какой input выбирает редакцию нормы (а для дел мировых судей — ещё и
// маршрут: КСОЮ либо президиум областного суда) на кассационных узлах.
const REDACTION_FIELD = {
  cassation_ksoyu: 'cassation_filed_date',
  cassation_vs: 'vs_cassation_filed_date',
  mirovoy_cassation: 'cassation_filed_date',
};

// Один и тот же input может относиться к нескольким узлам: cassation_filed_date
// — и к кассации общего порядка, и к кассации по делам мировых судей; дата
// подачи апелляционной жалобы нужна и вступлению в силу, и кассации как
// недостающие данные. Поле рисуем один раз за проход — иначе получатся два
// элемента с одинаковым id (так уже ломалась карточка президиума областного
// суда). Первым его забирает тот узел, который идёт выше по экрану.
const renderedFields = new Set();

function fieldAlreadyRendered(id) {
  if (renderedFields.has(id)) return true;
  renderedFields.add(id);
  return false;
}

// Поле для узла: либо само поле, либо ссылка на то место, где оно уже показано.
function inviteFieldOrPointer(id) {
  if (fieldAlreadyRendered(id)) {
    // Узел, забравший поле, не всегда «предыдущий срок» — это может быть и
    // строка вступления в силу, поэтому формулировка нейтральная.
    return el('p', 'hint', `Поле «${INPUT_LABELS[id]}» — выше на этой странице.`);
  }
  return renderInviteField(id).wrap;
}

// Необязательное поле даты подачи — выбирает редакцию нормы (ч. 3 ст. 1 ГПК).
// Без него редакция берётся по текущей дате.
function renderRedactionField(inputId) {
  const box = el('div', 'note');
  box.appendChild(
    el(
      'div',
      null,
      'Если жалоба уже подана, укажите дату — от неё зависит редакция нормы и суд, ' +
        'в который она подаётся.',
    ),
  );
  if (fieldAlreadyRendered(inputId)) {
    // Поле уже показано выше на другом узле — не дублируем, а ссылаемся.
    box.appendChild(
      el('p', 'hint', 'Это поле находится выше, в карточке предыдущего срока.'),
    );
  } else {
    box.appendChild(renderInviteField(inputId).wrap);
  }
  return box;
}

// Ввод даты определения КСОЮ открывает узел кассации в ВС РФ (ст. 390.3).
// Дату мотивированного определения запрашивает уже сам узел ВС (новая редакция).
function stubCard(s) {
  const box = el('div', 'stub');
  box.appendChild(el('h3', null, s.title));
  box.appendChild(el('p', null, s.explanation));
  box.appendChild(el('p', 'norm', s.norm));
  return box;
}

// Заглушки рядом с узлом — отдельными карточками (напр. смежные случаи ИЛ).
function renderRelatedStubs(stubs) {
  const box = el('div', 'related-stubs');
  box.appendChild(el('h3', 'related-stubs-title', 'Смежные случаи'));
  for (const s of stubs) box.appendChild(stubCard(s));
  return box;
}

// --- Другие сроки: независимые узлы на своих input ---------------------------
//
// Замечания на протокол и частная жалоба не зависят от цепочки обжалования —
// у каждого свой триггер-input. Поля всегда видимы; узлы появляются в
// результатах после ввода даты.

// Переключатель ситуации — всегда виден, наверху формы. Радиокнопки в
// <fieldset>: с клавиатуры это стрелки, а не Tab по пяти кнопкам.
function renderSituationSwitch(current) {
  const root = document.getElementById('situation');
  if (root.dataset.rendered === 'yes') {
    // Разметка статична — перерисовывать нечего, только отметить выбранное.
    for (const input of root.querySelectorAll('input[type=radio]')) {
      input.checked = input.value === current.id;
      input.closest('label').classList.toggle('active', input.value === current.id);
    }
    return;
  }
  root.textContent = '';
  const fs = el('fieldset', 'situations');
  fs.appendChild(el('legend', null, 'Какая у вас ситуация'));
  const row = el('div', 'situation-row');
  for (const s of SITUATIONS) {
    const label = el('label', s.id === current.id ? 'situation active' : 'situation');
    const input = el('input');
    input.type = 'radio';
    input.name = 'situation';
    input.value = s.id;
    input.checked = s.id === current.id;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      // Введённые данные живут в state.inputs и rawDates и переключение их не
      // трогает: скрытая ветвь при возврате показывает те же значения.
      state.situation = input.value;
      render();
    });
    label.appendChild(input);
    label.appendChild(el('span', null, s.label));
    row.appendChild(label);
  }
  fs.appendChild(row);
  root.appendChild(fs);
  root.dataset.rendered = 'yes';
}

// Поле даты мотивированного решения — статическое, в разметке страницы: маска
// к нему привязана один раз при инициализации. Прячем его вне общей ветви,
// значение при этом сохраняется.
function renderPrimaryField(situation) {
  const box = document.querySelector('section.primary');
  box.hidden = !situation.primary_field;
}

// Поля ввода выбранной ситуации.
//
// У общей ветви исходное поле статическое и стоит наверху, а её `vs_ruling_date`
// — уточнение, ему место под карточками. У остальных ветвей поле в `fields` и
// есть исходные данные: оно должно стоять над карточками, иначе пользователь
// попадает на пустой экран и не видит, куда вводить.
//
// Блок уточняющих дат показывается только после заполнения основного поля
// ветви. На пустой форме общего порядка дата определения коллегии ВС — это
// четыре инстанции вперёд, и на первом экране она только сбивает с толку.
//
// Исключение — уже введённое значение: иначе, очистив основное поле, можно
// остаться с карточкой надзора на экране и без поля, которым её правят.
function renderSituationFields(situation, primaryFilled) {
  const top = document.getElementById('situation-inputs');
  const bottom = document.getElementById('other-terms');
  const root = situation.primary_field ? bottom : top;
  const other = situation.primary_field ? top : bottom;

  other.textContent = '';
  other.hidden = true;
  root.textContent = '';
  const hasOwnValue = situation.fields.some((id) => state.inputs[id] != null);
  if (!situation.fields.length || (situation.primary_field && !primaryFilled && !hasOwnValue)) {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  root.appendChild(
    el('h2', null, situation.primary_field ? 'Дополнительные даты' : 'Исходные данные'),
  );
  if (situation.id === 'separate') {
    root.appendChild(
      el(
        'p',
        null,
        'Сроки в рабочих днях (абз. 2 ч. 3 ст. 107 ГПК) — считаются независимо от ' +
          'цепочки обжалования. Заполните нужную дату.',
      ),
    );
  }
  const box = el('div', 'invite');
  for (const id of situation.fields) box.appendChild(inviteFieldOrPointer(id));
  root.appendChild(box);
}

// --- Заглушки (раздел 4.4) — статичны, рисуем один раз -----------------------

function renderStubs() {
  const view = buildView({}, { today });
  const root = document.getElementById('stubs');
  root.textContent = '';
  // Все ветви раскрыты — блока «неподдерживаемые» больше нет; заголовок без
  // содержимого не рисуем.
  if (!view.stubs.length) return;
  root.appendChild(el('h2', null, 'Неподдерживаемые ветки'));
  for (const s of view.stubs) root.appendChild(stubCard(s));
}

// --- Инициализация ----------------------------------------------------------

const reasoned = document.getElementById('reasoned');
const reasonedError = document.getElementById('reasoned-error');
attachDateMask(reasoned, (input, parsed) =>
  commitDateInput('reasoned_decision_date', input, reasonedError, parsed),
);

const downloadBtn = document.getElementById('download-ics');
if (downloadBtn) downloadBtn.addEventListener('click', downloadICS);
const copyBtn = document.getElementById('copy-terms');
if (copyBtn) copyBtn.addEventListener('click', copyTerms);
const printBtn = document.getElementById('print-terms');
if (printBtn) printBtn.addEventListener('click', printTerms);

renderStubs();
render();
