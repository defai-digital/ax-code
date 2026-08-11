# AUDIT-desktop-electron-server-process-001: Fatal server failures could suppress recovery

| Field | Value |
|-------|-------|
| ID | `AUDIT-desktop-electron-server-process-001` |
| Module | [`desktop-electron-server-process`](../MODULE-AUDIT.md) |
| Primary category | stability |
| Secondary tags | process-lifecycle, desktop, recovery |
| Severity | High |
| Status | verified-fixed |
| Origin | new |
| Reporter / owner | codex-sol / codex-sol |
| First observed | `054002dd73198d659d505539f080200bdbc66bc8` on 2026-08-11 |
| Source | `desktop/packages/electron/src/server-process.js:19-31, 55-57` |
| Impacted units | Electron main-process crash recovery, desktop local server |
| Target / expiry | 2026-08-14 / n/a |
| Fix / test | working tree / `desktop/packages/electron/src/server-process-lifecycle.test.mjs` |
| Independent verifier | n/a |

## Summary

The utility process installed an `unhandledRejection` listener that only logged, overriding Node's fatal default and leaving a possibly inconsistent server alive. Its uncaught-exception path called graceful shutdown, but awaited it without a deadline; if cleanup hung, the process never exited and Electron's exit-driven restart policy never ran.

## Evidence

### Source and control/data flow

1. `server-process.js` hosts the web server, SQLite, SSE/WebSocket state, and an ax-code child.
2. The pre-fix rejection handler logged and returned. The exception handler called `stop(1)`.
3. `stop(1)` awaited `serverHandle.stop()` indefinitely before `process.exit(1)`.
4. `main.js` begins recovery only from the utility child's `exit` event, so both paths could permanently suppress recovery.

### Reproduction or failing test

The lifecycle regressions emit `unhandledRejection` and assert cleanup plus exit code 1. A second harness supplies a never-settling cleanup promise, invokes the fatal timer, and asserts exactly one failure exit. Before the fix, the rejection case never exited and the hung-cleanup case had no force timer.

## Impact and severity

- Reachability: any unhandled promise rejection or exception in the desktop web utility process.
- Blast radius: one running desktop application; the local API/UI becomes stale or unavailable.
- Recovery: restart the app manually.
- Severity: High because the designed automatic recovery path is defeated and the failure can persist indefinitely, but it is confined to one desktop process and does not corrupt durable state by itself.

## Root cause and violated invariant

Required invariant:

> Every fatal utility-process error exits nonzero within a bounded time so Electron can restart it.

Root cause: fatal handling and cleanup lived in an entry module with no shared deadline/once semantics; one fatal event was mistakenly treated as log-only.

## Recommended fix

Move the small stop/fatal-handler state machine into a dependency-injected helper. Route both fatal events through `stop(1)`, arm an unref'd force-exit deadline for fatal cleanup, log cleanup failure, and guard `exit()` so completion after the deadline cannot exit twice.

## Test and verification plan

```bash
pnpm --dir desktop/packages/electron exec vitest run src/server-process-lifecycle.test.mjs
pnpm --dir desktop/packages/electron run test
pnpm --dir desktop/packages/electron run type-check
pnpm --dir desktop/packages/electron run lint
```

Results: lifecycle/policy 6/6; full Electron 162/162; syntax and lint passed.

## Resolution record

| Event | Date | Actor | Evidence/notes |
|-------|------|-------|----------------|
| Candidate and acceptance | 2026-08-11 | codex-sol | fatal flow traced into main restart policy |
| Fix ready | 2026-08-11 | codex-sol | bounded lifecycle helper |
| Verification complete | 2026-08-11 | codex-sol | focused/full tests, syntax, lint |
| Closed | 2026-08-11 | codex-sol | verified-fixed |

Prior-art lineage: the 2026-07-19 High finding about exiting with code 0 was already fixed (`stop(1)`). This finding covers the adjacent rejection and hung-cleanup paths that still prevented the same restart invariant.
