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
