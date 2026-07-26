// Интерфейс (раздел 8, задача 4б SPEC.md). Поверх buildView, без изменения
// логики: приложение только читает даты, вызывает buildView и рисует результат.

import { buildView } from '../src/views.js';
import { buildICS } from '../src/ics.js';
import {
  APPEAL_GENERAL,
  CASSATION_KSOYU,
  CASSATION_VS,
  ENFORCEMENT_PRESENTATION,
  PROTOCOL_REMARKS,
  PRIVATE_COMPLAINT,
} from '../src/chain.js';

// Метаданные экспортируемых сроков (ics/duration) — по id карточки.
const ICS_META = {
  [APPEAL_GENERAL.id]: APPEAL_GENERAL,
  [CASSATION_KSOYU.id]: CASSATION_KSOYU,
  [CASSATION_VS.id]: CASSATION_VS,
  [ENFORCEMENT_PRESENTATION.id]: ENFORCEMENT_PRESENTATION,
  [PROTOCOL_REMARKS.id]: PROTOCOL_REMARKS,
  [PRIVATE_COMPLAINT.id]: PRIVATE_COMPLAINT,
};

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
};
const INPUT_HINTS = {
  appeal_filed_date: 'Если жалоба подавалась',
  appeal_ruling_date: 'Дата оглашения апелляционного определения',
  appeal_ruling_reasoned_date: 'Если не откладывалось — совпадает с датой принятия',
  cassation_filed_date: 'Определяет редакцию нормы (отсечка 01.09.2024); по умолчанию — текущая дата',
  ksoyu_ruling_date: 'После её ввода появляется срок кассации в ВС РФ',
  ksoyu_ruling_reasoned_date: 'Отложение до 10 дней (ч. 7 ст. 390.1); если не откладывалось — совпадает с датой вынесения',
  vs_cassation_filed_date: 'Определяет редакцию нормы (отсечка 01.09.2024); по умолчанию — текущая дата',
  protocol_signed_date: 'Срок 5 рабочих дней (ч. 1 ст. 231 ГПК)',
  protocol_remarks_filed_date: 'Если не указана — срок рассмотрения считается от последнего дня подачи',
  interim_ruling_date: 'Срок 15 рабочих дней (ст. 332 ГПК)',
};

const CHAIN_ORDER = [
  'appeal_general',
  'entry_into_force',
  'cassation_ksoyu',
  'cassation_vs',
  'enforcement_presentation',
  'protocol_remarks',
  'protocol_remarks_review',
  'private_complaint',
];

// --- Состояние --------------------------------------------------------------

const state = { inputs: {} };
const today = todayISO();

// --- Даты: формат ДД.ММ.ГГГГ ↔ ISO ------------------------------------------

function pad(n) { return String(n).padStart(2, '0'); }

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoToRu(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// 'ДД.ММ.ГГГГ' → 'YYYY-MM-DD' | null (с проверкой реальности даты).
function ruToISO(str) {
  const m = String(str).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null; // напр. 31.02.2025
  }
  return `${y}-${pad(mo)}-${pad(d)}`;
}

function pluralDays(n) {
  const t = n % 10, h = n % 100;
  if (t === 1 && h !== 11) return 'день';
  if (t >= 2 && t <= 4 && !(h >= 12 && h <= 14)) return 'дня';
  return 'дней';
}

// Автоформатирование ввода: цифры → ДД.ММ.ГГГГ.
function attachDateMask(input, onCommit) {
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 8);
    let out = digits;
    if (digits.length > 4) out = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
    else if (digits.length > 2) out = `${digits.slice(0, 2)}.${digits.slice(2)}`;
    input.value = out;
  });
  input.addEventListener('change', () => onCommit(input));
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

  if (card.status === 'missed') {
    c.appendChild(el('div', 'deadline missed', isoToRu(card.deadline)));
    c.appendChild(el('div', 'norm', card.norm));
    const days = card.overdue.days;
    c.appendChild(
      el('div', 'miss', `Срок пропущен на ${days} ${pluralDays(days)}. Восстановление — ${card.overdue.norm}.`),
    );
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
    for (const w of card.warnings) c.appendChild(el('div', 'warn', w.text));
  }

  if (card.calendar_warning) c.appendChild(el('div', 'warn', card.calendar_warning.text));

  if (card.boundary_warning) c.appendChild(renderBoundaryWarning(card.boundary_warning));

  if (card.alternative) c.appendChild(renderAlternative(card));

  if (card.details) c.appendChild(renderDetails(card.details));
  return c;
}

function renderBoundaryWarning(bw) {
  const box = el('div', 'warn');
  box.appendChild(
    el(
      'div',
      null,
      `По прежней редакции срок истёк ${isoToRu(bw.prev_redaction_deadline)}; ` +
        `по действующей (с ${isoToRu(bw.cutoff)}) истекает ${isoToRu(bw.current_deadline)}.`,
    ),
  );
  box.appendChild(el('div', null, bw.reason));
  return box;
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

function renderEventCard(card, opts = {}) {
  const c = el('div', 'card');
  c.appendChild(el('div', 'kicker', 'Событие'));
  c.appendChild(el('h2', null, card.title));

  if (card.status === 'pending') {
    c.appendChild(el('div', 'deadline', `не ранее ${isoToRu(card.not_earlier_than)}`));
  } else {
    c.appendChild(el('div', 'deadline', isoToRu(card.date)));
  }
  c.appendChild(el('div', 'norm', card.norm));

  if (opts.assumptionInvite) c.appendChild(opts.assumptionInvite);
  if (card.note) c.appendChild(el('div', 'warn', card.note));
  if (card.details) c.appendChild(renderDetails(card.details));
  return c;
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
  if (state.inputs[id]) input.value = isoToRu(state.inputs[id]);
  wrap.appendChild(input);
  if (INPUT_HINTS[id]) wrap.appendChild(el('p', 'hint', INPUT_HINTS[id]));
  const err = el('p', 'field-error');
  wrap.appendChild(err);

  attachDateMask(input, (el2) => {
    const raw = el2.value.trim();
    if (raw === '') {
      delete state.inputs[id];
      err.textContent = '';
      input.classList.remove('invalid');
      render();
      return;
    }
    const iso = ruToISO(raw);
    if (!iso) {
      err.textContent = 'Неверная дата. Формат ДД.ММ.ГГГГ.';
      input.classList.add('invalid');
      return;
    }
    err.textContent = '';
    input.classList.remove('invalid');
    state.inputs[id] = iso;
    render();
  });
  return { wrap, input };
}

// Панель неполного узла: приглашение уточнить, а не пустая форма.
function renderIncompleteNode(node) {
  const box = el('div', 'invite');
  box.appendChild(el('h2', null, node.title));
  box.appendChild(el('p', 'reason', node.reason));
  for (const m of node.missing_inputs) box.appendChild(renderInviteField(m.id).wrap);
  if (!node.missing_inputs.length) {
    box.appendChild(el('p', 'hint', 'Данных для расчёта пока недостаточно.'));
  }
  return box;
}

// --- Экспорт .ics -----------------------------------------------------------

let currentIcsTerms = []; // рассчитанные сроки с ics:true для кнопки «Скачать»

// Экспортируемые сроки из карточек: рассчитанные (есть дедлайн) и с ics:true.
function icsTermsFromView(view) {
  const out = [];
  for (const card of view.cards) {
    const meta = ICS_META[card.id];
    if (!meta || meta.ics !== true || !card.deadline) continue;
    out.push({
      title: card.title,
      deadline: card.deadline,
      norm: card.norm,
      ics: true,
      duration: meta.duration,
    });
  }
  return out;
}

function updateDownloadButton() {
  const btn = document.getElementById('download-ics');
  if (btn) btn.disabled = currentIcsTerms.length === 0;
}

function downloadICS() {
  if (currentIcsTerms.length === 0) return;
  const ics = buildICS(currentIcsTerms, { referenceDate: today, now: new Date() });
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'gpk-sroki.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --- Главный рендер ---------------------------------------------------------

function render() {
  const view = buildView(state.inputs, { today });
  currentIcsTerms = icsTermsFromView(view);
  updateDownloadButton();

  renderOtherTerms();

  const root = document.getElementById('results');
  root.textContent = '';

  if (!state.inputs.reasoned_decision_date) {
    root.appendChild(
      el('p', 'empty', 'Введите дату мотивированного решения — появятся рассчитанные сроки.'),
    );
    // Независимые сроки в рабочих днях от даты решения не зависят — показываем.
    for (const id of CHAIN_ORDER) {
      const card = view.cards.find((n) => n.id === id);
      if (card) root.appendChild(renderTermCard(card));
    }
    return;
  }

  const cardById = (id) => view.cards.find((n) => n.id === id);
  const incById = (id) => view.incomplete.find((n) => n.id === id);

  // Ветвь not_appealed: событие разрешено, но жалоба не вводилась —
  // расчёт держится на предположении об отсутствии обжалования.
  const entry = cardById('entry_into_force');
  const notAppealedAssumption =
    !state.inputs.appeal_filed_date && entry && entry.status === 'resolved';

  for (const id of CHAIN_ORDER) {
    const card = cardById(id);
    if (card) {
      if (id === 'entry_into_force' && card.kind === 'event') {
        const opts = {};
        if (notAppealedAssumption) {
          const invite = el('div', 'note');
          invite.appendChild(
            el(
              'div',
              null,
              'Расчёт исходит из предположения, что апелляционная жалоба не подавалась.',
            ),
          );
          const prompt = el('div', 'prompt');
          prompt.appendChild(el('label', null, 'Жалоба подавалась? Укажите дату подачи:'));
          prompt.appendChild(renderInviteField('appeal_filed_date').wrap);
          invite.appendChild(prompt);
          opts.assumptionInvite = invite;
        }
        root.appendChild(renderEventCard(card, opts));
      } else if (card.kind === 'event') {
        root.appendChild(renderEventCard(card));
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
          box.appendChild(renderInviteField('protocol_remarks_filed_date').wrap);
          termEl.appendChild(box);
        }
        // После срока кассации в КСОЮ — приглашение ввести дату определения КСОЮ,
        // которое открывает узел кассации в ВС (condition: ksoyu_ruling_date).
        if (id === 'cassation_ksoyu') termEl.appendChild(renderKsoyuRulingInvite());
        // Заглушки рядом с узлом (напр. предъявление ИЛ).
        if (card.stubs) termEl.appendChild(renderRelatedStubs(card.stubs));
        root.appendChild(termEl);
      }
      continue;
    }
    const inc = incById(id);
    if (inc) {
      const incEl = renderIncompleteNode(inc);
      const redField = REDACTION_FIELD[id];
      if (redField) incEl.appendChild(renderRedactionField(redField));
      root.appendChild(incEl);
    }
  }
}

// Какой input выбирает редакцию нормы на каждом кассационном узле.
const REDACTION_FIELD = {
  cassation_ksoyu: 'cassation_filed_date',
  cassation_vs: 'vs_cassation_filed_date',
};

// Необязательное поле даты подачи — выбирает редакцию нормы (ч. 3 ст. 1 ГПК).
// Без него редакция берётся по текущей дате.
function renderRedactionField(inputId) {
  const box = el('div', 'note');
  box.appendChild(
    el('div', null, 'Редакция нормы — по дате подачи жалобы (иначе по текущей дате).'),
  );
  box.appendChild(renderInviteField(inputId).wrap);
  return box;
}

// Ввод даты определения КСОЮ открывает узел кассации в ВС РФ (ст. 390.3).
// Дату мотивированного определения запрашивает уже сам узел ВС (новая редакция).
function renderKsoyuRulingInvite() {
  const box = el('div', 'note');
  box.appendChild(
    el('div', null, 'Определение КСОЮ уже вынесено? Укажите дату — появится срок кассации в ВС РФ.'),
  );
  box.appendChild(renderInviteField('ksoyu_ruling_date').wrap);
  return box;
}

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
const OTHER_TERM_FIELDS = ['protocol_signed_date', 'interim_ruling_date'];

function renderOtherTerms() {
  const root = document.getElementById('other-terms');
  root.textContent = '';
  root.appendChild(el('h2', null, 'Другие сроки'));
  root.appendChild(
    el(
      'p',
      null,
      'Сроки в рабочих днях (абз. 2 ч. 3 ст. 107 ГПК) — считаются независимо от ' +
        'цепочки обжалования. Заполните нужную дату.',
    ),
  );
  const box = el('div', 'invite');
  for (const id of OTHER_TERM_FIELDS) box.appendChild(renderInviteField(id).wrap);
  root.appendChild(box);
}

// --- Заглушки (раздел 4.4) — статичны, рисуем один раз -----------------------

function renderStubs() {
  const view = buildView({}, { today });
  const root = document.getElementById('stubs');
  root.appendChild(el('h2', null, 'Неподдерживаемые ветки'));
  for (const s of view.stubs) root.appendChild(stubCard(s));
}

// --- Инициализация ----------------------------------------------------------

const reasoned = document.getElementById('reasoned');
const reasonedError = document.getElementById('reasoned-error');
attachDateMask(reasoned, (input) => {
  const raw = input.value.trim();
  if (raw === '') {
    delete state.inputs.reasoned_decision_date;
    reasonedError.textContent = '';
    input.classList.remove('invalid');
    render();
    return;
  }
  const iso = ruToISO(raw);
  if (!iso) {
    reasonedError.textContent = 'Неверная дата. Формат ДД.ММ.ГГГГ.';
    input.classList.add('invalid');
    return;
  }
  reasonedError.textContent = '';
  input.classList.remove('invalid');
  state.inputs.reasoned_decision_date = iso;
  render();
});

const downloadBtn = document.getElementById('download-ics');
if (downloadBtn) downloadBtn.addEventListener('click', downloadICS);

renderStubs();
render();
