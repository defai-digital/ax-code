# AUDIT-desktop-electron-ipc-001: Renderer invoke policy used a name pattern

| Field | Value |
|-------|-------|
| ID | `AUDIT-desktop-electron-ipc-001` |
| Module | [`desktop-electron-ipc`](../MODULE-AUDIT.md) |
| Primary category | security |
| Secondary tags | Electron, renderer, capability-boundary |
| Severity | Critical |
| Status | verified-fixed |
| Origin | prior-review |
| Reporter / owner | 2026-07-19 quality review / AX Code maintainers |
| First observed | `4097631a94f06b4639e889335891c3a2c49c6b21` on 2026-07-19 |
| Source | `desktop/packages/electron/src/preload-ipc-policy.js:6-69` |
| Impacted units | preload renderer bridge and main IPC handlers |
| Target / expiry | immediate / n/a |
| Fix / test | current code / `desktop/packages/electron/src/preload-ipc-policy.test.mjs` |
| Independent verifier | codex-sol |

## Summary

The prior preload policy accepted any command matching a desktop-name regex, so adding a privileged main-process handler implicitly exposed it to renderer JavaScript. The current policy enumerates reviewed commands in an exact `Set` and checks type plus membership.

## Evidence

1. `preload.js` funnels Tauri-compatible `core.invoke` calls through `isAllowedDesktopInvokeCommand`.
2. The policy now returns true only for `DESKTOP_INVOKE_COMMANDS.has(command)`.
3. Tests reject non-desktop channels, prototype names, non-strings, and plausible newly named privileged commands.
4. Dialog/startup methods exposed separately in the preload are fixed, explicit capabilities rather than attacker-selected channels.

## Impact and severity

Original blast radius included every privileged handler whose name matched the pattern, reachable after renderer compromise. That is a Critical Electron privilege-boundary failure. The remaining explicit capability list still requires security review when intentionally expanded.

## Root cause and violated invariant

> Adding a main-process IPC handler must not expose it to renderer JavaScript without a separate explicit preload-policy change.

Root cause: namespace membership was mistaken for capability authorization.

## Verification

```bash
pnpm --dir desktop/packages/electron exec vitest run src/preload-ipc-policy.test.mjs
pnpm --dir desktop/packages/electron run test
pnpm --dir desktop/packages/electron run type-check
pnpm --dir desktop/packages/electron run lint
```

Results: focused lifecycle/policy 6/6, full Electron 162/162, syntax and lint passed. Source re-read at `054002dd73198d659d505539f080200bdbc66bc8` plus working tree.

| Event | Date | Actor | Evidence |
|-------|------|-------|----------|
| Candidate created | 2026-07-19 | prior reviewer | regex authorization proof |
| Fix independently verified | 2026-08-11 | codex-sol | exact-set implementation and negative tests |
| Closed | 2026-08-11 | codex-sol | verified-fixed |

### Independent Critical verification

- Verifier: codex-sol.
- Proof: renderer-to-policy-to-IPC flow independently traced.
- Bypass testing: newly named desktop commands and unrelated channels are rejected.
- Verdict: verified-fixed on 2026-08-11.
