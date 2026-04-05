# Security Remediation Pipeline

## Scope
This plan addresses the critical findings from the review:

1. Missing Telegram webhook authentication.
2. Telegram auth route trusting raw `telegramId` from client body.
3. Sensitive link code value logged in plaintext.

---

## P0 Implementation Plan

### P0.1 Protect Telegram webhook endpoint
- Add dedicated middleware to validate webhook secret with constant-time comparison.
- Accept secret from `x-telegram-bot-api-secret-token` (primary) and legacy fallbacks.
- Fail with `401` when secret is invalid.

### P0.2 Harden Telegram account auth
- Require Telegram `initData` in `/api/account/auth/telegram`.
- Validate hash and freshness with `validateTelegramInitData`.
- Extract user identity only from validated payload.

### P0.3 Stop logging link verification code
- Remove plaintext `code` from account linking log event.
- Keep only non-sensitive contextual fields.

---

## Rollout Checklist

1. Configure environment variables in all environments:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_SECRET`
2. Deploy to staging and run API integration tests.
3. Verify Telegram Mini App auth login flow.
4. Verify Telegram webhook pre-checkout and successful payment flow.
5. Deploy to production with monitoring on 401 rates and payment success rates.

---

## Success Criteria
- Unauthorized webhook calls cannot reach payment handlers.
- `/api/account/auth/telegram` rejects invalid or missing Telegram init data.
- Logs no longer expose one-time link codes.
