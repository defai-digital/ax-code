# AUDIT-auth-002: Fresh partial auth lock can be stolen

| Field | Value |
|-------|-------|
| ID | `AUDIT-auth-002` |
| Module | [`auth`](../MODULE-AUDIT.md) |
| Primary category | correctness |
| Secondary tags | security, concurrency, persistence |
| Severity | High |
| Status | verified-fixed |
| Origin | new |
| Reporter / owner | codex-sol / codex-sol |
| First observed | `054002dd73198d659d505539f080200bdbc66bc8` on 2026-08-11 |
| Source | `packages/ax-code/src/auth/index.ts:97-211` |
| Impacted units | auth, provider credential loading |
| Target / expiry | 2026-08-14 / n/a |
| Fix / test | working tree / `packages/ax-code/test/auth/auth.test.ts` |
| Independent verifier | n/a (recommended, not required for non-Critical) |

## Summary

The cross-process lock is created before its JSON body is written. A competing process could observe a non-empty partial body, classify it as malformed, unlink it immediately, and enter the credential write section concurrently. That violates serialization and can lose or corrupt global provider credentials.

## Evidence

### Source and control/data flow

- Reviewed baseline: `054002dd73198d659d505539f080200bdbc66bc8`
- Entrypoints: `Auth.set`, `Auth.remove`, migration in `Auth.all`
- Failure sink: competing `Filesystem.writeJson(auth.json)` calls

Static proof:

1. `tryCreate()` opens `auth.json.lock` with `wx`, then writes its body.
2. The pre-fix `maybeSteal()` removed every non-empty body that failed `parseProcessLockBody`, without an age check.
3. A partial write is therefore indistinguishable from an abandoned corrupt lock and can be removed while its owner is active.

### Reproduction or failing test

`set does not steal a freshly created auth lock with a partial body` writes `"{"`, advances the acquisition deadline without aging the file, and asserts that `Auth.set` fails closed and leaves the lock intact. Before the fix it stole the file and succeeded.

## Impact and severity

- Reachability: cross-process CLI/Desktop credential writes; race window is short but real.
- Blast radius: installation-wide `auth.json`.
- Consequence: recoverable credential loss/corruption and inconsistent provider state.
- Severity: High because the affected state is security-sensitive and shared across every project, but recovery is possible by reconnecting providers.

## Root cause and violated invariant

Required invariant:

> A lock that may still be initialized by its owner must never be reaped as stale.

Root cause: malformed lock content was treated as proof of staleness rather than combined with file age and snapshot revalidation.

## Recommended fix

Add a one-acquisition-window grace period for malformed bodies, retain the exclusive stale-claim file, and revalidate both body and `mtime` before unlinking. This is the smallest change that distinguishes an in-progress write from an abandoned lock without changing the lock format.

## Test and verification plan

- Regression: `packages/ax-code/test/auth/auth.test.ts` partial-body test.
- Negative case: unreadable locks continue to fail closed; dead-process locks remain recoverable.

```bash
cd packages/ax-code && AX_TEST_FILES=test/auth/auth.test.ts pnpm exec vitest run
pnpm --dir packages/ax-code run typecheck
```

## Resolution record

| Event | Date | Actor | Evidence/notes |
|-------|------|-------|----------------|
| Candidate and acceptance | 2026-08-11 | codex-sol | Source race and deterministic harness |
| Fix ready | 2026-08-11 | codex-sol | age guard plus body/mtime revalidation |
| Verification complete | 2026-08-11 | codex-sol | focused suite 127/127; core typecheck passes |
| Closed | 2026-08-11 | codex-sol | verified-fixed |

Residual risk: advisory locks cannot protect non-cooperating external writers to `auth.json`; AX Code writers are covered.
