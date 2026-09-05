// Тест сборки карточек (раздел 8, задача 4а SPEC.md).
// Проверяем: для каждого набора входных данных структура содержит ровно те
// узлы, которые должны быть видны, и не содержит лишних.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildView, REVIEW_GROUNDS } from '../src/views.js';
import { icsTermsFromView } from '../src/ics.js';

const BASE = { reasoned_decision_date: '2025-03-11' }; // апелляция → 11.04.2025

const ids = (nodes) => nodes.map((n) => n.id);
const byId = (nodes, id) => nodes.find((n) => n.id === id);

test('заглушек в модели больше нет — все ветви раскрыты', () => {
  // Раскрыты: частная жалоба (3.1), упрощённое производство (3.2), заочное
  // решение (3.3), мировой судья без мотивировки (3.4).
  const v = buildView(BASE, { today: '2025-05-01' });
  assert.deepEqual(v.stubs, []);
});

test('нет даты мотивированного решения → нет карточек цепочки, узел в incomplete', () => {
  const v = buildView({}, { today: '2025-05-01' });
  assert.deepEqual(ids(v.cards), []);
  assert.deepEqual(ids(v.incomplete), ['appeal_general']);
  assert.deepEqual(
    v.incomplete[0].missing_inputs.map((m) => m.id),
    ['reasoned_decision_date'],
  );
});

test('pending: видны апелляция и событие; кассация — в incomplete', () => {
  const v = buildView(BASE, { today: '2025-04-01' }); // до дедлайна апелляции
  assert.deepEqual(ids(v.cards), ['appeal_general', 'entry_into_force']);
  assert.deepEqual(ids(v.incomplete), ['cassation_ksoyu']);

  const entry = byId(v.cards, 'entry_into_force');
  assert.equal(entry.status, 'pending');
  assert.equal(entry.date, null);
  assert.match(entry.message, /не ранее 2025-04-12/);

  const appeal = byId(v.cards, 'appeal_general');
  assert.equal(appeal.status, 'computed');
  assert.equal(appeal.deadline, '2025-04-11');
  assert.equal(appeal.details.collapsed, true); // «подробнее» свёрнут
  assert.ok(appeal.details.logic && appeal.details.midnight_rule);
});

test('not_appealed: видны все три узла, incomplete пуст', () => {
  const v = buildView(BASE, { today: '2025-05-01' }); // после дедлайна
  assert.deepEqual(ids(v.cards), [
    'appeal_general',
    'entry_into_force',
    'cassation_ksoyu',
    'enforcement_presentation',
  ]);
  assert.deepEqual(ids(v.incomplete), []);

  const entry = byId(v.cards, 'entry_into_force');
  assert.equal(entry.status, 'resolved');
  assert.equal(entry.date, '2025-04-12');

  const cass = byId(v.cards, 'cassation_ksoyu');
  assert.equal(cass.status, 'computed');
  assert.equal(cass.alternative, undefined);
});

test('appealed (полные данные): три узла, без alternative', () => {
  const v = buildView(
    {
      ...BASE,
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      appeal_ruling_reasoned_date: '2025-06-02',
    },
    { today: '2025-07-01' },
  );
  assert.deepEqual(ids(v.cards), [
    'appeal_general',
    'entry_into_force',
    'cassation_ksoyu',
    'enforcement_presentation',
  ]);
  assert.deepEqual(ids(v.incomplete), []);
  const cass = byId(v.cards, 'cassation_ksoyu');
  assert.equal(cass.deadline, '2025-09-02');
  assert.equal(cass.alternative, undefined);
});

test('appealed с расхождением дат: появляется alternative', () => {
  const v = buildView(
    {
      ...BASE,
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      appeal_ruling_reasoned_date: '2025-06-10',
    },
    { today: '2025-07-01' },
  );
  const cass = byId(v.cards, 'cassation_ksoyu');
  assert.ok(cass.alternative);
  assert.equal(cass.deadline, '2025-09-10');
  assert.equal(cass.alternative.recommended_deadline, '2025-09-02');
});

test('прежняя редакция: карточка кассации считается по дате принятия, без reasoned', () => {
  // Подача до 01.09.2024 → редакция от вступления в силу; мотивированное
  // определение не требуется, карточка рассчитывается, alternative нет.
  const v = buildView(
    {
      ...BASE,
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      cassation_filed_date: '2024-08-31',
    },
    { today: '2025-07-01' },
  );
  assert.deepEqual(ids(v.cards), [
    'appeal_general',
    'entry_into_force',
    'cassation_ksoyu',
    'enforcement_presentation',
  ]);
  assert.deepEqual(ids(v.incomplete), []);
  const cass = byId(v.cards, 'cassation_ksoyu');
  assert.equal(cass.version_id, 'before_135fz');
  assert.match(cass.norm, /до ФЗ № 135-ФЗ/);
  assert.equal(cass.alternative, undefined);
});

test('пограничное окно: карточка кассации несёт boundary_warning с обеими датами', () => {
  const v = buildView(
    {
      reasoned_decision_date: '2024-03-01',
      appeal_filed_date: '2024-03-20',
      appeal_ruling_date: '2024-05-15',
      appeal_ruling_reasoned_date: '2024-06-20',
      cassation_filed_date: '2024-09-15',
    },
    { today: '2024-10-01' },
  );
  const cass = byId(v.cards, 'cassation_ksoyu');
  assert.ok(cass.boundary_warning);
  assert.equal(cass.boundary_warning.prev_redaction_deadline, '2024-08-15');
  assert.equal(cass.boundary_warning.current_deadline, '2024-09-20');
  assert.equal(cass.deadline, '2024-09-20'); // расчёт — по действующей редакции
});

test('ИЛ: узел появляется при resolved, заглушек рядом не осталось; в pending — отсутствует', () => {
  const resolved = buildView(BASE, { today: '2025-05-01' }); // not_appealed → resolved
  const il = byId(resolved.cards, 'enforcement_presentation');
  assert.ok(il, 'узел ИЛ есть, когда вступление в силу разрешено');
  assert.match(il.norm, /229-ФЗ/);
  // Все три смежных случая раскрыты: судебный приказ и периодические платежи —
  // отдельными узлами, перерыв срока — сдвигом якоря (ст. 22). Блок пуст.
  assert.deepEqual(il.stubs, []);

  const pending = buildView(BASE, { today: '2025-04-01' }); // pending
  const allIds = [...pending.cards, ...pending.incomplete].map((n) => n.id);
  assert.ok(!allIds.includes('enforcement_presentation'), 'в pending узла ИЛ нет');
});

test('узел кассации в ВС появляется только после даты определения КСОЮ', () => {
  const withoutKsoyu = buildView(
    { ...BASE, appeal_filed_date: '2025-04-05', appeal_ruling_date: '2025-06-02', appeal_ruling_reasoned_date: '2025-06-02' },
    { today: '2025-07-01' },
  );
  const allIds = [...withoutKsoyu.cards, ...withoutKsoyu.incomplete].map((n) => n.id);
  assert.ok(!allIds.includes('cassation_vs'), 'без даты определения КСОЮ узла ВС нет');

  // Прежняя редакция (подача в ВС до 01.09.2024) → узел считается сразу от даты вынесения.
  const withKsoyu = buildView(
    {
      ...BASE,
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      appeal_ruling_reasoned_date: '2025-06-02',
      ksoyu_ruling_date: '2024-04-12',
      vs_cassation_filed_date: '2024-07-01',
    },
    { today: '2025-07-01' },
  );
  const vs = byId(withKsoyu.cards, 'cassation_vs');
  assert.ok(vs, 'с датой определения КСОЮ появляется карточка ВС');
  assert.equal(vs.version_id, 'before_135fz');
  assert.match(vs.norm, /390\.3/);
  assert.equal(vs.deadline, '2024-07-12');
});

test('узел ВС, новая редакция без мотивированного определения КСОЮ → incomplete', () => {
  const v = buildView(
    {
      ...BASE,
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      appeal_ruling_reasoned_date: '2025-06-02',
      ksoyu_ruling_date: '2025-05-01', // подача по умолчанию сегодня (2025) → новая редакция
    },
    { today: '2025-07-01' },
  );
  const vsInc = byId(v.incomplete, 'cassation_vs');
  assert.ok(vsInc);
  assert.deepEqual(vsInc.missing_inputs.map((m) => m.id), ['ksoyu_ruling_reasoned_date']);
});

test('новая редакция: норма — абз. 2 ч. 1 ст. 376.1', () => {
  const v = buildView(
    {
      ...BASE,
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      appeal_ruling_reasoned_date: '2025-06-02',
    },
    { today: '2025-07-01' },
  );
  const cass = byId(v.cards, 'cassation_ksoyu');
  assert.equal(cass.version_id, 'from_135fz');
  assert.match(cass.norm, /абз\. 2 ч\. 1 ст\. 376\.1/);
});

test('прежняя редакция без даты принятия: кассация incomplete без своего поля (поле — на событии)', () => {
  const v = buildView(
    { ...BASE, appeal_filed_date: '2025-04-05', cassation_filed_date: '2024-08-31' },
    { today: '2025-07-01' },
  );
  // событие ждёт дату принятия; кассация в прежней редакции зависит от неё же.
  assert.deepEqual(ids(v.incomplete), ['entry_into_force', 'cassation_ksoyu']);
  assert.deepEqual(
    byId(v.incomplete, 'entry_into_force').missing_inputs.map((m) => m.id),
    ['appeal_ruling_date'],
  );
  assert.deepEqual(byId(v.incomplete, 'cassation_ksoyu').missing_inputs, []);
});

test('appealed без дат определения: только апелляция; событие и кассация в incomplete', () => {
  const v = buildView({ ...BASE, appeal_filed_date: '2025-04-05' }, { today: '2025-07-01' });
  assert.deepEqual(ids(v.cards), ['appeal_general']);
  assert.deepEqual(ids(v.incomplete), ['entry_into_force', 'cassation_ksoyu']);
  assert.deepEqual(
    byId(v.incomplete, 'entry_into_force').missing_inputs.map((m) => m.id),
    ['appeal_ruling_date'],
  );
  assert.deepEqual(
    byId(v.incomplete, 'cassation_ksoyu').missing_inputs.map((m) => m.id),
    ['appeal_ruling_reasoned_date'],
  );
  // Оба недостающих поля должны быть доступны для ввода — каждое на своём узле,
  // без пустых missing_inputs (иначе поле не отрисуется в UI).
  for (const n of v.incomplete) {
    assert.ok(n.missing_inputs.length > 0, `${n.id}: должно быть недостающее поле`);
    for (const m of n.missing_inputs) assert.ok(m.label, `${m.id}: нужен label`);
  }
  const invited = v.incomplete.flatMap((n) => n.missing_inputs.map((m) => m.id));
  assert.deepEqual(invited.sort(), ['appeal_ruling_date', 'appeal_ruling_reasoned_date']);
});

test('appealed: введена только дата принятия определения → событие рассчитано, кассация ждёт мотивированного', () => {
  // Регрессия бага: раньше entry_into_force был incomplete с пустым
  // missing_inputs («данных недостаточно») и поле appeal_ruling_reasoned_date
  // висело только на кассации. Теперь дата принятия разрешает событие.
  const v = buildView(
    { ...BASE, appeal_filed_date: '2025-04-05', appeal_ruling_date: '2025-06-02' },
    { today: '2025-07-01' },
  );
  // Событие разрешено (есть дата принятия) → появляется и узел ИЛ.
  assert.deepEqual(ids(v.cards), ['appeal_general', 'entry_into_force', 'enforcement_presentation']);
  assert.deepEqual(ids(v.incomplete), ['cassation_ksoyu']);

  const entry = byId(v.cards, 'entry_into_force');
  assert.equal(entry.status, 'resolved');
  assert.equal(entry.date, '2025-06-02'); // дата принятия апелляционного определения

  // Кассация ждёт именно дату изготовления мотивированного определения,
  // и это непустое поле (а не «данных недостаточно»).
  const cass = byId(v.incomplete, 'cassation_ksoyu');
  assert.deepEqual(
    cass.missing_inputs.map((m) => m.id),
    ['appeal_ruling_reasoned_date'],
  );
});

test('просрочка: подача позже дедлайна → статус missed, дни, ст. 112', () => {
  const v = buildView({ ...BASE, appeal_filed_date: '2025-05-20' }, { today: '2025-07-01' });
  const appeal = byId(v.cards, 'appeal_general');
  assert.equal(appeal.status, 'missed');
  assert.equal(appeal.overdue.days, 39); // 11.04 → 20.05
  assert.match(appeal.overdue.norm, /112/);
});

test('предупреждение: мотивированное решение позже срока отложения (ч. 2 ст. 199)', () => {
  // Порог считается в рабочих днях: 10 рабочих дней от 11.03.2025 истекают
  // 25.03.2025. Изготовление 26.03 — нарушение.
  const over = buildView(
    { reasoned_decision_date: '2025-03-26', hearing_end_date: '2025-03-11' },
    { today: '2025-05-01' },
  );
  const appeal = byId(over.cards, 'appeal_general');
  assert.ok(appeal.warnings && appeal.warnings.length === 1);
  assert.equal(appeal.warnings[0].code, 'reasoned_over_delay');
  assert.equal(appeal.warnings[0].threshold_days, 10); // разбирательство в 2025 → новая редакция
  assert.equal(appeal.warnings[0].threshold_unit, 'working_day');
  assert.equal(appeal.warnings[0].allowed_deadline, '2025-03-25');
  assert.equal(appeal.warnings[0].actual_date, '2025-03-26');
});

test('порог в рабочих днях: 14 календарных дней укладываются в 10 рабочих', () => {
  // Тот же разрыв в календарных днях (14) нарушением не является: между
  // 11.03.2025 и 25.03.2025 ровно десять рабочих дней. При календарном счёте
  // предупреждение было бы ложным.
  const v = buildView(
    { reasoned_decision_date: '2025-03-25', hearing_end_date: '2025-03-11' },
    { today: '2025-05-01' },
  );
  assert.equal(byId(v.cards, 'appeal_general').warnings, undefined);
});

test('порог ч. 2 ст. 199 темпоральный: 5 дней до 01.09.2024, 10 — с 01.09.2024', () => {
  // Разрыв 7 дней: до отсечки это нарушение (порог 5), после — нет (порог 10).
  const before = buildView(
    { hearing_end_date: '2024-08-31', reasoned_decision_date: '2024-09-07' },
    { today: '2024-12-01' },
  );
  const beforeWarn = byId(before.cards, 'appeal_general').warnings;
  assert.ok(beforeWarn && beforeWarn.length === 1);
  assert.equal(beforeWarn[0].version_id, 'before_135fz');
  assert.equal(beforeWarn[0].threshold_days, 5);
  assert.match(beforeWarn[0].text, /до ФЗ № 135-ФЗ/);

  const after = buildView(
    { hearing_end_date: '2024-09-01', reasoned_decision_date: '2024-09-08' },
    { today: '2024-12-01' },
  );
  assert.equal(byId(after.cards, 'appeal_general').warnings, undefined);

  // За границей нового порога предупреждение снова появляется.
  const afterOver = buildView(
    { hearing_end_date: '2024-09-01', reasoned_decision_date: '2024-09-15' }, // 14 дней
    { today: '2024-12-01' },
  );
  const afterWarn = byId(afterOver.cards, 'appeal_general').warnings;
  assert.ok(afterWarn && afterWarn.length === 1);
  assert.equal(afterWarn[0].version_id, 'from_135fz');
  assert.equal(afterWarn[0].threshold_days, 10);
});

test('в пределах 10 дней — предупреждения нет', () => {
  const v = buildView(
    { reasoned_decision_date: '2025-03-18', hearing_end_date: '2025-03-11' }, // 7 дней
    { today: '2025-05-01' },
  );
  assert.equal(byId(v.cards, 'appeal_general').warnings, undefined);
});

test('карточки сроков в рабочих днях: появляются по своему input, помечены unit', () => {
  const v = buildView(
    { ...BASE, protocol_signed_date: '2025-12-28', interim_ruling_date: '2025-12-26' },
    { today: '2026-02-01' },
  );
  const remarks = byId(v.cards, 'protocol_remarks');
  const review = byId(v.cards, 'protocol_remarks_review');
  const complaint = byId(v.cards, 'private_complaint');

  assert.ok(remarks && review && complaint);
  assert.equal(remarks.unit, 'working_day');
  assert.equal(remarks.deadline, '2026-01-14');
  assert.equal(remarks.first_working_day, '2025-12-29'); // виден первый день течения
  assert.equal(review.informational, true); // срок суда — справочно
  assert.equal(complaint.deadline, '2026-01-28');
  assert.match(complaint.norm, /ст\. 332/);
});

test('независимые сроки видны без даты мотивированного решения', () => {
  const v = buildView({ interim_ruling_date: '2025-12-26' }, { today: '2026-02-01' });
  assert.deepEqual(ids(v.cards), ['private_complaint']);
  // цепочка при этом честно помечена как нерассчитанная
  assert.deepEqual(ids(v.incomplete), ['appeal_general']);
});

test('упрощённое производство: три карточки без заявления, событие по ст. 232.4', () => {
  const v = buildView({ simplified_resolution_date: '2025-12-22' }, { today: '2026-03-01' });
  assert.deepEqual(ids(v.cards), [
    'simplified_reasoned_request',
    'simplified_appeal',
    'simplified_entry_into_force',
    'simplified_cassation_ksoyu',
    'simplified_enforcement_presentation',
  ]);

  // Кассация в КСОЮ: не обжаловалось → предупреждение об исчерпании (3.7).
  const cass = byId(v.cards, 'simplified_cassation_ksoyu');
  assert.match(cass.norm, /ст\. 376\.1/);
  assert.ok(cass.exhaustion_warning, 'предупреждение об исчерпании для упрощённого');
  const appeal = byId(v.cards, 'simplified_appeal');
  assert.equal(appeal.unit, 'working_day');
  assert.equal(appeal.deadline, '2026-01-22');
  assert.match(appeal.note, /не составлялось/);

  const entry = byId(v.cards, 'simplified_entry_into_force');
  assert.equal(entry.kind, 'event');
  assert.equal(entry.status, 'resolved');
  assert.match(entry.norm, /232\.4/);
  assert.match(entry.norm, /ч\. 5/);

  // Предъявление ИЛ — три года со дня вступления в силу (событие разрешено).
  const enf = byId(v.cards, 'simplified_enforcement_presentation');
  assert.equal(enf.deadline, '2029-01-23'); // 2026-01-23 (дата события) + 3 года
  assert.match(enf.norm, /ст\. 21 ФЗ .*229-ФЗ/);
});

test('упрощённое: срок изготовления появляется после заявления, помечен справочным', () => {
  const v = buildView(
    { simplified_resolution_date: '2025-12-22', simplified_reasoned_request_date: '2025-12-24' },
    { today: '2026-03-01' },
  );
  const making = byId(v.cards, 'simplified_reasoned_making');
  assert.ok(making);
  assert.equal(making.informational, true);
  assert.equal(making.deadline, '2026-01-19');
});

test('упрощённое, ч. 7: событие не разрешено, показывает норму и чего не хватает', () => {
  const v = buildView(
    { simplified_resolution_date: '2025-12-22', simplified_appeal_filed_date: '2026-01-20' },
    { today: '2026-03-01' },
  );
  const entry = byId(v.cards, 'simplified_entry_into_force');
  assert.equal(entry.status, 'pending');
  assert.equal(entry.date, null);
  assert.match(entry.norm, /ч\. 7/);
  assert.match(entry.note, /Укажите дату/);
});

test('заочное решение: карточки, выбор субъекта и событие ст. 244', () => {
  const v = buildView(
    { default_judgment_service_date: '2025-12-22', default_judgment_refusal_date: '2026-02-10' },
    { today: '2026-03-01' },
  );
  assert.deepEqual(ids(v.cards), [
    'default_judgment_cancellation_request',
    'default_judgment_appeal',
    'default_judgment_entry_into_force',
    'default_judgment_cassation_ksoyu',
    'default_judgment_enforcement_presentation',
  ]);

  // Кассация в КСОЮ: ответчик, заявление рассмотрено (отказ), но апелляции нет —
  // общее предупреждение об исчерпании (3.7).
  const cass = byId(v.cards, 'default_judgment_cassation_ksoyu');
  assert.match(cass.norm, /ст\. 376\.1/);
  assert.ok(cass.exhaustion_warning, 'у ответчика без апелляции — предупреждение об исчерпании');

  const request = byId(v.cards, 'default_judgment_cancellation_request');
  assert.equal(request.unit, 'working_day');
  assert.equal(request.deadline, '2026-01-12');

  const appeal = byId(v.cards, 'default_judgment_appeal');
  assert.equal(appeal.deadline, '2026-03-10');
  assert.match(appeal.norm, /абз\. 1 ч\. 2 ст\. 237/);

  // Вступление в силу — событие с ветвями, а не пометка о невозможности.
  const entry = byId(v.cards, 'default_judgment_entry_into_force');
  assert.equal(entry.kind, 'event');
  assert.equal(entry.status, 'resolved');
  assert.equal(entry.branch, 'refused_not_appealed');
  assert.match(entry.norm, /ч\. 1 ст\. 244/);
  assert.equal(entry.date, '2026-03-11');

  // Предъявление ИЛ — три года со дня вступления заочного решения в силу.
  const enf = byId(v.cards, 'default_judgment_enforcement_presentation');
  assert.equal(enf.deadline, '2029-03-12'); // 2026-03-11 + 3 года = вс 11.03.2029 → пн 12.03
  assert.match(enf.norm, /ст\. 21 ФЗ .*229-ФЗ/);
});

test('заочное решение: карточка ст. 244 в трёх ветвях и при отмене решения', () => {
  const base = { default_judgment_service_date: '2025-12-22' };

  // Ветвь 1 — не обжаловано (иные лица: срок известен без определения об отказе).
  const notAppealed = buildView(
    { ...base, default_judgment_subject: 'other_persons' },
    { today: '2026-03-01' },
  );
  const e1 = byId(notAppealed.cards, 'default_judgment_entry_into_force');
  assert.equal(e1.branch, 'not_appealed');
  assert.equal(e1.status, 'resolved');
  assert.equal(e1.date, '2026-02-13');

  // Та же ветвь у ответчика: срок считается от определения об отказе, его нет —
  // карточка показывает правило без даты.
  const defendant = buildView({ ...base }, { today: '2026-03-01' });
  const e1d = byId(defendant.cards, 'default_judgment_entry_into_force');
  assert.equal(e1d.branch, 'not_appealed');
  assert.equal(e1d.status, 'pending');
  assert.equal(e1d.date, null);
  assert.match(e1d.note, /определения об отказе/);

  // Ветвь 3 — обжаловано, без даты определения апелляции.
  const appealedNoRuling = buildView(
    {
      ...base,
      default_judgment_refusal_date: '2026-02-10',
      default_judgment_appeal_filed_date: '2026-03-02',
    },
    { today: '2026-04-01' },
  );
  const e3 = byId(appealedNoRuling.cards, 'default_judgment_entry_into_force');
  assert.equal(e3.branch, 'appealed');
  assert.equal(e3.status, 'pending');
  assert.equal(e3.date, null);
  assert.match(e3.message, /после рассмотрения апелляционной жалобы/);

  // Ветвь 3 — с датой определения.
  const appealedWithRuling = buildView(
    {
      ...base,
      default_judgment_refusal_date: '2026-02-10',
      default_judgment_appeal_filed_date: '2026-03-02',
      default_judgment_appeal_ruling_date: '2026-06-15',
    },
    { today: '2026-07-01' },
  );
  const e3r = byId(appealedWithRuling.cards, 'default_judgment_entry_into_force');
  assert.equal(e3r.status, 'resolved');
  assert.equal(e3r.date, '2026-06-15');

  // Заявление об отмене удовлетворено — отдельное состояние, даты нет.
  const cancelled = buildView(
    {
      ...base,
      default_judgment_cancellation_request_date: '2026-01-09',
      default_judgment_cancellation_date: '2026-01-20',
    },
    { today: '2026-03-01' },
  );
  const ec = byId(cancelled.cards, 'default_judgment_entry_into_force');
  assert.equal(ec.branch, 'cancellation_granted');
  assert.equal(ec.status, 'not_applicable');
  assert.equal(ec.date, null);
  assert.match(ec.message, /отменено/);
});

test('заочное: без определения об отказе апелляция уходит в incomplete', () => {
  const v = buildView({ default_judgment_service_date: '2025-12-22' }, { today: '2026-03-01' });
  const inc = byId(v.incomplete, 'default_judgment_appeal');
  assert.ok(inc);
  assert.deepEqual(inc.missing_inputs.map((m) => m.id), ['default_judgment_refusal_date']);
  assert.ok(!ids(v.cards).includes('default_judgment_appeal'));
});

test('заочное, иные лица: карточка апелляции с другой нормой и точкой отсчёта', () => {
  const v = buildView(
    { default_judgment_service_date: '2025-12-22', default_judgment_subject: 'other_persons' },
    { today: '2026-03-01' },
  );
  const appeal = byId(v.cards, 'default_judgment_appeal');
  assert.equal(appeal.deadline, '2026-02-12');
  assert.match(appeal.norm, /абз\. 2 ч\. 2 ст\. 237/);
  assert.match(appeal.note, /не подавал/);
});

test('мировой судья: карточки ветви, выбор явки меняет срок', () => {
  const present = buildView({ mirovoy_resolution_date: '2025-12-22' }, { today: '2026-03-01' });
  // Срок апелляции истёк (today 01.03.2026 > 22.01.2026), поэтому появляется и
  // кассационный узел — от даты вступления решения в силу.
  assert.deepEqual(ids(present.cards), [
    'mirovoy_reasoned_request',
    'mirovoy_appeal',
    'mirovoy_entry_into_force',
    'mirovoy_cassation',
    'mirovoy_enforcement_presentation',
  ]);
  const req = byId(present.cards, 'mirovoy_reasoned_request');
  assert.equal(req.unit, 'working_day');
  assert.equal(req.deadline, '2025-12-25');

  // Не обжаловано (срок апелляции истёк) → вступление в силу и предъявление ИЛ.
  const entry = byId(present.cards, 'mirovoy_entry_into_force');
  assert.equal(entry.kind, 'event');
  assert.equal(entry.status, 'resolved');
  assert.equal(entry.branch, 'not_appealed');
  assert.equal(entry.date, '2026-01-23'); // дедлайн апелляции 22.01 + 1
  assert.match(entry.norm, /ч\. 1 ст\. 209/);
  const enf = byId(present.cards, 'mirovoy_enforcement_presentation');
  assert.equal(enf.deadline, '2029-01-23'); // + 3 года
  assert.match(enf.norm, /ст\. 21 ФЗ .*229-ФЗ/);

  const absent = buildView(
    { mirovoy_resolution_date: '2025-12-22', mirovoy_attendance: 'absent' },
    { today: '2026-03-01' },
  );
  assert.equal(byId(absent.cards, 'mirovoy_reasoned_request').deadline, '2026-01-22');

  const appeal = byId(present.cards, 'mirovoy_appeal');
  assert.equal(appeal.deadline, '2026-01-22');
  assert.match(appeal.note, /не составлялось/);
});

test('мировой судья: срок составления решения появляется после заявления', () => {
  const v = buildView(
    { mirovoy_resolution_date: '2025-12-22', mirovoy_request_date: '2025-12-25' },
    { today: '2026-03-01' },
  );
  const making = byId(v.cards, 'mirovoy_reasoned_making');
  assert.ok(making);
  assert.equal(making.informational, true);
  assert.equal(making.deadline, '2026-01-20');
});

test('надзор: карточка появляется по дате определения коллегии ВС', () => {
  const without = buildView({ ksoyu_ruling_date: '2025-09-01' }, { today: '2026-03-01' });
  assert.ok(!ids(without.cards).includes('supervision'), 'дата КСОЮ узел надзора не открывает');

  const v = buildView({ vs_ruling_date: '2025-09-01' }, { today: '2026-03-01' });
  const sup = byId(v.cards, 'supervision');
  assert.ok(sup);
  assert.equal(sup.deadline, '2025-12-01');
  assert.match(sup.norm, /391\.2/);
  assert.deepEqual(sup.duration, { value: 3, unit: 'month' });
});

test('возврат кассационной жалобы: карточка месячного срока (ч. 1 ст. 379.2)', () => {
  const without = buildView({ ksoyu_ruling_date: '2025-09-01' }, { today: '2026-03-01' });
  assert.ok(
    !ids(without.cards).includes('cassation_return_ruling_appeal'),
    'дата определения КСОЮ по существу узел возврата не открывает',
  );

  const v = buildView({ cassation_return_ruling_date: '2025-09-01' }, { today: '2025-09-10' });
  const card = byId(v.cards, 'cassation_return_ruling_appeal');
  assert.ok(card);
  assert.equal(card.kind, 'term');
  assert.equal(card.status, 'computed');
  assert.equal(card.title, 'Обжалование определения о возврате кассационной жалобы');
  assert.equal(card.deadline, '2025-10-01');
  assert.match(card.norm, /ч\. 1 ст\. 379\.2/);
  assert.deepEqual(card.duration, { value: 1, unit: 'month' });
  // Прерываемым (ст. 22 ФЗ № 229-ФЗ) этот срок не является.
  assert.equal(card.interruptible, undefined);
});

test('возврат кассационной жалобы: правило о дне первоначального обращения — в details', () => {
  const v = buildView({ cassation_return_ruling_date: '2025-09-01' }, { today: '2025-09-10' });
  const card = byId(v.cards, 'cassation_return_ruling_appeal');
  assert.match(card.details.logic, /день первоначального обращения/);
  // Десятидневный срок рассмотрения самим судом — контекст в тексте карточки,
  // отдельной карточки для него нет.
  assert.match(card.details.logic, /[Дд]есятидневный/);
  assert.match(card.details.logic, /срок суда/);
  assert.equal(
    v.cards.filter((c) => /возврат/i.test(c.title)).length,
    1,
    'срок суда отдельной карточкой не заводится',
  );
  assert.match(card.details.midnight_rule, /ч\. 3 ст\. 108/);
});

test('возврат кассационной жалобы: узел доступен в любой ветви, без данных цепочки', () => {
  // Возвратить жалобу кассационный суд может по делу любой категории — карточка
  // не должна зависеть ни от одной из ветвей и от их полей.
  const alone = buildView({ cassation_return_ruling_date: '2025-09-01' }, { today: '2025-09-10' });
  assert.ok(byId(alone.cards, 'cassation_return_ruling_appeal'));

  for (const branch of [
    { reasoned_decision_date: '2025-03-11' },
    { mirovoy_resolution_date: '2025-07-06' },
    { simplified_resolution_date: '2025-07-03' },
    { default_judgment_service_date: '2025-07-05' },
    { court_order_issued_date: '2023-04-12' },
  ]) {
    const v = buildView(
      { ...branch, cassation_return_ruling_date: '2025-09-01' },
      { today: '2025-09-10' },
    );
    const card = byId(v.cards, 'cassation_return_ruling_appeal');
    assert.ok(card, `узел пропал в ветви ${Object.keys(branch)[0]}`);
    assert.equal(card.deadline, '2025-10-01');
  }
});

test('пересмотр по вновь открывшимся/новым обстоятельствам: карточка по основанию и дате', () => {
  const withoutGround = buildView(
    { review_circumstance_date: '2025-09-01' },
    { today: '2025-09-10' },
  );
  assert.ok(
    !ids(withoutGround.cards).includes('review_new_circumstances_filing'),
    'без выбранного основания узла нет',
  );

  const withoutDate = buildView({ review_ground: 'newly_discovered_fact' }, { today: '2025-09-10' });
  assert.ok(
    !ids(withoutDate.cards).includes('review_new_circumstances_filing'),
    'без даты обстоятельства узла нет',
  );

  const v = buildView(
    { review_ground: 'newly_discovered_fact', review_circumstance_date: '2025-09-01' },
    { today: '2025-09-10' },
  );
  const card = byId(v.cards, 'review_new_circumstances_filing');
  assert.ok(card);
  assert.equal(card.kind, 'term');
  assert.equal(card.status, 'computed');
  assert.equal(card.title, 'Заявление о пересмотре по вновь открывшимся/новым обстоятельствам');
  assert.equal(card.deadline, '2025-12-01');
  assert.deepEqual(card.duration, { value: 3, unit: 'month' });
  assert.match(card.norm, /ч\. 1 ст\. 394/);
});

test('пересмотр: норма и логика на карточке соответствуют каждому из шести оснований', () => {
  const NORM_PATTERNS = {
    newly_discovered_fact: /п\. 1 ч\. 3 ст\. 392/,
    false_testimony_or_crime: /пп\. 2, 3 ч\. 3 ст\. 392/,
    annulled_underlying_act: /п\. 1 ч\. 4 ст\. 392/,
    transaction_invalidated: /п\. 2 ч\. 4 ст\. 392/,
    ks_ruling: /п\. 3 ч\. 4 ст\. 392/,
    unauthorized_construction: /п\. 6 ч\. 4/,
  };
  for (const ground of REVIEW_GROUNDS) {
    const v = buildView(
      { review_ground: ground.id, review_circumstance_date: '2025-09-01' },
      { today: '2025-09-10' },
    );
    const card = byId(v.cards, 'review_new_circumstances_filing');
    assert.ok(card, `основание ${ground.id}: карточка должна появиться`);
    assert.match(card.norm, NORM_PATTERNS[ground.id]);
    assert.match(card.details.logic, NORM_PATTERNS[ground.id]);
  }
});

test('пересмотр: практика Пленума/Президиума ВС (п. 5 ч. 4 ст. 392) в список оснований не входит', () => {
  // Регрессия: у этого основания другая механика (минимум из двух дат,
  // шестимесячный потолок) — отдельная задача, дропдаун его не должен получить
  // молча вместе с каким-нибудь рефакторингом REVIEW_GROUNDS.
  assert.equal(REVIEW_GROUNDS.length, 6);
  assert.ok(!REVIEW_GROUNDS.some((g) => g.id === 'plenum_practice'));
  for (const g of REVIEW_GROUNDS) {
    assert.doesNotMatch(g.label, /Пленум|Президиум/i);
  }
});

test('пересмотр: узел доступен в любой ветви, без данных цепочки', () => {
  const alone = buildView(
    { review_ground: 'ks_ruling', review_circumstance_date: '2025-09-01' },
    { today: '2025-09-10' },
  );
  assert.ok(byId(alone.cards, 'review_new_circumstances_filing'));

  for (const branch of [
    { reasoned_decision_date: '2025-03-11' },
    { mirovoy_resolution_date: '2025-07-06' },
    { simplified_resolution_date: '2025-07-03' },
    { default_judgment_service_date: '2025-07-05' },
    { court_order_issued_date: '2023-04-12' },
  ]) {
    const v = buildView(
      { ...branch, review_ground: 'ks_ruling', review_circumstance_date: '2025-09-01' },
      { today: '2025-09-10' },
    );
    const card = byId(v.cards, 'review_new_circumstances_filing');
    assert.ok(card, `узел пропал в ветви ${Object.keys(branch)[0]}`);
    assert.equal(card.deadline, '2025-12-01');
  }
});

test('судебный приказ: карточка появляется по дате выдачи приказа', () => {
  const without = buildView({}, { today: '2026-03-01' });
  assert.ok(!ids(without.cards).includes('court_order_presentation'));

  const v = buildView({ court_order_issued_date: '2023-04-12' }, { today: '2026-03-01' });
  const co = byId(v.cards, 'court_order_presentation');
  assert.ok(co);
  assert.equal(co.deadline, '2026-04-13'); // 12.04.2026 — воскресенье, перенос
  assert.match(co.norm, /ч\. 3 ст\. 21/);
  assert.deepEqual(co.duration, { value: 3, unit: 'year' });
});

test('возражения должника: карточка появляется по дате получения копии приказа', () => {
  const without = buildView({}, { today: '2026-03-01' });
  assert.ok(!ids(without.cards).includes('court_order_objection'));

  const v = buildView({ court_order_copy_received_date: '2026-03-02' }, { today: '2026-03-01' });
  const obj = byId(v.cards, 'court_order_objection');
  assert.ok(obj);
  assert.equal(obj.status, 'computed');
  assert.equal(obj.deadline, '2026-03-17');
  assert.equal(obj.unit, 'working_day');
  assert.equal(obj.first_working_day, '2026-03-03');
  assert.match(obj.norm, /ст\. 128/);
  assert.deepEqual(obj.duration, { value: 10, unit: 'working_day' });
});

test('возражения должника: заметка связывает узел со сроком предъявления (ст. 130)', () => {
  const v = buildView({ court_order_copy_received_date: '2026-03-02' }, { today: '2026-03-01' });
  const obj = byId(v.cards, 'court_order_objection');
  assert.match(obj.note, /ст\. 130/);
  assert.match(obj.note, /предъявлени/);
  assert.equal(obj.details.related_node, 'court_order_presentation');
  // Заметка — только связь, а не второй расчёт: своего дедлайна у неё нет.
  assert.ok(!ids(v.cards).includes('court_order_presentation'));
});

test('судебный приказ: два узла ситуации независимы друг от друга', () => {
  const onlyObjection = buildView(
    { court_order_copy_received_date: '2026-03-02' },
    { today: '2026-03-01' },
  );
  assert.deepEqual(
    ids(onlyObjection.cards).filter((id) => id.startsWith('court_order')),
    ['court_order_objection'],
  );

  const onlyPresentation = buildView(
    { court_order_issued_date: '2023-04-12' },
    { today: '2026-03-01' },
  );
  assert.deepEqual(
    ids(onlyPresentation.cards).filter((id) => id.startsWith('court_order')),
    ['court_order_presentation'],
  );

  const both = buildView(
    { court_order_copy_received_date: '2026-03-02', court_order_issued_date: '2023-04-12' },
    { today: '2026-03-01' },
  );
  assert.deepEqual(
    ids(both.cards).filter((id) => id.startsWith('court_order')),
    ['court_order_objection', 'court_order_presentation'],
  );
  assert.equal(byId(both.cards, 'court_order_objection').deadline, '2026-03-17');
  assert.equal(byId(both.cards, 'court_order_presentation').deadline, '2026-04-13');

  const neither = buildView({}, { today: '2026-03-01' });
  assert.deepEqual(ids(neither.cards).filter((id) => id.startsWith('court_order')), []);
});

test('возражения должника: истёкший срок помечается по текущей дате', () => {
  const v = buildView({ court_order_copy_received_date: '2026-03-02' }, { today: '2026-04-01' });
  const obj = byId(v.cards, 'court_order_objection');
  assert.equal(obj.status, 'expired');
});

test('глава 22.2: карточки появляются по своим датам', () => {
  const without = buildView({}, { today: '2026-03-01' });
  assert.ok(!ids(without.cards).includes('child_return_appeal'));
  assert.ok(!ids(without.cards).includes('child_return_private_complaint'));

  const v = buildView(
    {
      child_return_reasoned_decision_date: '2026-03-02',
      child_return_interim_ruling_date: '2026-02-20',
    },
    { today: '2026-03-01' },
  );

  const appeal = byId(v.cards, 'child_return_appeal');
  assert.ok(appeal);
  assert.equal(appeal.status, 'computed');
  assert.equal(appeal.unit, 'working_day');
  assert.equal(appeal.first_working_day, '2026-03-03');
  assert.equal(appeal.deadline, '2026-03-17');
  assert.match(appeal.norm, /ч\. 1 ст\. 244\.17/);
  assert.deepEqual(appeal.duration, { value: 10, unit: 'working_day' });

  const priv = byId(v.cards, 'child_return_private_complaint');
  assert.ok(priv);
  assert.equal(priv.status, 'computed');
  assert.equal(priv.unit, 'working_day');
  assert.equal(priv.first_working_day, '2026-02-24');
  assert.equal(priv.deadline, '2026-03-10');
  assert.match(priv.norm, /ч\. 1 ст\. 244\.18/);
  assert.deepEqual(priv.duration, { value: 10, unit: 'working_day' });
});

test('глава 22.2: два узла ситуации независимы друг от друга', () => {
  const onlyAppeal = buildView(
    { child_return_reasoned_decision_date: '2026-03-02' },
    { today: '2026-03-01' },
  );
  assert.deepEqual(
    ids(onlyAppeal.cards).filter((id) => id.startsWith('child_return')),
    ['child_return_appeal'],
  );

  const onlyPrivate = buildView(
    { child_return_interim_ruling_date: '2026-02-20' },
    { today: '2026-03-01' },
  );
  assert.deepEqual(
    ids(onlyPrivate.cards).filter((id) => id.startsWith('child_return')),
    ['child_return_private_complaint'],
  );

  const both = buildView(
    {
      child_return_reasoned_decision_date: '2026-03-02',
      child_return_interim_ruling_date: '2026-02-20',
    },
    { today: '2026-03-01' },
  );
  assert.deepEqual(
    ids(both.cards).filter((id) => id.startsWith('child_return')),
    ['child_return_appeal', 'child_return_private_complaint'],
  );
  assert.equal(byId(both.cards, 'child_return_appeal').deadline, '2026-03-17');
  assert.equal(byId(both.cards, 'child_return_private_complaint').deadline, '2026-03-10');

  const neither = buildView({}, { today: '2026-03-01' });
  assert.deepEqual(ids(neither.cards).filter((id) => id.startsWith('child_return')), []);
});

test('глава 22.2: даты общей ветви эти карточки не поднимают', () => {
  // Своя категория дел — свои поля: общая дата решения и общая дата определения
  // суда первой инстанции считаются по общим нормам (ст. 321, 332).
  const v = buildView(
    { reasoned_decision_date: '2026-03-02', interim_ruling_date: '2026-03-02' },
    { today: '2026-03-01' },
  );
  assert.deepEqual(ids(v.cards).filter((id) => id.startsWith('child_return')), []);
  assert.ok(ids(v.cards).includes('private_complaint'));
});

test('глава 22.2: истёкший срок помечается по текущей дате', () => {
  const v = buildView(
    {
      child_return_reasoned_decision_date: '2026-03-02',
      child_return_interim_ruling_date: '2026-02-20',
    },
    { today: '2026-04-01' },
  );
  assert.equal(byId(v.cards, 'child_return_appeal').status, 'expired');
  assert.equal(byId(v.cards, 'child_return_private_complaint').status, 'expired');
});

test('периодические платежи: карточка появляется по дате окончания периода', () => {
  const without = buildView({}, { today: '2026-03-01' });
  assert.ok(!ids(without.cards).includes('periodic_payments_presentation'));

  const v = buildView(
    { periodic_payment_period_end_date: '2023-04-12' },
    { today: '2026-03-01' },
  );
  const pp = byId(v.cards, 'periodic_payments_presentation');
  assert.ok(pp);
  assert.equal(pp.status, 'computed');
  assert.equal(pp.deadline, '2026-04-13'); // 12.04.2026 — воскресенье, перенос
  assert.match(pp.norm, /ч\. 4 ст\. 21/);
  assert.deepEqual(pp.duration, { value: 3, unit: 'year' });
});

test('периодические платежи: бессрочное взыскание — карточка not_applicable без даты', () => {
  const v = buildView({ periodic_payment_indefinite: true }, { today: '2026-03-01' });
  const pp = byId(v.cards, 'periodic_payments_presentation');
  assert.ok(pp, 'карточка остаётся — это содержательный факт, не нехватка данных');
  assert.equal(pp.status, 'not_applicable');
  assert.equal(pp.deadline, null);
  assert.match(pp.message, /бессрочное/);
  assert.match(pp.details.logic, /бессрочно/);
  assert.ok(!ids(v.incomplete).includes('periodic_payments_presentation'));
  // И в .ics не попадает — экспортировать нечего.
  assert.ok(
    !icsTermsFromView(v).some((t) =>
      /периодических платежей/.test(t.title),
    ),
  );
});

// --- Перерыв срока предъявления (ч. 1–3 ст. 22 ФЗ № 229-ФЗ) -----------------

test('перерыв: карточка ИЛ показывает историю событий и норму ст. 22', () => {
  const v = buildView(
    {
      ...BASE,
      enforcement_interruptions: [
        { type: 'partial_execution', date: '2027-02-10' },
        { type: 'presentment', date: '2026-06-01' },
      ],
    },
    { today: '2025-05-01' },
  );
  const il = byId(v.cards, 'enforcement_presentation');
  assert.equal(il.deadline, '2030-02-11'); // от 10.02.2027 + 3 года, перенос
  // История — в хронологическом порядке, с подписями оснований.
  assert.deepEqual(
    il.interruptions.map((e) => [e.date, e.type]),
    [
      ['2026-06-01', 'presentment'],
      ['2027-02-10', 'partial_execution'],
    ],
  );
  for (const event of il.interruptions) {
    assert.ok(event.label && event.label.length > 3, 'у события должна быть подпись');
  }
  assert.equal(il.base_anchor, '2025-04-12');
  assert.equal(il.restarted_from, '2027-02-10');
  assert.match(il.details.interruption_norm, /ч\. 1–3 ст\. 22/);
  assert.ok(il.details.interruption_logic);
});

test('перерыв: карточка несёт предупреждение о ч. 3.1 ст. 22', () => {
  const v = buildView(
    { ...BASE, enforcement_interruptions: [{ type: 'returned_no_assets', date: '2026-06-01' }] },
    { today: '2025-05-01' },
  );
  const warning = byId(v.cards, 'enforcement_presentation').interruption_warning;
  assert.equal(warning.code, 'interruption_scope');
  assert.match(warning.norm, /3\.1/);
  // Смысл: сюда идёт только возврат по невозможности взыскания; отзыв самим
  // взыскателем считается по другому правилу и завысит срок.
  assert.match(warning.text, /невозможност/i);
  assert.match(warning.text, /ч\. 3\.1/);
  assert.match(warning.text, /завысит/);
});

test('перерыв: без событий карточка не обрастает полями истории', () => {
  const il = byId(buildView(BASE, { today: '2025-05-01' }).cards, 'enforcement_presentation');
  assert.equal(il.deadline, '2028-04-12');
  assert.equal(il.interruptions, undefined);
  assert.equal(il.interruption_warning, undefined);
  assert.equal(il.details.interruption_norm, undefined);
  // Флаг для UI при этом стоит: список перерывов можно открыть и на пустом.
  assert.equal(il.interruptible, true);
});

test('перерыв: неучтённое событие остаётся в истории с объяснением', () => {
  const v = buildView(
    { ...BASE, enforcement_interruptions: [{ type: 'presentment', date: '2025-01-10' }] },
    { today: '2025-05-01' },
  );
  const il = byId(v.cards, 'enforcement_presentation');
  assert.equal(il.deadline, '2028-04-12'); // дедлайн не уехал назад
  assert.equal(il.restarted_from, null);
  assert.equal(il.interruptions[0].ignored, true);
  assert.match(il.interruptions[0].ignored_text, /не принято/);
});

test('перерыв: карточка судебного приказа считает срок от последнего события', () => {
  const v = buildView(
    {
      court_order_issued_date: '2023-04-12',
      enforcement_interruptions: [{ type: 'presentment', date: '2024-03-05' }],
    },
    { today: '2026-03-01' },
  );
  const co = byId(v.cards, 'court_order_presentation');
  assert.equal(co.deadline, '2027-03-05'); // вместо 13.04.2026 без перерыва
  assert.equal(co.base_anchor, '2023-04-12');
  assert.equal(co.restarted_from, '2024-03-05');
  assert.ok(co.interruption_warning);
});

test('перерыв: карточка периодических платежей его не получает', () => {
  // Обе фичи включены одним набором входных данных: ИЛ прерван, периодические
  // платежи (ч. 4 ст. 21) считаются от своей даты и списка перерывов не несут.
  const v = buildView(
    {
      ...BASE,
      periodic_payment_period_end_date: '2023-04-12',
      enforcement_interruptions: [{ type: 'presentment', date: '2026-06-01' }],
    },
    { today: '2025-05-01' },
  );
  const il = byId(v.cards, 'enforcement_presentation');
  assert.equal(il.deadline, '2029-06-01');
  assert.ok(il.interruptions);

  const pp = byId(v.cards, 'periodic_payments_presentation');
  assert.ok(pp, 'узел периодических платежей на месте');
  assert.equal(pp.deadline, '2026-04-13');
  assert.equal(pp.interruptible, undefined);
  assert.equal(pp.interruptions, undefined);
});

test('перерыв: срок надзора остаётся непрерываемым', () => {
  // Модификатор привязан к исполнительным документам, а не ко всем срокам:
  // список перерывов не должен просачиваться в чужие узлы.
  const v = buildView(
    {
      vs_ruling_date: '2025-09-01',
      enforcement_interruptions: [{ type: 'presentment', date: '2026-06-01' }],
    },
    { today: '2026-03-01' },
  );
  const sup = byId(v.cards, 'supervision');
  assert.equal(sup.deadline, '2025-12-01');
  assert.equal(sup.interruptible, undefined);
  assert.equal(sup.interruptions, undefined);
});

test('кассация по делам мировых судей: маршрут и пометка о переходном положении', () => {
  const base = {
    mirovoy_resolution_date: '2026-01-15',
    mirovoy_appeal_ruling_reasoned_date: '2026-03-01',
  };
  // Подача с 10.05.2026 → президиум областного суда (глава 40.1).
  const presidium = buildView(
    { ...base, cassation_filed_date: '2026-05-10' },
    { today: '2026-07-01' },
  );
  const pc = byId(presidium.cards, 'mirovoy_cassation');
  assert.ok(pc);
  assert.equal(pc.version_id, 'presidium_from_79fz');
  assert.match(pc.title, /президиум областного суда/);
  assert.match(pc.norm, /375\.2/);
  assert.equal(pc.note, undefined); // переходной пометки нет

  // Подача до 10.05.2026 → прежний маршрут в КСОЮ, с пометкой.
  const ksoyu = buildView(
    { ...base, cassation_filed_date: '2026-05-09' },
    { today: '2026-07-01' },
  );
  const kc = byId(ksoyu.cards, 'mirovoy_cassation');
  assert.equal(kc.version_id, 'ksoyu_before_79fz');
  assert.match(kc.title, /КСОЮ/);
  assert.match(kc.norm, /376\.1/);
  assert.match(kc.note, /прежний маршрут/);
  assert.match(kc.note, /ч\. 2 ст\. 3 ФЗ № 79-ФЗ/);
});

test('исчерпание: предупреждение в карточках обоих кассационных узлов (not_appealed)', () => {
  // Решение первой инстанции, апелляции не было → кассация в КСОЮ.
  const ksoyu = buildView(BASE, { today: '2025-05-01' });
  const kw = byId(ksoyu.cards, 'cassation_ksoyu').exhaustion_warning;
  assert.ok(kw, 'карточка КСОЮ должна нести предупреждение');
  assert.equal(kw.code, 'appeal_not_exhausted');
  assert.match(kw.text, /возврату без рассмотрения/);
  assert.match(kw.calculation_note, /судебный приказ/);

  // Решение мирового судьи, апелляции не было → президиум областного суда.
  const presidium = buildView({ mirovoy_resolution_date: '2026-01-15' }, { today: '2026-07-01' });
  const pc = byId(presidium.cards, 'mirovoy_cassation');
  assert.equal(pc.version_id, 'presidium_from_79fz');
  assert.equal(pc.exhaustion_warning.code, 'appeal_not_exhausted');
});

test('исчерпание: в ветви appealed предупреждения нет ни в одной карточке', () => {
  const ksoyu = buildView(
    {
      ...BASE,
      appeal_filed_date: '2025-04-05',
      appeal_ruling_date: '2025-06-02',
      appeal_ruling_reasoned_date: '2025-06-02',
    },
    { today: '2025-07-01' },
  );
  assert.equal(byId(ksoyu.cards, 'cassation_ksoyu').exhaustion_warning, undefined);

  const presidium = buildView(
    { mirovoy_resolution_date: '2026-01-15', mirovoy_appeal_ruling_reasoned_date: '2026-03-01' },
    { today: '2026-07-01' },
  );
  assert.equal(byId(presidium.cards, 'mirovoy_cassation').exhaustion_warning, undefined);
});

test('заочное: при удовлетворении заявления апелляционная карточка без даты', () => {
  const v = buildView(
    {
      default_judgment_service_date: '2025-12-22',
      default_judgment_refusal_date: '2026-02-10',
      default_judgment_cancellation_request_date: '2026-01-09',
      default_judgment_cancellation_date: '2026-01-20',
    },
    { today: '2026-03-01' },
  );

  const appeal = byId(v.cards, 'default_judgment_appeal');
  assert.ok(appeal, 'карточка остаётся — исчезать ей незачем');
  assert.equal(appeal.status, 'not_applicable');
  assert.equal(appeal.deadline, null);
  assert.match(appeal.message, /отменено/);
  assert.match(appeal.details.logic, /ч\. 1 ст\. 241/);
  // В incomplete узел не уходит: это не нехватка данных.
  assert.ok(!ids(v.incomplete).includes('default_judgment_appeal'));
  // И в .ics не попадает — экспортировать нечего.
  assert.ok(!icsTermsFromView(v).some((t) => /Апелляционная жалоба \(заочное/.test(t.title)));
});

// Структурная проверка: ни один узел не должен показывать дату, когда
// вышестоящее событие в состоянии not_applicable. Проверяем по списку карточек,
// а не перечислением, — иначе следующий добавленный узел снова выпадет молча.
test('not_applicable: ни один нижестоящий узел не показывает дату', () => {
  const v = buildView(
    {
      default_judgment_service_date: '2025-12-22',
      default_judgment_refusal_date: '2026-02-10',
      default_judgment_cancellation_request_date: '2026-01-09',
      default_judgment_cancellation_date: '2026-01-20',
      default_judgment_appeal_filed_date: '2026-03-02',
      default_judgment_appeal_ruling_date: '2026-06-15',
    },
    { today: '2026-07-01' },
  );

  const notApplicable = v.cards.filter((c) => c.status === 'not_applicable');
  assert.deepEqual(
    notApplicable.map((c) => c.id).sort(),
    ['default_judgment_appeal', 'default_judgment_entry_into_force'],
  );
  for (const card of notApplicable) {
    assert.equal(card.deadline ?? null, null, `${card.id}: дата при not_applicable`);
    assert.equal(card.date ?? null, null, `${card.id}: дата при not_applicable`);
  }

  // Единственный узел ветви, сохраняющий дату, — срок на подачу самого
  // заявления об отмене: он вышестоящий и к этому моменту уже исчерпан.
  const dated = v.cards
    .filter((c) => c.id.startsWith('default_judgment') && (c.deadline || c.date))
    .map((c) => c.id);
  assert.deepEqual(dated, ['default_judgment_cancellation_request']);
});

// --- Индикация истёкших сроков ----------------------------------------------

test('истёкший срок: дедлайн в прошлом без даты подачи', () => {
  // Апелляция от 11.03.2025 → 11.04.2025; смотрим из 20.04.2025.
  const v = buildView(BASE, { today: '2025-04-20' });
  const appeal = byId(v.cards, 'appeal_general');
  assert.equal(appeal.status, 'expired');
  assert.equal(appeal.deadline, '2025-04-11');
  assert.equal(appeal.expired.days, 9);
  // Это не «пропущен»: факт подачи не установлен.
  assert.equal(appeal.overdue, undefined);
});

test('истёкший срок: дедлайн в будущем — пометки нет', () => {
  const v = buildView(BASE, { today: '2025-04-01' });
  const appeal = byId(v.cards, 'appeal_general');
  assert.equal(appeal.status, 'computed');
  assert.equal(appeal.expired, undefined);
});

test('истёкший срок: дедлайн сегодня — срок не истёк (ч. 3 ст. 108)', () => {
  // Срок истекает в 24:00 последнего дня, поэтому сегодняшний дедлайн живой.
  const today = buildView(BASE, { today: '2025-04-11' });
  assert.equal(byId(today.cards, 'appeal_general').status, 'computed');
  // А назавтра — уже истёк, ровно на один день.
  const tomorrow = buildView(BASE, { today: '2025-04-12' });
  const appeal = byId(tomorrow.cards, 'appeal_general');
  assert.equal(appeal.status, 'expired');
  assert.equal(appeal.expired.days, 1);
});

test('истёкший срок: введённая дата подачи отменяет пометку', () => {
  // Подано вовремя — статус остаётся computed, хотя дедлайн давно прошёл.
  const inTime = buildView(
    { ...BASE, appeal_filed_date: '2025-04-05' },
    { today: '2025-12-01' },
  );
  assert.equal(byId(inTime.cards, 'appeal_general').status, 'computed');

  // Подано позже дедлайна — это уже установленный факт пропуска, не «истёк».
  const late = buildView({ ...BASE, appeal_filed_date: '2025-04-20' }, { today: '2025-12-01' });
  const appeal = byId(late.cards, 'appeal_general');
  assert.equal(appeal.status, 'missed');
  assert.equal(appeal.overdue.days, 9);
  assert.equal(appeal.expired, undefined);
});

test('истёкший срок: без текущей даты пометки нет', () => {
  // today передаётся параметром; без него о истечении судить не из чего.
  const v = buildView({ ...BASE, appeal_filed_date: '2025-04-05', appeal_ruling_date: '2025-06-02',
    appeal_ruling_reasoned_date: '2025-06-02' });
  assert.equal(byId(v.cards, 'appeal_general').status, 'computed');
});

// --- Проверка фактической даты составления решения (ч. 4 ст. 232.4) ---------

// Реальное дело 02-9411/2024 Люблинского районного суда: резолютивная часть
// 16.12.2024, апелляционная жалоба 19.12.2024, срок изготовления истекал
// 13.01.2025, мотивированное решение изготовлено 27.02.2025.
const LUBLINSKY = {
  simplified_resolution_date: '2024-12-16',
  simplified_appeal_filed_date: '2024-12-19',
};

test('упрощённое: решение составлено позже срока по ч. 4 ст. 232.4 — предупреждение', () => {
  const v = buildView(
    { ...LUBLINSKY, simplified_reasoned_date: '2025-02-27' },
    { today: '2025-03-01' },
  );

  // Срок изготовления — десять рабочих дней с 19.12.2024 (дата подачи жалобы).
  assert.equal(byId(v.cards, 'simplified_reasoned_making').deadline, '2025-01-13');

  const appeal = byId(v.cards, 'simplified_appeal');
  assert.ok(appeal.warnings, 'предупреждение должно быть на карточке апелляции');
  assert.equal(appeal.warnings.length, 1);
  const w = appeal.warnings[0];
  assert.equal(w.code, 'simplified_reasoned_over_delay');
  assert.equal(w.threshold_days, 10);
  assert.equal(w.threshold_unit, 'working_day');
  assert.equal(w.allowed_deadline, '2025-01-13');
  assert.equal(w.actual_date, '2025-02-27');
  assert.equal(w.overdue_working_days, 33);
  assert.match(w.text, /ч\. 4 ст\. 232\.4/);
  assert.match(w.text, /дня подачи апелляционной жалобы/);

  // warn_not_block: расчёт апелляционного срока не меняется — он идёт от
  // фактической даты составления, как и в общем порядке.
  assert.equal(appeal.status, 'computed');
  assert.equal(appeal.deadline, '2025-03-20');
});

test('упрощённое: решение составлено в срок — предупреждения нет', () => {
  // Раньше последнего допустимого дня.
  const early = buildView(
    { ...LUBLINSKY, simplified_reasoned_date: '2024-12-27' },
    { today: '2025-01-15' },
  );
  assert.equal(byId(early.cards, 'simplified_appeal').warnings, undefined);

  // Ровно в последний допустимый день — срок соблюдён, сравнение строгое.
  const onTime = buildView(
    { ...LUBLINSKY, simplified_reasoned_date: '2025-01-13' },
    { today: '2025-01-20' },
  );
  assert.equal(byId(onTime.cards, 'simplified_reasoned_making').deadline, '2025-01-13');
  assert.equal(byId(onTime.cards, 'simplified_appeal').warnings, undefined);
});

test('упрощённое: без запускающего факта сравнивать не с чем', () => {
  // Ни заявления, ни жалобы — срока изготовления нет, предупреждения тоже.
  const v = buildView(
    { simplified_resolution_date: '2024-12-16', simplified_reasoned_date: '2025-02-27' },
    { today: '2025-03-01' },
  );
  assert.ok(!ids(v.cards).includes('simplified_reasoned_making'));
  assert.equal(byId(v.cards, 'simplified_appeal').warnings, undefined);
});

test('пропуск устанавливается у всех узлов с датой подачи, не только у апелляции', () => {
  // Кассация подана 15.01.2026 при дедлайне 14.07.2025 — пропуск установлен.
  const v = buildView(
    { ...BASE, cassation_filed_date: '2026-01-15' },
    { today: '2026-03-01' },
  );
  const cass = byId(v.cards, 'cassation_ksoyu');
  assert.equal(cass.status, 'missed');
  assert.equal(cass.deadline, '2025-07-14');
  assert.equal(cass.overdue.days, 185);
  assert.match(cass.overdue.norm, /ст\. 112/);
  assert.equal(cass.expired, undefined, 'пропуск установлен — это не «истёк»');
});

test('срок суда поздней датой не помечается как пропущенный', () => {
  // Мотивированное решение изготовлено 27.02.2025 при сроке до 13.01.2025.
  // Это нарушение судом (предупреждение по ч. 4 ст. 232.4), а не пропуск
  // заявителя: восстановление по ст. 112 к сроку суда неприменимо.
  const v = buildView(
    {
      simplified_resolution_date: '2024-12-16',
      simplified_appeal_filed_date: '2024-12-19',
      simplified_reasoned_date: '2025-02-27',
    },
    { today: '2025-03-01' },
  );
  const making = byId(v.cards, 'simplified_reasoned_making');
  assert.equal(making.status, 'computed');
  assert.equal(making.overdue, undefined);
  // Само нарушение показано предупреждением на карточке апелляции.
  assert.ok(byId(v.cards, 'simplified_appeal').warnings);
});

test('апелляция мирового: дата апелляционного определения не считается подачей', () => {
  // mirovoy_appeal подтверждается датой апелляционного определения районного
  // суда — она всегда позже дедлайна и пропуском не является.
  const v = buildView(
    { mirovoy_resolution_date: '2026-01-15', mirovoy_appeal_ruling_reasoned_date: '2026-03-01' },
    { today: '2026-07-01' },
  );
  const appeal = byId(v.cards, 'mirovoy_appeal');
  assert.equal(appeal.status, 'computed');
  assert.equal(appeal.overdue, undefined);
});
