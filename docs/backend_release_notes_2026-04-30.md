# Backend release notes — 2026-04-30

## What shipped
- Route mounting centralized via `getRouteRegistry()` + `mountApiRoutes()` for `/api` and `/api/v1`.
- Leaderboard top cache extracted to `utils/leaderboardTopCache.js` (Redis REST backend + memory fallback).
- Event-driven leaderboard cache invalidation on successful `/api/leaderboard/save`.
- Display name policy centralized in `services/displayNamePolicyService.js`.
- Rollout gates scripts and CI dry-run steps added.

## Required / optional ENV

### Required for Redis-backed leaderboard top cache
- `REDIS_REST_URL` — Upstash/Redis REST endpoint (optional; if omitted, memory fallback is used).
- `REDIS_REST_TOKEN` — REST auth token paired with `REDIS_REST_URL`.

### Optional cache tuning
- `LEADERBOARD_TOP_CACHE_TTL_MS` (default `30000`).
- `LEADERBOARD_TOP_CACHE_KEY` (default `leaderboard:top:public:v1`).

### Rollout gate tuning (optional)
- `GATE_MAX_5XX_RATE` (default `0.02`).
- `GATE_MAX_P95_LEADERBOARD_MS` (default `800`).
- `GATE_MAX_DONATION_FAILED_DELTA` (default `0.25`).
- `GATE_MAX_WALLET_CONNECT_FAILED_DELTA` (default `0.25`).
- `GATE_ALIAS_TELEMETRY_MAX` (default `0`).

## Post-deploy smoke checklist
1. `npm run check:syntax`
2. `npm test`
3. `node scripts/check-rollout-gates.js`
4. `node scripts/evaluate-telemetry-alias-usage.js`
5. Verify `/metrics` includes:
   - `app_alias_route_usage_total{alias="analytics"}`
   - `app_alias_route_usage_total{alias="telemetry"}`

## Notes
- In `NODE_ENV=test` leaderboard top cache TTL is effectively disabled.
- If Redis REST is unavailable, service continues with memory fallback and warning logs.
