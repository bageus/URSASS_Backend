# URSASS TUBE Backend

Node.js/Express/MongoDB backend for the URSASS TUBE game.

## Tech Stack

- **Node.js** + **Express** – HTTP server and routing
- **MongoDB** + **Mongoose** – database and ODM
- **Telegram Bot API** (`node-telegram-bot-api`) – bot for account linking
- **ethers.js** – EIP-191 signature verification for wallet authentication

## Project Structure

```
URSASS_Backend/
├── server.js            # Express app entry point
├── database.js          # MongoDB connection
├── bot.js               # Telegram bot initialization
├── routes/
│   ├── leaderboard.js   # Leaderboard & game result routes
│   ├── store.js         # Upgrades & rides store routes
│   ├── account.js       # Auth & account linking routes
│   └── game.js          # Runtime game mode configuration routes
├── models/
│   ├── Player.js
│   ├── PlayerUpgrades.js
│   ├── DonationPayment.js
│   ├── GameResult.js
│   ├── AccountLink.js
│   └── LinkCode.js
├── middleware/
│   └── rateLimiter.js
├── utils/
│   ├── verifySignature.js
│   ├── accountManager.js
│   ├── upgradesConfig.js
│   ├── donationsConfig.js
│   ├── donationService.js
│   └── donationVerifier.js
├── .env.example
└── package.json
```

## Setup

```bash
git clone https://github.com/bageus/URSASS_Backend.git
cd URSASS_Backend
npm install
cp .env.example .env   # fill in your values
npm start
```
`package-lock.json` is committed and must be kept up to date for deterministic dependency installs (Railway-safe deployments).

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | HTTP port (default: `3000`) |
| `MONGO_URL` | MongoDB connection string |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_BOT_USERNAME` | Telegram bot username (without `@`) |
| `CORS_ALLOWED_ORIGINS` | Optional comma-separated list of extra allowed origins |
| `MAX_RESULT_TIMESTAMP_AGE_MS` | Max allowed age for game result timestamp in the past (default: `7200000`, i.e. 2h) |
| `MAX_RESULT_FUTURE_SKEW_MS` | Max allowed future clock skew for game result timestamp (default: `180000`, i.e. 3m) |
| `DONATIONS_PRICE_MODE` | Donation prices mode: `test` or `prod` (default: `test`) |
| `DONATIONS_NETWORK` | Donation network label (default: `Base`) |
| `DONATIONS_TOKEN_SYMBOL` | Donation token symbol (default: `USDT`) |
| `DONATIONS_TOKEN_DECIMALS` | Donation token decimals (default: `18`) |
| `DONATIONS_TOKEN_CONTRACT` | USDT contract address used for donation validation |
| `DONATIONS_MERCHANT_WALLET` | Merchant wallet that receives player transfers |
| `DONATIONS_TTL_MINUTES` | Payment intent lifetime in minutes (default: `30`) |
| `DONATIONS_REQUIRED_CONFIRMATIONS` | Required confirmations before crediting (default: `1`) |
| `DONATIONS_RPC_URL` | JSON-RPC endpoint used to verify donation transactions |
| `BASE_RPC_URL` | Preferred alias for donation RPC URL on Base network |
| `BSC_RPC_URL` | Legacy alias for donation RPC URL (still supported) |

See `.env.example` for a template.

## API Endpoints

Versioned aliases are also available under `/api/v1/*` (backward-compatible with current `/api/*`).

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/metrics` | Prometheus metrics endpoint |
| `GET` | `/api/leaderboard/top?wallet=` | Get top 10 players with `displayName` per entry (optional: include requesting player's position) |
| `POST` | `/api/leaderboard/save` | Save game result (requires EIP-191 signature) |
| `GET` | `/api/leaderboard/player/:wallet` | Get player info and history |
| `GET` | `/api/leaderboard/verified-results/:wallet` | Get verified game results for a wallet |
| `GET` | `/api/store/upgrades/:wallet` | Get player upgrades, rides, and balance |
| `GET` | `/api/store/donations/:wallet` | Get donation products available for a wallet |
| `POST` | `/api/store/buy` | Buy an upgrade or ride pack (requires EIP-191 signature) |
| `GET` | `/api/store/donations/history/:wallet` | Get donation payment history for a wallet (for purchases history UI) |
| `POST` | `/api/store/donations/create-payment` | Create a USDT donation payment intent |
| `POST` | `/api/store/donations/submit-transaction` | Submit tx hash for donation payment verification |
| `GET` | `/api/store/donations/payment/:paymentId` | Get donation payment status; optional `wallet` + `txHash` query can recover verification if wallet send succeeded but submit call was lost |
| `POST` | `/api/store/consume-ride` | Consume a ride when starting a game (requires unique `rideSessionId`) |
| `POST` | `/api/account/auth/telegram` | Authenticate via Telegram |
| `POST` | `/api/account/auth/wallet` | Authenticate via wallet (requires EIP-191 signature) |
| `POST` | `/api/account/link/request-code` | Generate a 6-character code to link Telegram to a wallet |
| `GET` | `/api/account/info` | Get account info |
| `GET` | `/api/game/config?mode=unauth` | Get runtime config for non-persistent game modes |
| `POST` | `/api/analytics/events` | Ingest analytics events batch (`{ sentAt, events: [...] }`) |
| `POST` | `/api/analytics/event` | Ingest a single analytics event (`{ sentAt, event: {...} }`) |


## Frontend Integration Note

- `https://bageus-github-io.vercel.app` is a frontend origin and is allowed by CORS.
- `https://ursasstube.fun`, `https://www.ursasstube.fun`, and `https://play.ursasstube.fun` are allowed by CORS.
- `https://api.ursasstube.fun` is also whitelisted (useful for same-site tooling / dashboards that call the API from that origin).
- API requests must target the deployed backend host (for example, Railway), not the frontend host itself.
- If you send `POST https://bageus-github-io.vercel.app/api/analytics/events`, Vercel frontend hosting may return `404 Not Found` because that route is not served there.

## Auth Headers

Authenticated endpoints resolve the caller identity from one of three request headers (checked in order):

| Header | Description |
|---|---|
| `X-Primary-Id` | **Preferred.** The canonical `primaryId` of the AccountLink record (e.g. `tg_123` or `0xabc`). |
| `X-Wallet` | **Fallback.** Wallet address *or* telegram primaryId (e.g. `tg_123`). The middleware tries `wallet` field first, then `primaryId` field. |
| `X-Telegram-Init-Data` | Raw Telegram WebApp `initData` string. Validated via HMAC; account looked up by `telegramId`. |

The auth middleware (`middleware/requireAuth.js`) performs cross-field lookups for robustness:

- When `X-Primary-Id` is provided: tries `{ primaryId }` first, then `{ wallet }` as fallback.
- When `X-Wallet` is provided: tries `{ wallet }` first, then `{ primaryId }` as fallback.

This ensures Telegram-only users (whose `primaryId` is `tg_<id>`) can authenticate even when the frontend sends their identifier in the `X-Wallet` header.

Any unmatched `/api/*` route returns `404 application/json { "error": "not_found" }` instead of an HTML page.

## Referral & Share Flow

### Overview

Players receive referral codes (8 chars, unambiguous alphabet) and can share their results daily for **+20 gold**. When a referred player completes their first valid run, both the referrer (**+50 gold**) and the new player (**+100 gold**) are rewarded.

### New Environment Variables

| Variable | Default | Description |
|---|---|---|
| `FRONTEND_BASE_URL` | — | Frontend origin for referral URLs (e.g. `https://ursasstube.fun`) |
| `SHARE_REWARD_DELAY_MS` | `30000` | Milliseconds between share start and confirm to receive gold |
| `SHARE_DAILY_REWARD_GOLD` | `20` | Gold awarded for daily share |
| `REFERRAL_REWARD_REFERRER_GOLD` | `50` | Gold awarded to referrer on new player's first run |
| `REFERRAL_REWARD_REFEREE_GOLD` | `100` | Gold awarded to new player on their first run |

### New Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/account/me/profile` | Required | Player profile: rank, gold, referral URL, streak, canShareToday |
| `POST` | `/api/referral/track` | Required | Record that current player was referred (body: `{ ref }`) |
| `POST` | `/api/share/start` | Required | Start a share session; returns `shareId`, `postText`, `imageUrl`, `intentUrl` |
| `POST` | `/api/share/confirm` | Required | Confirm share after ≥30s; awards +20 gold (body: `{ shareId }`) |

All endpoints are also available under `/api/v1/*`.

#### `GET /api/account/me/profile` response

```json
{
  "primaryId": "tg_123 | 0x...",
  "rank": 42,
  "totalRankedPlayers": 12500,
  "bestScore": 8350,
  "gold": 1240,
  "referralCode": "K7M3X9PA",
  "referralUrl": "https://ursasstube.fun/?ref=K7M3X9PA",
  "telegram": { "connected": true, "username": "vasya", "id": "123" },
  "wallet":   { "connected": true, "address": "0x..." },
  "x":        { "connected": false, "username": null },
  "shareStreak": 3,
  "canShareToday": true,
  "goldRewardToday": 20,
  "lastShareDay": "2026-04-25"
}
```

Auth headers accepted: `X-Primary-Id`, `X-Wallet`, `X-Telegram-Init-Data`.

### Migration

Run `scripts/migrations/2026-04-26-referral-and-share.js` to create the `shareevents` collection, add indexes, and backfill `referralCode` for existing players:

```bash
MONGO_URI='mongodb://...' node scripts/migrations/2026-04-26-referral-and-share.js
```

The script is idempotent — safe to run multiple times.

---

- Use `GET /api/game/config?mode=unauth` to fetch the runtime preset for browser users who choose not to authenticate.
- This mode is **non-persistent**: no leaderboard entry, no progress save, no store purchases, and no ride limits are enforced by the config response.
- The backend returns a ready-to-apply `activeEffects` object built with the same `calculateEffects` logic used for real player upgrades, so the frontend does not need to hardcode a separate improvement set.
- Current preset: `all_improvements_enabled` (max gameplay improvements enabled for preview/demo sessions).

## Store Upgrade Semantics

The store now contains **two parallel product systems**:

- `UPGRADES_CONFIG` for gameplay upgrades and rides purchased with in-game `gold` / `silver`
- `DONATIONS_CONFIG` for real-money style USDT donation packs that credit in-game currencies after on-chain verification

`create-payment` / `payment status` responses also include a prebuilt `txRequest` payload for an ERC-20 `transfer(...)` call, so the frontend can immediately open the connected wallet confirmation instead of manually assembling transaction data. The backend no longer exposes a `created` donation status; before a tx hash is submitted the payment record is non-final and `status` is `null`, while post-submit verification stays `submitted` until it resolves to `credited` or `failed`.

- `shield` is now a **1-level permanent progression**:
  - level 1 enables `activeEffects.start_with_shield = true`.
- `shield_capacity` is a separate **2-level permanent progression**:
  - level 1 (`2000 Gold`): `activeEffects.shield_capacity = 2`
  - level 2 (`5000 Gold`): `activeEffects.shield_capacity = 3`
- `alert` (Spin Alert) is now a **2-level permanent progression**:
  - level 1 (`1000 Gold`): `activeEffects.spin_alert_mode = "alert"`
  - level 2 (`3000 Gold`): `activeEffects.spin_alert_mode = "perfect"` and `activeEffects.perfect_spin_enabled = true`
- `radar_obstacles` is a **1-level permanent progression**:
  - level 1 (`2000 Gold`): `activeEffects.start_with_radar_obstacles = true`
- `radar_gold` is a **1-level permanent progression**:
  - level 1 (`3000 Gold`): `activeEffects.start_with_radar_gold = true`
- Backward-compatible request aliases for `POST /api/store/buy` are preserved:
  - `spin_alert` → `alert`
  - `spin_perfect` → `alert`
  - `start_with_alert` → `alert`
  - `start_with_radar` → `radar_gold`
  - `radar` → `radar_gold`

## Security

- **EIP-191 signatures** are required for all write operations that modify player state. The server reconstructs the signed message and verifies it matches the submitted wallet address using `ethers.js`.
- **Rate limiting is differentiated**: strict for `POST /api/leaderboard/save`, moderate for other write endpoints, and softer for read endpoints.
- **Anti-cheat validation** on `POST /api/leaderboard/save` rejects results with implausible values (score > 999,999; distance > 99,999 m; gold or silver coins > 999 per game).
- **Score anomaly metric** is tracked per player: `averageScore`, `scoreToAverageRatio` (`bestScore / averageScore`), and `suspiciousScorePattern` for extreme outliers.
- **Timestamp validation** accepts both unix seconds and milliseconds, allows stale results up to 2 hours old (`MAX_RESULT_TIMESTAMP_AGE_MS`), and allows up to 3 minutes future skew (`MAX_RESULT_FUTURE_SKEW_MS`).
- **Replay protection** – each game result signature can only be submitted once.
- **Ride anti-cheat** on `POST /api/store/consume-ride`: every consume request must include a unique `rideSessionId`; duplicate IDs are rejected without spending another ride.
- Legacy `POST /api/store/use-ride` is still supported for backward compatibility (without strict `rideSessionId` enforcement), but migration to `/consume-ride` is recommended.
- **Structured JSON logging** (stdout/stderr) for easy ingestion in Railway/ELK/Cloud logging
- **Security event trail**: suspicious actions (invalid timestamps/scores, duplicate ride sessions, rapid purchase bursts) are persisted in `SecurityEvent`.
- **Prometheus metrics** are exposed on `/metrics` (default Node process metrics + request latency + suspicious events counter).

## Deployment

The server is deployed on [Railway](https://railway.app). Set the environment variables listed above in your Railway project settings.

For better isolation under load, you can run the bot in a separate worker process:
- API: `npm run start:api` with `BOT_MODE=worker` (or `START_BOT_IN_PROCESS=false`)
- Bot worker: `npm run start:bot`

## Referral & Share Flow

### New Environment Variables

| Variable | Default | Description |
|---|---|---|
| `FRONTEND_BASE_URL` | *(none)* | Base URL for referral links, e.g. `https://ursasstube.fun` |
| `SHARE_REWARD_DELAY_MS` | `30000` | Milliseconds a user must wait after `/share/start` before confirming |
| `SHARE_DAILY_REWARD_GOLD` | `20` | Gold awarded per confirmed daily share |
| `REFERRAL_REWARD_REFERRER_GOLD` | `50` | Gold awarded to the referrer when the referee completes their first run |
| `REFERRAL_REWARD_REFEREE_GOLD` | `100` | Gold awarded to the referee on first run after being referred |

### Endpoints

#### Player Profile

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/account/me/profile` | `X-Primary-Id` header | Returns rank, bestScore, gold, referralUrl, share streak, connection status, rankDelta, nickname, leaderboardDisplay |
| `POST` | `/api/account/me/nickname` | `X-Primary-Id` header | Save or update player nickname |
| `POST` | `/api/account/me/display-mode` | `X-Primary-Id` header | Save leaderboard display mode |

**`GET /api/account/me/profile` Response:**
```json
{
  "primaryId": "tg_123",
  "rank": 42,
  "totalRankedPlayers": 12500,
  "bestScore": 8350,
  "gold": 1240,
  "referralCode": "K7M3X9PA",
  "referralUrl": "https://ursasstube.fun/?ref=K7M3X9PA",
  "telegram": { "connected": true, "username": "vasya", "id": "123" },
  "wallet": { "connected": true, "address": "0x..." },
  "x": { "connected": false, "username": null },
  "shareStreak": 3,
  "canShareToday": true,
  "goldRewardToday": 20,
  "lastShareDay": "2026-04-25",
  "rankDelta": -3,
  "nickname": "CoolPlayer",
  "leaderboardDisplay": "wallet"
}
```

`rankDelta` is the change in rank since the player's last completed game (positive = fell N places, negative = rose N places, `null` for the first read or when no wallet is linked). Updated server-side **only** when the player finishes a new game; reads of `/me/profile` never change the baseline.

**`POST /api/account/me/nickname` Body:** `{ "nickname": "CoolPlayer" }`

- `nickname` must match `/^[a-zA-Z0-9_]{3,16}$/`
- Reserved words are rejected: `admin`, `system`, `bot`, `null`, `undefined`, `anon`, `support`, `moderator`
- Returns `409` if the nickname is already taken by another player
- **Response:** `{ "ok": true, "nickname": "CoolPlayer" }`

**`POST /api/account/me/display-mode` Body:** `{ "mode": "wallet" | "nickname" | "telegram" }`

- `nickname` mode requires that `player.nickname` is already set
- `wallet` mode requires that a wallet is linked
- `telegram` mode requires that a Telegram account with a username is linked
- **Response:** `{ "ok": true, "mode": "wallet" }`

#### Referral Tracking

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/referral/track` | `X-Primary-Id` header | Attach a referral code to the current player |

**Body:** `{ "ref": "K7M3X9PA" }`

**Notes:**
- Idempotent — calling it twice returns `{ "already": true }`
- Self-referral is rejected (400)
- Rewards (+50 gold for referrer, +100 gold for referee) are granted automatically after the referee's **first valid game run**

#### Share Flow

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/share/start` | `X-Primary-Id` header | Start a share event; returns shareId, postText, imageUrl, intentUrl |
| `POST` | `/api/share/confirm` | `X-Primary-Id` header | Confirm the share after ≥30 s; awards 20 gold and updates streak |

**`/api/share/start` response:**
```json
{
  "shareId": "uuid",
  "postText": "I scored 8350 in Ursass Tube 🐻\n...",
  "referralUrl": "https://ursasstube.fun/?ref=K7M3X9PA",
  "imageUrl": "https://api.ursasstube.fun/api/leaderboard/share/image/0x....png",
  "intentUrl": "https://twitter.com/intent/tweet?text=...",
  "eligibleForReward": true,
  "secondsUntilReward": 30
}
```

**`/api/share/confirm` response (success):**
```json
{
  "awarded": true,
  "goldAwarded": 20,
  "shareStreak": 4,
  "totalGold": 1260
}
```

**Streak logic:**
- Streak +1 if `lastShareDay === yesterday`
- Streak resets to 1 if the player missed a day
- `/me/profile` returns `shareStreak: 0` for display if streak is stale (DB not mutated until next confirm)

### Migration

Run once after deployment to backfill `referralCode` for existing players and create necessary indexes:

```bash
node scripts/migrations/2026-04-26-referral-and-share.js
```

The migration is **idempotent** — safe to run multiple times.

---

## X (Twitter) OAuth

> **Note:** Real tweet-level verification (checking that a post with a given tweetId was actually published) is a future PR. This section describes the OAuth connect/disconnect foundation.

### Setup in X Developer Portal

1. Create an application at [developer.twitter.com](https://developer.twitter.com).
2. Enable **OAuth 2.0** in the app settings.
3. Set the **Callback URL** to your `X_OAUTH_REDIRECT_URI`, e.g. `https://api.ursasstube.fun/api/x/oauth/callback`.
4. Request at least these **Scopes**: `tweet.read users.read offline.access`.
5. Copy your **Client ID** (and **Client Secret** for confidential clients) into the environment variables below.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `X_OAUTH_CLIENT_ID` | *(required)* | OAuth 2.0 Client ID from X Developer Portal |
| `X_OAUTH_CLIENT_SECRET` | *(required for confidential clients)* | Client Secret; omit if using public client |
| `X_OAUTH_PUBLIC_CLIENT` | `false` | Set `true` to skip Basic auth on token exchange (public client) |
| `X_OAUTH_REDIRECT_URI` | *(required)* | e.g. `https://api.ursasstube.fun/api/x/oauth/callback` |
| `X_OAUTH_SCOPES` | `tweet.read users.read offline.access` | Space-separated scopes |

If `X_OAUTH_CLIENT_ID` or `X_OAUTH_REDIRECT_URI` are missing, all `/api/x/*` endpoints return **503 `application/json { error: "x_oauth_not_configured" }`** — the server does not crash.

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/x/oauth/start` | `X-Primary-Id` or `X-Wallet` header | Start OAuth flow; redirects to X or returns `{ authorizeUrl }` with `?mode=json` |
| `GET` | `/api/x/oauth/callback` | *(none — X redirects here)* | Handles code exchange; redirects back to frontend |
| `POST` | `/api/x/disconnect` | `X-Primary-Id` or `X-Wallet` header | Revoke tokens and unlink X account |
| `GET` | `/api/x/status` | `X-Primary-Id` or `X-Wallet` header | Returns current X connection status |

Versioned aliases at `/api/v1/x/*` also work.

#### `GET /api/x/oauth/start`

- Generates PKCE pair, stores `OAuthState` (TTL 5 min), redirects 302 to X authorization URL.
- Add `?mode=json` to receive `{ "authorizeUrl": "..." }` instead of a redirect (useful for SPAs opening a popup/tab).
- When env variables are absent returns `503 application/json { error: "x_oauth_not_configured" }`.

#### `GET /api/x/oauth/callback`

Handles the redirect from X after user grants or denies access.

**Success redirect:**
```
${FRONTEND_BASE_URL}/?x=connected&username=<x_username>
```

**Error redirect:**
```
${FRONTEND_BASE_URL}/?x=error&reason=<reason>
```

Possible `reason` values:

| reason | Description |
|---|---|
| `access_denied` | User denied the X authorization |
| `missing_params` | `code` or `state` missing in callback |
| `invalid_state` | `state` not found or expired (CSRF protection) |
| `already_linked_to_another_player` | This X account is already connected to a different player. A security event is logged with both `primaryId` values for audit. |
| `token_exchange_failed` | Error calling X token endpoint |
| `fetch_user_failed` | Error fetching user info from X |
| `player_not_found` | Player record not found |
| `server_error` | Unexpected server error |

#### `POST /api/x/disconnect`

Unlinks the connected X account. Attempts best-effort token revocation.

**Response:**
```json
{ "disconnected": true }
```

#### `GET /api/x/status`

**Response:**
```json
{
  "connected": true,
  "username": "bearplayer",
  "connectedAt": "2026-04-25T12:00:00.000Z"
}
```
