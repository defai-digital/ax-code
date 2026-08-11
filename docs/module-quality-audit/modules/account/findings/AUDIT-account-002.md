# AUDIT-account-002

| Field | Value |
|-------|-------|
| Title | decryptToken accepted non-encrypted stored values silently |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | verified-fixed |
| Module | account |
| Evidence | packages/ax-code/src/account/repo.ts:decryptToken |
| Independent verifier | codex-sol |
| Regression test | packages/ax-code/test/account/repo.test.ts |

## Proof
Legacy plaintext tokens still work for compatibility, but `log.warn("stored account token is not encrypted...")` fires. Test inserts plaintext access/refresh tokens and asserts ≥2 warn events including `not encrypted`.

## Impact
Corrupted/tampered rows could be treated as live credentials without signal.

## Verification
`AX_TEST_FILES=test/account/repo.test.ts pnpm exec vitest run` — PASS
