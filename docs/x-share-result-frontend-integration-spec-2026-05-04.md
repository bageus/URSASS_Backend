# X Share Result — чёткая спецификация для фронтенда (2026-05-04)

Ниже — что именно нужно сделать фронтенд-разработчикам, чтобы `Share result` всегда публиковал пост с картинкой, когда X подключён по OAuth.

## 1) Важное правило UX
Кнопка **Share result** у вас доступна только при подключенном X OAuth. Значит для этой кнопки должен использоваться **только API flow**:
- `POST /api/x/share-result`
- и **не** открывать `intentUrl` после успешного ответа.

`intentUrl` оставляйте только как fallback для общего "поделиться текстом" сценария, но не для кнопки, которая обещает attach картинки.

## 2) Какой контракт уже есть с бэком
`POST /api/share/start` сейчас возвращает:
- `shareResultApiUrl: "/api/x/share-result"`
- `preferredShareFlow: "x_api" | "intent"`
- `intentUrl` (для connected X теперь может быть `null`)

Для подключенного X ожидайте:
- `preferredShareFlow = "x_api"`
- `intentUrl = null`

## 3) Алгоритм фронта для кнопки Share result

### Шаг A
Вызвать `POST /api/share/start` и получить payload.

### Шаг B
Если `preferredShareFlow === "x_api"`:
1. Вызвать `POST ${shareResultApiUrl}`.
2. Если ответ `200` и `posted=true`:
   - показать success toast (`Shared to X`),
   - показать/открыть `tweetUrl` из ответа,
   - **не открывать** `intentUrl`.
3. Если не `200`:
   - показать ошибку c кодом из backend (`x_media_upload_failed`, `x_tweet_failed`, ...),
   - предложить fallback-кнопку `Open text share` (если `intentUrl` не пустой).

### Шаг C
Если `preferredShareFlow === "intent"`:
- открыть `intentUrl` (только текст/ссылка).

## 4) Почему это решает текущий баг
Сейчас пользователь видит текстовый пост без изображения, потому что публикуется intent/composer flow.
API flow (`/api/x/share-result`) создаёт твит с `media_ids`; это единственный путь прикрепить картинку автоматически в вашем сценарии.

## 5) Готовый чеклист для фронтенд PR
- [ ] После успешного `POST /api/x/share-result` не открывается `intentUrl`.
- [ ] В UI есть success с `tweetUrl`.
- [ ] Ошибки API показывают код/понятный текст.
- [ ] Intent используется только как fallback или для non-connected сценария.
- [ ] Добавлен telemetry event: `share_result_api_success` / `share_result_api_error` / `share_intent_opened`.

## 6) Минимальные примеры состояний UI
- `Sharing...` (на время вызова `/api/x/share-result`)
- `Shared to X ✅` + кнопка `Open tweet`
- `Could not attach image (x_media_upload_failed)` + кнопка `Share text instead`

