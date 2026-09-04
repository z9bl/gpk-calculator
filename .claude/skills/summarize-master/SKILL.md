---
name: independent-term-node
description: >
  Use when adding a new deadline/term to the gpk-calculator that does NOT hang off
  the existing appeal chain (computeChain / entry_into_force) — i.e. it has its own
  trigger date unrelated to the main лица дела flow (e.g. приказное производство,
  a new independent срок tied to its own single input date). Covers wiring a term
  through computeIndependentTerms, a new situations.js branch, UI field, .ics export,
  and tests. NOT for terms that branch off an existing chain node (appeal/cassation/
  entry_into_force variants) — those follow the norm_versions pattern instead.
---

# Добавление независимого узла срока (gpk-calculator)

Независимый узел — срок, который не встроен в `computeChain` (цепочку обжалования),
а считается от собственного самостоятельного input, введённого пользователем напрямую
(как `SUPERVISION`, `PRIVATE_COMPLAINT`, `PROTOCOL_REMARKS`). Типичный триггер —
отдельный процессуальный трек (приказное производство, самостоятельное заявление
и т.п.), не являющийся веткой основной цепочки.

## Чеклист

1. **`src/chain.js`**
   - Константа термина: `id`, `title`, `duration`, `anchor: { event, offset_start }`,
     `condition` (обычно = имя input-поля), `weekend_shift`, `ics`, `logic`,
     `midnight_rule`, `norm_versions` (одна версия, если норма не менялась —
     не плодить редакции без необходимости).
   - Регистрация в `computeIndependentTerms(inputs)` через `computeSimpleTerm(TERM, inputs?.<field>)`.
   - Экспорт константы.

2. **`src/views.js`**
   - Карточка: переиспользовать существующий рендерер по типу срока
     (`monthTermCard` подходит для любого срока с единым `duration`/`norm`/`logic`,
     несмотря на название — не заводить дублирующую функцию без нужды).
   - `INPUT_LABELS`: подпись поля для UI.
   - Если рядом со старым узлом была статическая заглушка (`*_STUBS`), которую
     заменяет новый узел — убрать соответствующий элемент из заглушек.

3. **`src/situations.js`**
   - Если узел — часть отдельного процессуального трека (не «прочие независимые
     сроки»): новая ситуация `{ id, label, primary_field, fields: [], nodes: [...] }`.
   - Если это разовый доп. срок в духе «частная жалоба / замечания на протокол»:
     добавить в существующую ситуацию `separate`.
   - Прогнать структурный тест покрытия узлов (`allSituationNodes()`) — новый узел
     должен попасть ровно в одну ситуацию.

4. **`src/ics.js`**
   - Зарегистрировать узел в реестре `.ics`-экспорта по образцу `private_complaint`:
     title, deadline, `norm.primary`, `TERM.ics`, `TERM.duration`.

5. **`web/app.js`**
   - Label + hint-текст для нового input-поля.
   - Подключить поле к разметке соответствующей ситуации.

6. **Тесты**
   - `chain.test.js`: расчёт даты, `condition`/отсутствие узла без данных, edge-cases
     переноса через выходные.
   - `views.test.js`: карточка при заполненном поле; если убрали заглушку — проверить,
     что она пропала, а соседние остались.
   - Структурный тест ситуаций: новый узел учтён.
   - `ics.test.js`: узел попадает в экспорт.

## Не делать
- Не встраивать в `computeChain`, если срок не зависит от исхода основной цепочки.
- Не заводить несколько `norm_versions`, если норма не менялась исторически.
- Не переизобретать карточку/рендерер, если существующий обобщённый уже подходит.
