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

## Proof
log.warn on fallback path; behavioral test asserts warn + v1 encrypt.

## Verification
encryption.test.ts PASS
