# Backend review (pipeline mirror) — URSASS_Backend

Date: 2026-04-30  
Scope: `/workspace/URSASS_Backend`


## Актуализация плана (проверка на 2026-04-30)

Статус: **план в целом актуален**; ключевые риски из отчёта по-прежнему присутствуют в текущем коде.

### Что подтверждено как актуальное
- Дублирование монтирования роутов для `/api/*` и `/api/v1/*` в `app.js` сохраняется.
- Alias-маршруты `/api/analytics` и `/api/telemetry` (и соответствующие `/api/v1/*`) по-прежнему присутствуют.
- In-memory кэш leaderboard (`topLeaderboardCache`) остаётся локальным для процесса и не имеет event-driven invalidation.
- В `leaderboard` всё ещё используются два middleware для share-контекста (JSON/HTML) с похожей логикой.
- Метрики и health есть, но формализованных rollback-gates в коде/конфигурации нет.

### Что уточнено по формулировкам
- Пункт про `computeDisplayName` vs `buildDisplayName` остается валидным как архитектурный smell, но это не блокер — скорее вопрос консистентности policy отображения имени.
- Пункт про неиспользуемые endpoint'ы требует прод-данных usage (access logs + `/metrics`), поэтому сейчас корректный статус: **гипотеза, требующая подтверждения**.

### Вывод
План P0/P1/P2 можно исполнять без пересборки гипотез. Для снижения риска рекомендовано начать с P0 и параллельно собрать route-level usage, чтобы закрыть пункт по потенциально неиспользуемым alias-маршрутам на фактах.

---

## 1) Архитектурные дубли сервисов

### 1.1 Дублирование роутов API v0/v1
В `app.js` каждый роут регистрируется дважды: под `/api/*` и `/api/v1/*`. Это осознанная совместимость, но сейчас реализована копипастой и создает риск рассинхронизации при добавлении новых модулей.

**Риск:** новые endpoint'ы могут быть добавлены только в один namespace.  
**Рекомендация:** вынести список маршрутов в массив и монтировать программно одной функцией.

### 1.2 Дублирование логики формирования displayName
В `routes/leaderboard.js` одновременно используются `computeDisplayName` и `buildDisplayName`, обе решают схожую задачу форматирования публичного имени игрока, но с разными правилами приоритета.

**Риск:** расхождение UX между ответами leaderboard и другими публичными поверхностями.  
**Рекомендация:** единый policy-модуль `services/displayNamePolicyService.js` с явными режимами (`leaderboard`, `share`, `profile`).

### 1.3 Дублирование паттерна wallet+context middleware
В `routes/leaderboard.js` есть два очень похожих middleware: `loadShareContextByWallet` (JSON) и `loadSharePageContextByWallet` (HTML), различающиеся только способом ответа на ошибку.

**Риск:** при изменении валидации/ошибок возможна деградация только на одной ветке.  
**Рекомендация:** оставить общий resolver и инъецируемый error renderer (`json`/`html`) через фабрику middleware.

---

## 2) Неиспользуемые endpoints / DTO

### 2.1 Потенциально неиспользуемые alias-маршруты
В `app.js` подключены `analyticsRoutes` одновременно как `/api/analytics` и `/api/telemetry` (аналогично для `/api/v1/*`). Это может быть намеренный alias, но без telemetry-спецификации в документации увеличивает surface area API.

**Проверка в проде:** снять usage по route label через `/metrics` и access logs, затем удалить низкоиспользуемый alias.

### 2.2 Смешение DTO в account auth
`POST /api/account/auth/telegram` и `POST /api/account/auth/wallet` возвращают пересекающиеся, но не полностью одинаковые поля (`displayName`, `telegramUsername`, `isLinked` и т.д.).

**Риск:** фронтенд вынужден держать развилки по источнику авторизации.  
**Рекомендация:** формализовать `AccountAuthResponseV1` и всегда возвращать одинаковый DTO-контракт (nullable поля допустимы).

---

## 3) Индексы и N+1

### 3.1 N+1 в `/leaderboard/top` для авторизованного wallet
В `routes/leaderboard.js` после получения top-10 выполняются дополнительные запросы для текущего wallet:
- `Player.findOne({ wallet })`
- `AccountLink.findOne({ $or: [...] })`
- `Player.countDocuments({ bestScore: { $gt: ... } })`

**Эффект:** при росте трафика на персонализированный top увеличивается latency и нагрузка на MongoDB.

**Рекомендация:**
1. Перенести rank в precomputed aggregate (периодический refresh).  
2. Для персонализированного rank использовать отдельный lightweight cache по wallet (TTL 15–60s).  
3. Для top payload уже есть cache; расширить его до двух ключей: anonymous / personalized.

### 3.2 Индексное покрытие PlayerRun под segment percentile
`services/leaderboardInsightsService.js` считает percentile через `countDocuments` по фильтрам `{ verified: true, isValid: true, isFirstRun: true }` + поле (`score/distance/goldCoins`).

Текущие индексы в `PlayerRun` частично покрывают поле `isFirstRun`, но не включают `verified` и `isValid` в составных индексах для этих селектов.

**Рекомендация (проверить explain):**
- добавить составные индексы вида `{ verified: 1, isValid: 1, isFirstRun: 1, score: -1 }`,
  `{ verified: 1, isValid: 1, isFirstRun: 1, distance: -1 }`,
  `{ verified: 1, isValid: 1, isFirstRun: 1, goldCoins: -1 }`.

### 3.3 TTL/cleanup consistency
Для `LinkCode` и `OAuthState` TTL задан через `createdAt.expires`, а бизнес-логика также использует `expiresAt`.

**Риск:** рассинхрон фактического срока жизни записи при ручных update `expiresAt`.  
**Рекомендация:** выбрать единственный source-of-truth для expiration (предпочтительно `expiresAt` + TTL index на нем).

---

## 4) Caching policy

### 4.1 Есть только in-memory cache top leaderboard
В `routes/leaderboard.js` cache реализован in-process (`topLeaderboardCache`) c TTL.

**Риск:**
- cache не shared между инстансами;
- cold-start на serverless/горизонтальном scaling;
- нет invalidation по событию обновления score.

**Рекомендация:**
- вынести cache в Redis/Upstash;
- добавить активную инвалидацию на `saveResult`/изменение `bestScore`;
- добавить stale-if-error для деградационного режима.

### 4.2 Нет cache policy matrix по endpoint-классам
Сейчас нет централизованной таблицы: какие endpoint'ы cacheable, какие персонализированные, какие нельзя кэшировать.

**Рекомендация:** добавить документ `docs/cache_policy.md` с классами:
- public deterministic (cacheable),
- public volatile (short TTL),
- personalized (private cache),
- transactional (no cache).

---

## 5) Observability / rollback gates

### 5.1 Базовая observability есть, но без SLO/SLI контрактов
`middleware/requestMetrics.js` дает route counters/latency buckets/suspicious events, плюс `/health` и `/metrics` в `app.js`.

**Пробел:** нет формализованных rollback-gates (авто-условий отката) на деплой.

### 5.2 Рекомендуемые rollback gates (для CI/CD)
Добавить release-gates перед traffic shift:
1. **Error-rate gate**: 5xx > 2% за 5 минут по ключевым endpoint'ам (`/api/game/save-result`, `/api/leaderboard/top`, `/api/store/*`) → авто rollback.  
2. **Latency gate**: p95 > 800ms (5 минут) для `/api/leaderboard/top` → freeze rollout.  
3. **DB gate**: рост `mongodb readyState != 1` или timeout spikes → rollback.  
4. **Business gate**: резкий рост `donation_failed`/`wallet_connect_failed` в analytics ingest counters.

### 5.3 Что добавить в код для готовности к gate-based rollout
- Prometheus-compatible p95 histogram (сейчас только summary-like avg/max).  
- deployment label/version label в `/metrics` для сравнения baseline/canary.  
- feature flags для risk endpoints (`leaderboard insights`, `donations provider switch`) с fast disable без redeploy.

---

## Приоритетный план действий

### P0 (1–2 дня)
- [x] Ввести единый routing registry для `/api` и `/api/v1`. *(выполнено: 2026-04-30, `app.js`)*
- [x] Зафиксировать единый DTO ответов account auth. *(выполнено: 2026-04-30, `routes/account.js`)*
- [x] Утвердить rollback-gates в CI/CD и алерты. *(выполнено: 2026-04-30, `docs/release_rollback_gates.md`)*

### P1 (2–4 дня)
- [x] Проверить `explain()` и добавить индексы для percentile-запросов в `PlayerRun`. *(выполнено: 2026-04-30, `models/PlayerRun.js`)*
- [ ] Перевести top leaderboard cache в Redis и добавить инвалидацию по событию обновления bestScore.
- [ ] Собрать usage по alias endpoint'ам (`/telemetry`) и удалить неиспользуемые.

### P2 (ongoing)
- [ ] Унифицировать displayName policy в отдельном сервисе.
- [ ] Вынести cache policy matrix в документацию и тесты.
- [ ] Ввести canary rollout + auto rollback по SLO gates.
