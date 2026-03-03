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

Running `npm install` generates `package-lock.json` for deterministic dependency installs.

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | HTTP port (default: `3000`) |
| `MONGO_URL` | MongoDB connection string |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_BOT_USERNAME` | Telegram bot username (without `@`) |

See `.env.example` for a template.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/leaderboard/top?wallet=` | Get top 10 players (optional: include requesting player's position) |
| `POST` | `/api/leaderboard/save` | Save game result (requires EIP-191 signature) |
| `GET` | `/api/leaderboard/player/:wallet` | Get player info and history |
| `GET` | `/api/leaderboard/verified-results/:wallet` | Get verified game results for a wallet |
| `GET` | `/api/store/upgrades/:wallet` | Get player upgrades, rides, and balance |
| `POST` | `/api/store/buy` | Buy an upgrade (requires EIP-191 signature) |
| `POST` | `/api/store/buy-rides` | Buy rides (requires EIP-191 signature) |
| `POST` | `/api/store/consume-ride` | Consume a ride when starting a game |
| `POST` | `/api/account/auth/telegram` | Authenticate via Telegram |
| `POST` | `/api/account/auth/wallet` | Authenticate via wallet (requires EIP-191 signature) |
| `POST` | `/api/account/link/generate` | Generate a 6-character code to link Telegram to a wallet |
| `GET` | `/api/account/info` | Get account info |

## Security

- **EIP-191 signatures** are required for all write operations that modify player state. The server reconstructs the signed message and verifies it matches the submitted wallet address using `ethers.js`.
- **Rate limiting** is applied to all endpoints via `middleware/rateLimiter.js`.
- **Anti-cheat validation** on `POST /api/leaderboard/save` rejects results with implausible values (score > 999,999; distance > 99,999 m; gold or silver coins > 999 per game).
- **Timestamp validation** rejects requests where the signed timestamp is more than 10 minutes old.
- **Replay protection** – each game result signature can only be submitted once.

## Deployment

The server is deployed on [Railway](https://railway.app). Set the environment variables listed above in your Railway project settings.
