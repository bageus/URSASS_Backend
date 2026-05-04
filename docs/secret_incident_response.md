# Secret leak incident response (GitHub Secret Scanning)

If GitHub reports **Public leak** for `TELEGRAM_BOT_TOKEN` or `MongoDB Atlas URI`, treat this as a real compromise.

## 1) Containment (immediately)

1. Disable exposed token access:
   - Revoke current Telegram bot token in `@BotFather` (`/revoke`).
   - Create a new token (`/token`) and store it in Railway variables.
2. Rotate MongoDB credentials:
   - Create a new DB user/password in Atlas.
   - Replace connection string in Railway (`MONGO_URL` / `MONGO_URI`).
   - Remove old DB user after rollout.
3. Invalidate active auth sessions if they could be affected.

## 2) Eradication (repository)

1. Ensure no real secrets are in git-tracked files:
   - Keep only placeholders in `.env.example`.
   - Keep `.env*` ignored in `.gitignore`.
2. If a secret was committed in history, rewrite git history (BFG/git-filter-repo) and force-push.
3. Close GitHub alerts only after rotation + cleanup.

## 3) Recovery

1. Deploy backend with new secrets on Railway.
2. Re-check bot webhook health (`/api/health` + Telegram webhook endpoint).
3. Verify DB connectivity and key user flows (login, donations, game events).

## 4) Prevention checklist

- Add local pre-commit secret scanning (`gitleaks` or `trufflehog`).
- Add CI secret scan for PRs.
- Never share screenshots/logs with full tokens or full URI.
- Use separate credentials for prod/staging/dev.

## 5) Quick command checks

```bash
# find common secret patterns in tracked files
rg -n "(mongodb\+srv://|mongodb://[^ ]+:[^ ]+@|[0-9]{8,10}:[A-Za-z0-9_-]{20,})" -S .

# check tracked env files
git ls-files | rg "(^|/)\.env($|\.|/)"
```
