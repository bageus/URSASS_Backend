# Security Remarks Closure Plan (2026-04-17)

## Context
This document closes the remarks raised in the quick backend security review on **April 17, 2026**.

## Remarks and closure actions

### 1) Public `/metrics` endpoint
**Risk:** internal operational metrics may be exposed publicly.

**Closure action:**
- Protect `/metrics` with one of the following (priority order):
  1. Private network only (ingress allowlist / internal LB route)
  2. Static bearer token (`METRICS_TOKEN`) checked in middleware
  3. Basic Auth at reverse proxy level
- Return `401` on missing/invalid auth.

**Acceptance criteria:**
- Anonymous `GET /metrics` returns `401` or `403`.
- Authenticated/internal request returns `200`.
- Monitoring scraper uses the approved auth method.

---

### 2) Public account info enumeration (`GET /api/account/info/:identifier`)
**Risk:** potential leakage of `telegramId/wallet` mapping and profile metadata.

**Closure action:**
- Restrict endpoint to authenticated owner access OR
- Reduce response to non-sensitive public fields only.
- Add stricter rate limit for this endpoint.
- Add detection/logging for high-cardinality sequential probes.

**Acceptance criteria:**
- Unauthenticated caller cannot fetch sensitive identity binding fields.
- Security tests cover enumeration attempts and expected blocks.

---

### 3) `localhost` origins in production allowlist
**Risk:** unnecessary CORS surface in production configuration.

**Closure action:**
- Remove hardcoded localhost origins from production runtime.
- Keep localhost origins only for non-production environments.

**Acceptance criteria:**
- In production mode, `Origin: http://localhost:3000` and `http://localhost:5173` are rejected.
- Existing frontend production domains remain allowed.

---

### 4) Telegram config can be warning-only
**Risk:** deployment may proceed with incomplete Telegram security config.

**Closure action:**
- Enforce strict startup validation in production:
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_BOT_SECRET`
  - `TELEGRAM_WEBHOOK_SECRET`
- Fail fast on missing values when `NODE_ENV=production`.

**Acceptance criteria:**
- App startup exits with non-zero status if any required Telegram variable is missing in production.
- CI includes a config validation test for production env matrix.

---

## Verification checklist
- [ ] Automated tests added/updated for all 4 closure actions.
- [ ] Staging validation completed with security sign-off.
- [ ] Production deploy completed with post-deploy smoke checks.
- [ ] Incident/monitoring dashboards updated for auth failures and probe alerts.

## Owner and target
- **Owner:** Backend team
- **Target completion:** 2026-04-24
