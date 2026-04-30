# Cache policy matrix (backend)

Date: 2026-04-30
Scope: `URSASS_Backend` (`/api/*`, `/api/v1/*`)

## Goals
- Minimize stale leaderboard data while reducing Mongo read pressure.
- Prevent caching of transactional/auth-sensitive responses.
- Keep cache behavior explicit and observable.

## Cache classes

### A) Public deterministic (cacheable)
- Definition: responses identical for all users for the same query params.
- Example candidates:
  - `GET /api/game/config?mode=unauth`
- Policy:
  - TTL: 60–300s
  - Shared cache: allowed
  - Required headers: `Cache-Control: public, max-age=<ttl>`

### B) Public volatile (short TTL)
- Definition: public endpoints with frequent updates.
- Example:
  - `GET /api/leaderboard/top` (without `wallet` query)
- Policy:
  - TTL: 10–30s
  - Shared cache: allowed
  - Invalidation: event-driven invalidate on successful score save (`POST /api/leaderboard/save`)
  - Metrics: hit/miss counters + invalidation reason log

### C) Personalized (private cache)
- Definition: responses dependent on wallet/identity.
- Examples:
  - `GET /api/leaderboard/top?wallet=...`
  - `GET /api/account/me/*`
- Policy:
  - TTL: 5–30s (if used)
  - Shared cache: only with user-scoped keys
  - Required headers: `Cache-Control: private, max-age=<ttl>` or `no-store`

### D) Transactional / critical (no cache)
- Definition: write operations and payment/auth flows.
- Examples:
  - `POST /api/leaderboard/save`
  - `POST /api/store/donations/*`
  - `POST /api/account/auth/*`
- Policy:
  - `Cache-Control: no-store`
  - Never serve from cache.

## Keying rules
- Include API namespace in key (`/api` vs `/api/v1`).
- Include normalized query params for cacheable GET routes.
- For personalized cache, include stable user key (`wallet`/`primaryId`) and endpoint version.

## Invalidation rules
- Leaderboard top cache must be invalidated on any accepted result that can affect ranking.
- Future Redis adoption should support:
  - direct key delete for known keys;
  - tag/set-based invalidation for leaderboard families.

## Safety defaults
- If endpoint class is undefined in this matrix, default to `no-store`.
- On upstream/dependency error, prefer stale-if-error only for class A/B endpoints.

## Observability requirements
- Track cache hit/miss/invalidate counters per route family.
- Track alias usage (`analytics` vs `telemetry`) separately in `/metrics`.
- During rollout, monitor:
  - p95 for `/api/leaderboard/top`,
  - 5xx ratio for `/api/game/save-result` and `/api/store/*`.
