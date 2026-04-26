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
| `GET` | `/api/leaderboard/top?wallet=` | Get top 10 players (optional: include requesting player's position) |
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



## Unauthenticated Browser Mode

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
| `GET` | `/api/account/me/profile` | `X-Primary-Id` header | Returns rank, bestScore, gold, referralUrl, share streak, connection status |

**Response:**
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
  "lastShareDay": "2026-04-25"
}
```

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
