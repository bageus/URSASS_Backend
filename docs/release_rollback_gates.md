# Release rollback gates (P0 agreement)

Date: 2026-04-30
Scope: Backend API `/api/*` and `/api/v1/*`

## Mandatory gates before traffic increase

1. **Error-rate gate (hard rollback)**
   - Condition: 5xx rate > 2% for 5 consecutive minutes.
   - Scope: `/api/game/save-result`, `/api/leaderboard/top`, `/api/store/*`.
   - Action: automatic rollback to previous stable release.

2. **Latency gate (rollout freeze)**
   - Condition: p95 latency > 800ms for 5 consecutive minutes.
   - Scope: `/api/leaderboard/top`.
   - Action: freeze rollout and investigate.

3. **DB health gate (hard rollback)**
   - Condition: sustained MongoDB degradation (`readyState != 1`) or timeout spike above SRE baseline.
   - Action: automatic rollback.

4. **Business gate (rollout freeze)**
   - Condition: anomaly spike in `donation_failed` or `wallet_connect_failed` counters.
   - Action: freeze rollout, validate provider/flow, then resume or rollback.

## Ownership and alert routing
- Primary owners: Backend on-call.
- Alert channels: PagerDuty + Telegram ops channel.
- Escalation timeout: 10 minutes without ACK.

## Notes
- This document formalizes the P0 rollback-gate agreement from the backend review pipeline report.
- Thresholds can be revised only via PR with incident/SLO rationale.
