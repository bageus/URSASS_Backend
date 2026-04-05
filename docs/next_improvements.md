# Next Improvements Implemented

This iteration implements additional hardening after the initial P0 fixes.

## 1) Strict CORS allowlist
- Removed permissive wildcard acceptance for all `*.vercel.app` origins.
- Only explicitly configured origins are allowed.

## 2) Safer IP extraction for rate limiting
- Normalized `x-forwarded-for` handling to use the first non-empty client IP from the chain.
- Added fallback to `req.ip`, `remoteAddress`, then `unknown`.

## Validation
- Added integration coverage to confirm non-whitelisted `*.vercel.app` origins are rejected.
