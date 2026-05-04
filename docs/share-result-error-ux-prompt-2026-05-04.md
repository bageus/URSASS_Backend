# Share Result: диагностика ошибки и готовый prompt на исправление (2026-05-04)

## Что видно по фактам

- В браузере при клике `Share result` уходит `POST /api/x/share-result` и приходит `500 Internal Server Error`.
- На backend маршрут `routes/x.js` в случае нераспознанной ошибки от X API возвращает общий `500 { error: "Server error" }`.
- В том же маршруте есть специальный кейс `x_media_upload_failed` (502), но он срабатывает только когда upload вернул пустой `media_id`; остальные сбои (429/403/5xx/X API errors) уходят в общий 500.
- На frontend показывается сообщение про ошибку прикрепления картинки, что UX-переизбыточно для пользователя в моменте (пользователь и так видит, что шаринг не завершился).

## Вероятная первопричина

Комбинированная:

1. **Backend**: слишком грубая обработка ошибок в `/api/x/share-result` (всё схлопывается в `Server error`), из-за чего frontend не может различать технические причины.
2. **Frontend**: агрессивный UX для ошибки attach (показывает «ошибку прикрепления изображения» в явном виде даже когда полезнее мягкий fallback).

## Что исправлять

### Backend

- Нормализовать ошибки X API в стабильные коды:
  - `x_media_upload_failed`
  - `x_rate_limited`
  - `x_auth_expired`
  - `x_post_failed`
- В ответ добавлять `retryable: boolean` и `fallback: "text_intent" | null`.
- Не возвращать общий `Server error`, если ошибка классифицируема.
- Логи: сохранять `xStatus`, `xErrorCode`, `requestId`, `primaryId(masked)`.

### Frontend

- Для кнопки **Share result**:
  - Если `posted=true` — успех.
  - Если `fallback === "text_intent"` — **не показывать пугающий attach-error**; показать нейтральный toast: «Не удалось опубликовать с картинкой, открыть текстовый share?» + CTA.
  - Для `x_rate_limited` — «Слишком часто, попробуйте через минуту».
  - Для `x_auth_expired` — «Переподключите X».
- Сообщение «ошибка прикрепления изображения» убрать из дефолтного UX и оставить только для debug/dev режима.

## Готовый prompt для исполнителя (Cursor/Codex)

```text
Ты работаешь с двумя репозиториями:
- backend: URSASS_Backend
- frontend: Ursasstube

Задача: исправить UX и надежность сценария Share result.

Симптом:
- При клике Share result иногда приходит POST /api/x/share-result -> 500.
- На фронте показывается явный текст про ошибку прикрепления изображения, что раздражает пользователя.

Сделай:

1) Backend (URSASS_Backend)
- В routes/x.js для POST /api/x/share-result добавь классификацию ошибок X API.
- Возвращай структурированные ошибки:
  - { error: "x_media_upload_failed", retryable: true, fallback: "text_intent" }
  - { error: "x_rate_limited", retryable: true, fallback: "text_intent" }
  - { error: "x_auth_expired", retryable: false, fallback: null }
  - { error: "x_post_failed", retryable: true, fallback: "text_intent" }
- Сохрани текущий happy path (tweet c media_ids).
- Добавь/обнови тесты для новых веток ошибок.

2) Frontend (Ursasstube)
- В обработчике Share result перестань показывать «ошибка прикрепления изображения» как дефолт.
- Используй error contract с backend:
  - fallback=text_intent -> мягкий toast + кнопка «Поделиться текстом».
  - x_auth_expired -> CTA «Подключить X снова».
  - x_rate_limited -> нейтральный retry toast.
- Для 500 без contract показывай общий «Не удалось поделиться, попробуйте позже».

3) UX acceptance criteria
- Пользователь не видит технический attach-error как основной текст.
- При проблемах есть понятный следующий шаг (retry, reconnect, share text).
- Если backend вернул posted=true, никаких fallback окон не открывается.

4) Deliverables
- PR в backend + PR во frontend.
- Короткий changelog и таблица: error code -> user message -> action.
```
