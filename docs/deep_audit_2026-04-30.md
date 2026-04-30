# Deep audit report (backend)

Date: 2026-04-30
Scope: `/workspace/URSASS_Backend`

## What was checked
- Test suite health (`npm test`).
- Architecture scan for duplicated patterns and hot spots.
- Static dependency check attempt (`npx depcheck --json`) to find unused deps/files.
- Route-level patterns for repeated wallet validation and repeated share-context fetch logic.

## Findings

### 1) Repeated wallet validation logic (duplication)
`routes/leaderboard.js` contains an internal regex validator (`isValidWalletAddress`) and many repeated checks with slightly different error payloads. This creates drift risk and inconsistent API behavior.

Examples:
- Validator declared locally (`isValidWalletAddress`).
- Repeated checks in `/top`, `/share/*`, `/insights` with inconsistent response shape/message.

**Refactor**:
- Move wallet validation to a shared utility (`utils/security.js`) and use one helper to parse+validate request wallet.
- Standardize response contract for invalid wallet errors.

### 2) Repeated share-context resolution path (duplication)
Endpoints `/share/payload/:wallet`, `/share/image/:wallet.svg`, `/share/image/:wallet.png`, `/share/page/:wallet` all repeat:
1. parse wallet
2. validate wallet
3. load share context
4. 404 handling

**Refactor**:
- Add middleware `loadShareContextByWallet` that sets `req.wallet` and `req.shareContext`.
- Reduce route handlers to output-format concerns only (JSON/SVG/PNG/HTML).

### 3) Inefficient top leaderboard request path (N+1 / extra queries)
In `GET /top`:
- Fetches top players.
- Fetches all account links for top players.
- For current wallet, fetches player again and account link again.
- Computes rank via `countDocuments({ bestScore: { $gt: ... } })` each request.

**Optimization options**:
- Cache global top-10 payload (TTL 15-60s) with invalidation on score updates.
- Denormalize `displayNameResolved` for leaderboard reads where privacy rules allow.
- Replace rank count query with precomputed aggregate rank snapshots or cached percentile buckets.

### 4) Test suite instability concentrated in donations integration tests
Current test run shows multiple failures around `POST /api/store/donations/create-payment` and downstream status checks.

**Likely root cluster**:
- create-payment returns 500 in tests, cascading into submit/status/history assertions.
- This means one upstream regression causes many red tests.

**Refactor / quality**:
- Split integration tests into:
  - donation contract tests (unit/service-level with strict mocks),
  - route contract tests,
  - one e2e happy-path smoke.
- Add explicit failure code assertions for root error classification (misconfig vs provider rejection vs validation).

### 5) Dependency hygiene gaps (tooling unavailable in current environment)
`depcheck` installation from npm registry is blocked (403), so automated unused-deps scan was not completed in this environment.

**Mitigation**:
- Run dependency analysis in CI where registry access is available.
- Add periodic lockfile audit and dependency report artifact.

## Proposed refactoring backlog (prioritized)

### P0 (1-2 days)
1. Create shared wallet parsing/validation helper and replace duplicate checks in `routes/leaderboard.js`, `routes/store.js`, `routes/account.js`.
2. Introduce shared error factory for 400 wallet responses.
3. Fix donations create-payment regression and unflake tests.

### P0 progress tracking (updated 2026-04-30)
- [x] Shared helper added in `utils/security.js` (`isValidWalletAddress`, `parseWalletOrNull`) and used across `/api/leaderboard/top`, `/api/leaderboard/share/*`, `/api/leaderboard/insights`.
- [x] Donations create-payment regression fixed for test harness compatibility (`findOne` chain/no-chain support) and failing donation integration cluster restored to green in targeted run.
- [x] Wallet format pre-validation added to `/api/account/auth/wallet` to fail fast before signature verification.
- [x] Extend shared wallet parser usage to wallet-sensitive routes in `routes/store.js` (`/upgrades/:wallet`, `/donations/:wallet`, `/buy` wallet mode path).
- [x] Introduce shared wallet-error response factory (`buildInvalidWalletError`) and apply it in `leaderboard`, `store`, `account`.

### P1 (2-4 days)
1. Extract `loadShareContextByWallet` middleware.
2. Add top leaderboard response cache with TTL and observability counters.
3. Add strict timeout budgets for Telegram Stars integration tests to reduce 10s+ tail.

### P2 (ongoing)
1. Precompute leaderboard ranking aggregates.
2. Add dead-code and unused-export scan with CI tooling (depcheck/knip/eslint rules).
3. Add API response schema validation tests (contract snapshots).

## CI pipeline proposal (audit-focused)

Recommended stages:
1. **lint-static**
   - syntax check
   - unused-deps scan
   - duplicate-code threshold scan
2. **unit**
   - fast deterministic tests
3. **integration**
   - route/service integration with mocked providers
4. **security**
   - npm audit (moderate+), secret scan, dependency allowlist check
5. **performance-smoke**
   - autocannon on `/health`, `/api/leaderboard/top`, `/api/game/config`
6. **artifacts**
   - publish junit + coverage + audit markdown report

A starter GitHub Actions workflow is added in `.github/workflows/backend-audit.yml`.
