# AUDIT-auth-003: Canary migration can overwrite concurrent credentials

| Field | Value |
|-------|-------|
| ID | `AUDIT-auth-003` |
| Module | [`auth`](../MODULE-AUDIT.md) |
| Primary category | correctness |
| Secondary tags | security, concurrency, persistence |
| Severity | High |
| Status | verified-fixed |
| Origin | new |
| Reporter / owner | codex-sol / codex-sol |
| First observed | `054002dd73198d659d505539f080200bdbc66bc8` on 2026-08-11 |
| Source | `packages/ax-code/src/auth/index.ts:299-389` |
| Impacted units | auth, provider credential loading |
| Target / expiry | 2026-08-14 / n/a |
| Fix / test | `8a38b90b950855545c6b2479220274357904f111` / `packages/ax-code/test/auth/auth.test.ts` |
| Independent verifier | n/a (recommended, not required for non-Critical) |

## Summary

`Auth.all()` built a full migration snapshot before acquiring the auth write lock. If `Auth.set()` or `Auth.remove()` committed during decryption, the later migration rewrite used the stale snapshot and silently overwrote the newer credential state.

## Evidence

Static flow at the reviewed baseline:

1. `loadAll()` read and decrypted `auth.json` without a write lock.
2. It constructed `updated` entirely from that initial `providerData`.
3. Only then did it acquire the cross-process/in-process locks and write `updated`; it did not re-read current state.

The deterministic regression pauses the first `Auth.all()` read, commits an `Auth.set("openai", ...)`, resumes migration, and asserts that the newly written provider remains on disk. Before the fix, the final assertion failed because migration removed `openai`.

## Impact and severity

- Reachability: normal first-run/canary or legacy re-encryption concurrent with a credential change.
- Blast radius: one installation's global credential store.
- Consequence: silent loss of newly added, replaced, or removed credentials; manual reconnect required.
- Severity: High under the persistence/correctness rubric; recovery exists, but the loss is security-sensitive and invisible at write time.

## Root cause and violated invariant

Required invariant:

> A full-file migration must preserve every credential change committed after its initial read.

Root cause: the migration lock protected only the final write, not validation against the current file version.

## Recommended fix

Re-read `auth.json` under both locks, start from that latest map, and re-encrypt a provider only when its stored value still exactly matches the inspected value. This preserves concurrent additions, replacements, and removals without serializing ordinary reads.

## Test and verification plan

```bash
cd packages/ax-code && AX_TEST_FILES=test/auth/auth.test.ts pnpm exec vitest run
pnpm --dir packages/ax-code run typecheck
```

Focused result: 127/127 tests passed in the combined auth/config/isolation run; core typecheck passed.

## Resolution record

| Event | Date | Actor | Evidence/notes |
|-------|------|-------|----------------|
| Candidate and acceptance | 2026-08-11 | codex-sol | deterministic interleaving proof |
| Fix ready | 2026-08-11 | codex-sol | locked re-read and compare-before-migrate |
| Verification complete | 2026-08-11 | codex-sol | regression and typecheck pass |
| Closed | 2026-08-11 | codex-sol | verified-fixed |

Residual risk: non-cooperating external writers remain outside the advisory lock contract.
