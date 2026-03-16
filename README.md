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
│   └── account.js       # Auth & account linking routes
├── models/
│   ├── Player.js
│   ├── PlayerUpgrades.js
│   ├── GameResult.js
│   ├── AccountLink.js
│   └── LinkCode.js
├── middleware/
│   └── rateLimiter.js
├── utils/
│   ├── verifySignature.js
│   ├── accountManager.js
│   └── upgradesConfig.js
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
| `POST` | `/api/store/buy` | Buy an upgrade or ride pack (requires EIP-191 signature) |
| `POST` | `/api/store/consume-ride` | Consume a ride when starting a game (requires unique `rideSessionId`) |
| `POST` | `/api/account/auth/telegram` | Authenticate via Telegram |
| `POST` | `/api/account/auth/wallet` | Authenticate via wallet (requires EIP-191 signature) |
| `POST` | `/api/account/link/request-code` | Generate a 6-character code to link Telegram to a wallet |
| `GET` | `/api/account/info` | Get account info |

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
