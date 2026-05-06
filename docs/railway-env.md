# Railway env variables for Telegram Analytics

## Backend service (URSASS_Backend on Railway)
Add these variables to the **backend Railway service**:

- `TG_ANALYTICS_ENABLED=true`
- `TG_ANALYTICS_TOKEN=<token from Telegram Analytics>`
- `TG_ANALYTICS_APP_NAME=ursass_tube`

These `TG_*` variables are read by backend runtime (Node.js process) and exposed via public config endpoint for frontend initialization.

## Frontend service (if frontend is deployed separately)
If frontend is built separately (for example Vite build in another Railway service), add these variables to the **frontend Railway service**:

- `VITE_TG_ANALYTICS_ENABLED=true`
- `VITE_TG_ANALYTICS_TOKEN=<token from Telegram Analytics>`
- `VITE_TG_ANALYTICS_APP_NAME=ursass_tube`

## TG_* vs VITE_TG_*
- `TG_*` — backend runtime variables (server-side).
- `VITE_TG_*` — frontend build-time/public variables. They become part of frontend bundle and are not private secrets.

## Security notes
- Do **not** commit real token values to git.
- Keep real values only in Railway Variables.
- Do not place private secrets (DB URL, JWT secret, bot token, private keys) into public frontend config endpoints.

## Redeploy behavior
- When changing backend `TG_*`, backend restart/redeploy applies updates.
- When changing frontend `VITE_*`, you must rebuild/redeploy frontend so new values get embedded into bundle.
