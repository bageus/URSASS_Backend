# X Share Result: почему не прикрепляется файл со скором (investigation 2026-05-04)

## Что проверено

### Backend (`URSASS_Backend`)
- `routes/x.js` → `POST /api/x/share-result`:
  - генерирует PNG (`renderScoreSharePng`),
  - загружает медиа (`xOAuth.uploadMedia`),
  - создаёт твит с `media_ids`.
- `utils/xOAuth.js`:
  - upload идёт в `https://upload.twitter.com/1.1/media/upload.json`,
  - tweet идёт в `POST https://api.twitter.com/2/tweets`.

### Frontend (`Ursasstube`, проверка через web/raw GitHub)
Файл `js/share/shareFlow.js` сейчас делает **оба шага подряд**:
1. вызывает `shareResultEndpoint` (серверный пост с медиа),
2. после этого **всегда** открывает `intentUrl` (composer в X).

Это видно прямо в коде:
- `postShareResultMedia(...)` вызывается первым,
- затем `if (intentUrl) { openUrl(intentUrl); }` выполняется без условия на результат медиа-поста.

## Корневая причина наблюдаемого поведения
Если пользователь нажимает `Share result`, он попадает в web-intent окно X, где изображения от backend-поста не «подставляются» в composer.

То есть пользователь видит именно intent UI (часто без файла), хотя backend мог уже успешно опубликовать пост с картинкой отдельно.

Это выглядит как «файл не прикрепился», но фактически смешаны два разных флоу:
- **Flow A**: backend direct post (медиа есть),
- **Flow B**: intent composer (медиа не прикрепляет локально/автоматически из backend-вызова).

## Вывод по вопросу «возможно ли прикрепление файла?»
- Через backend `POST /api/x/share-result` — **да, возможно** (при корректных правах/токенах X).
- Через `intentUrl` — **нет, не как attach-файл из текущего клика**; intent предназначен для текста/ссылок и отдельного пользовательского действия в UI.

## Что менять (комплексно)

### 1) Frontend (`Ursasstube`) — обязательно
В `js/share/shareFlow.js` разделить режимы:

- Если `postShareResultMedia(...)` вернул `ok=true`:
  - НЕ открывать `intentUrl`,
  - показывать пользователю «Posted to X» + ссылка на твит (если backend вернёт URL) или просто success.

- Если `postShareResultMedia(...)` неуспешен:
  - использовать `intentUrl` как fallback только для text/share link,
  - явно писать в UI: «откроется окно шаринга без авто-прикрепления картинки».

Иначе пользователь всегда видит intent и воспринимает это как сбой прикрепления.

### 2) Backend (`URSASS_Backend`) — желательно
Усилить диагностичность `POST /api/x/share-result`:
- возвращать более точные коды:
  - `x_media_upload_failed`
  - `x_token_refresh_failed`
  - `x_permissions_missing`
  - `x_tweet_failed`
- логировать upstream status/body (redacted), чтобы быстро отличать права приложения от токен-проблем.

Опционально: добавить поле в успешный ответ `tweetUrl` (уже есть), а во frontend использовать его в success-нотификации вместо открытия intent.

## Практический итог
Текущая «неприкрепляемость файла» в UX в основном вызвана тем, что frontend всегда открывает `intentUrl` даже после серверного постинга медиа.

То есть это не только платформенное ограничение, а конкретная интеграционная логика фронта + бэка, которую нужно разрулить условным флоу.
<<<<<<< codex/investigate-file-attachment-issue-on-share-result-kb7y67


## Ответ на кейс из скриншота (почему пост уже опубликован, но без картинки)
Если пост появился в профиле X **без media-блока**, значит в X ушёл текстовый флоу (intent/fallback), а не успешный media-post через `/api/x/share-result`.

По текущему коду backend не может "тихо" создать твит без media в этом роуте:
- при пустом `mediaId` сервер возвращает `502 x_media_upload_failed` и не должен успешно завершать шаринг;
- успешный `POST /api/x/share-result` всегда вызывает `createTweet(... media_ids ...)`.

Следовательно, для вашего кейса наиболее вероятно:
1. фронт открыл `intentUrl` (или fallback после ошибки),
2. вы опубликовали текстовый пост из composer,
3. картинка из backend туда не прикрепилась (это другой флоу).

Проверка в проде за 2 минуты:
- в Network браузера найти запрос `POST /api/x/share-result` в момент клика;
- если его нет или он не `200` — опубликован intent-текст;
- если `200`, взять `tweetUrl` из ответа и открыть его: именно этот твит должен быть с картинкой.


## Разбор присланного payload
Пример:
- `reason: "already_shared_today"`
- `intentUrl: "https://twitter.com/intent/tweet?..."`
- `shareResultApiUrl: "/api/x/share-result"`
- `imageUrl/postImageUrl`: ссылка на PNG

Что это означает:
1. `already_shared_today` относится к механике награды/стрика, а не к технической возможности постинга в X.
2. `imageUrl`/`postImageUrl` — это URL изображения для preview/share page; сам по себе этот URL не прикрепляет файл к intent composer.
3. Для реального attach media в твит нужен вызов `POST /api/x/share-result` и успешный ответ.
4. Если UI открыл `intentUrl` и пользователь нажал Post там, публикуется текстовый пост (как на скриншоте), даже если PNG существует по `imageUrl`.

Итог по вашему JSON: проблема не в генерации PNG (он есть), проблема в том, что публикуется intent-flow, где вложение не подтягивается автоматически.
=======
>>>>>>> dev
