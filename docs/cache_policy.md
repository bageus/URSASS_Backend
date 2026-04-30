# Cache policy matrix

Date: 2026-04-30

| Class | Description | Backend policy | Examples |
|---|---|---|---|
| `public_deterministic` | Stable read-only payloads | CDN/edge cache, medium TTL | `GET /api/game/config` |
| `public_volatile` | Public frequently-changing payload | short TTL cache with refresh | `GET /api/leaderboard/top` |
| `personalized` | User-specific responses | private cache key by identity | `GET /api/account/me/*` |
| `transactional` | Mutating or payment-sensitive operations | no cache | `POST /api/leaderboard/save`, `POST /api/store/buy`, donations |

## Notes
- Personalized keys must include wallet/primaryId.
- Transactional routes must bypass caches completely.
- For leaderboard top, use explicit invalidation after score updates.
