# Rollback gates (CI/CD) — URSASS Backend

Date: 2026-04-30
Status: **Approved (P0)**

## Gate matrix

| Gate | Window | Threshold | Action |
|---|---:|---:|---|
| Error-rate gate (`5xx`) for `/api/game/save-result`, `/api/leaderboard/top`, `/api/store/*` | 5 min | > 2% | Automatic rollback |
| Latency gate (`p95`) for `/api/leaderboard/top` | 5 min | > 800ms | Freeze rollout |
| DB gate (MongoDB connectivity) | 5 min | `readyState != 1` spikes or timeout spikes | Automatic rollback |
| Business gate (`donation_failed`, `wallet_connect_failed`) | 5 min | anomaly spike over baseline | Freeze rollout + manual review |

## Required metrics labels

- `deployment_version` — commit SHA / release tag.
- `environment` — production/staging.
- `route` and `status_code` for request counters.

## Alert routing

- **Critical (auto rollback):** SRE + backend on-call.
- **High (freeze rollout):** backend owner + release manager.
- **Business anomaly:** product + backend + analytics.

## CI/CD integration checklist

1. Canary step reads metrics snapshot before traffic shift.
2. Gates are evaluated at 1m intervals during first 5 minutes.
3. If any critical gate is violated, rollout job fails and triggers rollback.
4. Freeze-only gates block further traffic shift until manual approval.
