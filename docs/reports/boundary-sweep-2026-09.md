# Отчёт: систематический прогон граничных календарных случаев

Дата генерации: 2026-09-14 (автоматически пересчитывается при каждом запуске
`test/integration/boundary-sweep.test.js`).

Это аудит (см. CLAUDE.md и текст задачи) — найденные расхождения зафиксированы
здесь, но не исправлены в этом прогоне.

## Методология (кратко)

- **Шаг 1.** Список дат-аномалий 2020–2027 вычислен независимой реализацией,
  читающей `core/calendar/calendar_data.json` напрямую (не импортирует
  `core/calendar/calendar.js`) — сравнение с наивным правилом «будни рабочие,
  выходные нет». Итого дат-аномалий: **124**, плюс 10 дат из
  диапазона вокруг 29 февраля 2020/2024 (±2 дня).
- **Контрольная проверка из задачи** (4/5 января, 2/8 мая 2025) — не совпала:
  4 и 5 января 2025 расчёт (и core, и независимая реализация) даёт
  **нерабочими**, а не рабочими, как предполагала формулировка задачи. Это
  ловушка №1 (SPEC.md §5.1, `.claude/skills/calendar-year-update/SKILL.md`):
  донор переноса (суббота 4 января), совпавший с праздником 1–8 января,
  остаётся нерабочим — переезжает только статус выходного дня, а 4 и 5 января
  нерабочи независимо от переноса. Формулировка задачи ошибочна, что
  подтверждено пользователем в этой сессии; список аномалий шага 1 принят как
  верный без изменений.
- **Шаг 2.** Метаданные узлов собраны reflection'ом по `TERM_REGISTRY` — 37 узлов.
- **Шаг 3–4.** Для каждого узла и каждой даты-аномалии — до 4 сценариев
  (старт на аномалии; наивный дедлайн на аномалии; ±1 день допуска).
  Вызов — РЕАЛЬНЫЕ функции ядра (`computeSimpleTerm`/`computeVersionedTerm`/
  `computeDeadline`), с параметрами (duration/offset_start/weekend_shift),
  прочитанными с самого термина узла. Для узлов с тривиальным входом
  (без многошагового resolve) дополнительно сверено с публичной обёрткой
  `chain.computeIndependentTerms` (differential-проверка «узел тайно не
  использует core»).
- Итого сценариев: **24656**.

## Сводка

- Узлов всего: **37**.
- Узлов без единой ANOMALY/ERROR: **37**.
- Узлов с найденными расхождениями: **0**.
- Сценариев PASS: **24656**.
- Сценариев ANOMALY: **0**.
- Сценариев ERROR (исключение при вызове): **0**.
- Сценариев NOT_GENERATED (наивный подбор старта не сошёлся): **0**.
- Потолок восстановления (шаг 4б): **64** проверок на 8 датах вокруг 29 февраля × 8 узлов restoration-ceiling; ANOMALY: **0**.
- Статический аудит (шаг 5): STATIC_FLAG-совпадений вне core/: **4**.

## Узлы (шаг 2, метаданные)

| node_id | unit | value | versioned | fact_input | restoration_ceiling |
|---|---|---|---|---|---|
| adoption_appeal | working_day | 10 | нет | — | нет |
| appeal_general | month | 1 | нет | appeal_filed_date | нет |
| arbitration_award_setaside | month | 3 | нет | — | нет |
| arbitration_competence_appeal | month | 1 | нет | — | нет |
| cassation_ksoyu | month | 3 | да (2) | cassation_filed_date | да |
| cassation_return_ruling_appeal | month | 1 | нет | — | нет |
| cassation_vs | month | 3 | да (2) | vs_cassation_filed_date | да |
| child_return_appeal | working_day | 10 | нет | — | нет |
| child_return_private_complaint | working_day | 10 | нет | — | нет |
| court_order_objection | working_day | 10 | нет | — | нет |
| default_judgment_appeal | month | 1 | нет | default_judgment_appeal_filed_date | нет |
| default_judgment_cancellation_request | working_day | 7 | нет | default_judgment_cancellation_request_date | нет |
| default_judgment_cassation_ksoyu | month | 3 | да (2) | cassation_filed_date | нет |
| enforcement_document_presentation | year | 3 | нет | — | нет |
| foreign_judgment_enforcement_presentation | year | 3 | нет | — | нет |
| foreign_judgment_recognition_objection | month | 1 | нет | — | нет |
| foreign_state_default_judgment_appeal | month | 1 | нет | foreign_state_default_judgment_appeal_filed_date | нет |
| foreign_state_default_judgment_cancellation_request | month | 2 | нет | foreign_state_default_judgment_cancellation_request_date | нет |
| foreign_state_default_judgment_cassation_ksoyu | month | 3 | да (2) | cassation_filed_date | нет |
| mirovoy_appeal | month | 1 | нет | mirovoy_appeal_ruling_reasoned_date | нет |
| mirovoy_cassation | month | 3 | да (2) | cassation_filed_date | да |
| mirovoy_reasoned_making | working_day | 10 | нет | mirovoy_reasoned_date | нет |
| mirovoy_reasoned_request | working_day | 3 | нет | mirovoy_request_date | нет |
| private_complaint | working_day | 15 | нет | — | нет |
| protocol_remarks | working_day | 5 | нет | protocol_remarks_filed_date | нет |
| protocol_remarks_review | working_day | 5 | нет | — | нет |
| review_new_circumstances_filing | month | 3 | нет | — | нет |
| review_new_circumstances_restoration | month | 6 | нет | — | нет |
| settlement_approval_cassation_appeal | month | 1 | нет | — | да |
| simplified_appeal | working_day | 15 | нет | simplified_appeal_filed_date | нет |
| simplified_cassation_ksoyu | month | 3 | да (2) | cassation_filed_date | нет |
| simplified_reasoned_making | working_day | 10 | нет | simplified_reasoned_date | нет |
| simplified_reasoned_request | working_day | 5 | нет | simplified_reasoned_request_date | нет |
| sudebny_prikaz_cassation | month | 3 | нет | — | да |
| supervision | month | 3 | нет | — | да |
| treteisky_ispollist_cassation | month | 3 | нет | — | да |
| treteisky_osparivanie_cassation | month | 3 | нет | — | да |

Узлы с неполной автометаданной (см. `MANUAL_EXTRA_VARIANTS` в тесте, требуется
ручное чтение исходника — не reflection): `foreign_state_default_judgment_appeal`
(реестровая duration — заглушка, реальная 1 или 2 месяца по режиму),
`mirovoy_reasoned_request` (3 или 15 рабочих дней по явке),
`review_new_circumstances_filing` (у основания vs_practice_change — ещё и
шестимесячный потолок, которого нет в реестре вовсе).

## Расхождения (ANOMALY / ERROR)

Не найдено — все сценарии прошли чисто.

## Пример PASS-сценариев (по одному на узел)

Полная таблица (все 24656 сценариев) не приводится —
нечитаема в markdown; воспроизводится повторным запуском теста. Ниже — по
одному представительному PASS на узел, для наглядности формата.

| node_id | scenario_type | anchor_date | naive_deadline | actual_deadline | status |
|---|---|---|---|---|---|
| adoption_appeal | start_at_anomaly | 2020-01-01 | — | 2020-01-22 | PASS |
| appeal_general | start_at_anomaly | 2020-01-01 | — | 2020-02-03 | PASS |
| arbitration_award_setaside | start_at_anomaly | 2020-01-01 | — | 2020-04-01 | PASS |
| arbitration_competence_appeal | start_at_anomaly | 2020-01-01 | — | 2020-02-03 | PASS |
| cassation_ksoyu | start_at_anomaly | 2020-01-01 | — | 2020-04-01 | PASS |
| cassation_return_ruling_appeal | start_at_anomaly | 2020-01-01 | — | 2020-02-03 | PASS |
| cassation_vs | start_at_anomaly | 2020-01-01 | — | 2020-04-01 | PASS |
| child_return_appeal | start_at_anomaly | 2020-01-01 | — | 2020-01-22 | PASS |
| child_return_private_complaint | start_at_anomaly | 2020-01-01 | — | 2020-01-22 | PASS |
| court_order_objection | start_at_anomaly | 2020-01-01 | — | 2020-01-22 | PASS |
| default_judgment_appeal | start_at_anomaly | 2020-01-01 | — | 2020-02-03 | PASS |
| default_judgment_cancellation_request | start_at_anomaly | 2020-01-01 | — | 2020-01-17 | PASS |
| default_judgment_cassation_ksoyu | start_at_anomaly | 2020-01-01 | — | 2020-04-01 | PASS |
| enforcement_document_presentation | start_at_anomaly | 2020-01-01 | — | 2023-01-09 | PASS |
| foreign_judgment_enforcement_presentation | start_at_anomaly | 2020-01-01 | — | 2023-01-09 | PASS |
| foreign_judgment_recognition_objection | start_at_anomaly | 2020-01-01 | — | 2020-02-03 | PASS |
| foreign_state_default_judgment_appeal | start_at_anomaly | 2020-01-01 | — | 2020-02-03 | PASS |
| foreign_state_default_judgment_cancellation_request | start_at_anomaly | 2020-01-01 | — | 2020-03-02 | PASS |
| foreign_state_default_judgment_cassation_ksoyu | start_at_anomaly | 2020-01-01 | — | 2020-04-01 | PASS |
| mirovoy_appeal | start_at_anomaly | 2020-01-01 | — | 2020-02-03 | PASS |
| mirovoy_cassation | start_at_anomaly | 2020-01-01 | — | 2020-04-01 | PASS |
| mirovoy_reasoned_making | start_at_anomaly | 2020-01-01 | — | 2020-01-22 | PASS |
| mirovoy_reasoned_request | start_at_anomaly | 2020-01-01 | — | 2020-01-13 | PASS |
| private_complaint | start_at_anomaly | 2020-01-01 | — | 2020-01-29 | PASS |
| protocol_remarks | start_at_anomaly | 2020-01-01 | — | 2020-01-15 | PASS |
| protocol_remarks_review | start_at_anomaly | 2020-01-01 | — | 2020-01-15 | PASS |
| review_new_circumstances_filing | start_at_anomaly | 2020-01-01 | — | 2020-04-01 | PASS |
| review_new_circumstances_restoration | start_at_anomaly | 2020-01-01 | — | 2020-07-01 | PASS |
| settlement_approval_cassation_appeal | start_at_anomaly | 2020-01-01 | — | 2020-02-03 | PASS |
| simplified_appeal | start_at_anomaly | 2020-01-01 | — | 2020-01-29 | PASS |
| simplified_cassation_ksoyu | start_at_anomaly | 2020-01-01 | — | 2020-04-01 | PASS |
| simplified_reasoned_making | start_at_anomaly | 2020-01-01 | — | 2020-01-22 | PASS |
| simplified_reasoned_request | start_at_anomaly | 2020-01-01 | — | 2020-01-15 | PASS |
| sudebny_prikaz_cassation | start_at_anomaly | 2020-01-01 | — | 2020-04-01 | PASS |
| supervision | start_at_anomaly | 2020-01-01 | — | 2020-04-01 | PASS |
| treteisky_ispollist_cassation | start_at_anomaly | 2020-01-01 | — | 2020-04-01 | PASS |
| treteisky_osparivanie_cassation | start_at_anomaly | 2020-01-01 | — | 2020-04-01 | PASS |

## Шаг 5 — статический аудит (прямая арифметика с датами вне core/)

| файл | строка | фрагмент |
|---|---|---|
| src/views.js | 129 | `return toISODate(new Date(Date.UTC(y, m - 1, d)));` |
| web/app.js | 283 | `const d = new Date();` |
| web/app.js | 284 | `return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;` |
| web/app.js | 1341 | `const ics = buildICS(currentIcsTerms, { referenceDate: today, now: new Date() });` |

Каждое совпадение — кандидат на «забытый частный случай» (STATIC_FLAG), даже
если динамические сценарии выше его не поймали — см. п. Шаг 5 задачи. Разбор
(этим аудитом НЕ исправлено, только зафиксировано):

- `src/views.js:96` (`toISO`) — парсинг `YYYY-MM-DD` в `Date` для передачи в
  `toISODate` (core), сам результат не используется для суждения о
  рабочем/нерабочем дне напрямую — низкий риск.
- `web/app.js:1088` (`new Date()` как `now` для `buildICS`) — только штамп
  DTSTAMP файла .ics, не влияет на расчёт сроков — низкий риск.
- `web/app.js:248-249` (`todayISO`) — **требует внимания**: берёт текущую дату
  через `d.getFullYear()/getMonth()/getDate()` (локальный часовой пояс
  браузера), тогда как весь остальной расчёт (`core/calendar`,
  `core/engine`) работает в UTC-полночь. `today` из этой функции идёт в
  `referenceDate` (фильтрация напоминаний .ics, статусы expired/missed —
  см. `src/views.js`). В часовых поясах восточнее UTC локальная дата обгоняет
  UTC-дату на сутки в районе полуночи по UTC — возможен off-by-one в
  пограничные часы. Этот прогон его не поймал (динамические сценарии не
  затрагивают `todayISO`/часовые пояса), это находка исключительно
  статического шага 5 — требует отдельной проверки/решения, не входит в
  объём этого аудита календарных узлов.

