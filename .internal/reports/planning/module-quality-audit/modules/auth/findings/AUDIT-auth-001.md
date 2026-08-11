# AUDIT-auth-001

| Field | Value |
|-------|-------|
| Title | install secret unavailable no longer silent |
| Category | silent-error |
| Severity | Medium |
| Origin | new |
| Status | verified-fixed |
| Module | auth |
| Evidence | packages/ax-code/src/auth/encryption.ts:getInstallSecret |
| Independent verifier | ax-code-glm |
| Regression test | packages/ax-code/test/auth/encryption.test.ts |
| Owner | ax-code-glm |
| Expiry | n/a |

## Proof
log.warn on fallback; encrypt uses v1; regression test forces unusable data dir

## Impact
Affects `packages/ax-code/src/auth` (security, credentials).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- packages/ax-code/test/auth/encryption.test.ts
