# AUDIT-storage-001

| Field | Value |
|-------|-------|
| Title | Corrupt legacy JSON skipped during migration |
| Category | stability |
| Severity | Critical |
| Origin | prior-review |
| Status | verified-fixed |
| Module | storage |
| Evidence | packages/ax-code/src/storage/storage.ts |
| Independent verifier | codex-sol |
| Regression test | packages/ax-code/test/storage |
| Owner | codex-sol |
| Expiry | n/a |

## Proof
log.warn skip corrupt files; no crash loop

## Impact
Affects `packages/ax-code/src/storage` (persistence, stability).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- packages/ax-code/test/storage
