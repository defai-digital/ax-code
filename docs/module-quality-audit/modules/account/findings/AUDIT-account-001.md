# AUDIT-account-001

| Field | Value |
|-------|-------|
| Title | Encryption install-secret fallback was silent |
| Category | silent-error |
| Severity | Medium |
| Origin | new |
| Status | verified-fixed |
| Module | account (cross: auth) |
| Evidence | packages/ax-code/src/auth/encryption.ts:getInstallSecret |
| Independent verifier | codex-sol |
| Regression test | packages/ax-code/test/auth/encryption.test.ts |

## Proof
`getInstallSecret` now `log.warn`s when data dir is unavailable and falls back to legacy machine id. Test spies `Log.create({ service: "auth/encryption" }).warn` and asserts message matches `/install secret unavailable/i`, then verifies encrypt uses version 1 and round-trips.

## Impact
Weakened key derivation without operator signal; account tokens decrypt via this path.

## Verification
`AX_TEST_FILES=test/auth/encryption.test.ts pnpm exec vitest run` — PASS
