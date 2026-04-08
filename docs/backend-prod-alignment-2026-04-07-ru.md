# Backend alignment plan к прод-выводу (07.04.2026)

## Что синхронизировано в этом PR

### P1.2 Аналитика (обязательно)
- Реализован ingest endpoint `POST /api/analytics/events`.
- Поддержан батч-контракт фронтенда: корневые поля `sentAt` и `events[]`.
- Валидация/нормализация событий:
  - допускаются `game_start`, `game_end`, `session_length`, `run_duration`, `upgrade_purchase`, `currency_spent`;
  - обязательны `name` и `timestamp`;
  - payload очищается от `undefined` и функций.
- Добавлено сохранение событий в Mongo (`AnalyticsEvent`) через `insertMany`.
- Добавлены метрики ingest-надежности для observability gate:
  - `app_analytics_ingest_total{status="accepted|invalid|stored|failed"}`.

### Контрактная совместимость API (P1.3/P0/P1.1)
- Проверена совместимость существующих backend endpoint’ов, активно используемых frontend:
  - auth: `/api/account/auth/*`;
  - store/donation: `/api/store/*`, `/api/donations/*`;
  - leaderboard: `/api/leaderboard/*`.
- Регрессионные integration-тесты оставлены обязательными в `npm test`.

## Ближайшие шаги (после merge)
1. Подключить экспорт analytics из Mongo в warehouse/reporting (cron/stream).
2. Добавить SLO/алерты на `failed > 0` и `invalid` всплески.
3. В CI окружении с доступом к advisories сделать обязательный security gate (`npm audit --omit=dev --audit-level=moderate`).
4. Добавить CI parity check Node major-version (22+) по аналогии с frontend release gates.
