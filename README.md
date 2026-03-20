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
| `DONATIONS_NETWORK` | Donation network label (default: `BSC`) |
| `DONATIONS_TOKEN_SYMBOL` | Donation token symbol (default: `USDT`) |
| `DONATIONS_TOKEN_DECIMALS` | Donation token decimals (default: `18`) |
| `DONATIONS_TOKEN_CONTRACT` | USDT contract address used for donation validation |
| `DONATIONS_MERCHANT_WALLET` | Merchant wallet that receives player transfers |
| `DONATIONS_TTL_MINUTES` | Payment intent lifetime in minutes (default: `30`) |
| `DONATIONS_REQUIRED_CONFIRMATIONS` | Required confirmations before crediting (default: `1`) |
| `DONATIONS_RPC_URL` | JSON-RPC endpoint used to verify donation transactions |
| `BSC_RPC_URL` | Alias for donation RPC URL |

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
- Backward-compatible request aliases for `POST /api/store/buy` are preserved:
  - `spin_alert` → `alert`
  - `spin_perfect` → `alert`
  - `start_with_alert` → `alert`
  - `start_with_radar` → `radar`

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
