# AUDIT-isolation-001: Seatbelt granted unrestricted Mach and IPC operations

| Field | Value |
|-------|-------|
| ID | `AUDIT-isolation-001` |
| Module | [`isolation`](../MODULE-AUDIT.md) |
| Primary category | security |
| Secondary tags | macOS, sandbox, least-privilege |
| Severity | Critical |
| Status | verified-fixed |
| Origin | prior-review |
| Reporter / owner | 2026-07-19 project review / codex-sol |
| First observed | `4097631a94f06b4639e889335891c3a2c49c6b21` on 2026-07-19 |
| Source | `packages/ax-code/src/isolation/os-sandbox.ts:160-213` |
| Impacted units | bash execution on macOS with OS/auto backend |
| Target / expiry | immediate / n/a |
| Fix / test | `8a38b90b950855545c6b2479220274357904f111` / `packages/ax-code/test/isolation/os-sandbox.test.ts` and integration test |
| Independent verifier | codex-sol (independent re-verification of the prior review) |

## Summary

The macOS Seatbelt profile granted the sandboxed command every `mach*` and `ipc*` operation even though its declared boundary requires process execution, read access, workspace/temp writes, and optional network only. Those wildcard capabilities expanded the kernel attack surface beyond the product contract and provided unnecessary primitives for reaching privileged system services.

## Evidence

### Source and control/data flow

1. `Isolation.shouldUseOsSandbox()` selects Seatbelt for restricted bash on macOS.
2. `buildSeatbeltProfile()` previously emitted `(allow mach*)` and `(allow ipc*)` under a deny-default profile.
3. No caller or documented sandbox capability requires unrestricted Mach registration/task operations or POSIX shared-memory IPC.

The July item also called global file reads an escape. Current documentation explicitly defines `workspace-write` as a write/network boundary and lists reads as unrestricted (`docs/guides/sandbox.md`); `(allow file-read*)` therefore remains intentionally in-contract and is not part of the accepted remediation.

### Reproduction or failing test

On macOS, a deny-default profile with both wildcard rules removed successfully ran `/bin/bash`, Node, Git status, pnpm version, and `mktemp`. The repository Seatbelt integration then passed workspace write/temp write/outside-write denial checks. A unit regression asserts neither wildcard can reappear.

## Impact and severity

- Affected systems: macOS sessions where Seatbelt is active (`os` or supported `auto`).
- Reachability: every sandboxed bash process inherited the capabilities.
- Blast radius: host-user process boundary; exact exploitation depends on a vulnerable/reachable Mach service.
- Severity: retained as Critical from the prior security review because this was a kernel-sandbox escape primitive granted to adversarial commands. The global-read portion was rejected as outside the documented confidentiality contract.

## Root cause and violated invariant

Required invariant:

> A deny-default OS sandbox grants only operations required by the documented isolation contract and verified workloads.

Root cause: permissive compatibility wildcards were added without a demonstrated consumer or negative policy test.

## Recommended fix

Remove both wildcard grants. Retain process/sysctl/signal/system-socket/file rules and the existing write/network confinement. Users with specialized XPC workflows can deliberately select the app backend or full access rather than weakening every default Seatbelt process.

## Test and verification plan

```bash
cd packages/ax-code && AX_TEST_FILES=test/isolation/os-sandbox.test.ts pnpm exec vitest run
cd packages/ax-code && AX_TEST_FILES=test/isolation/os-sandbox-integration.test.ts pnpm exec vitest run
pnpm --dir packages/ax-code run typecheck
```

Results: unit coverage passed in the 127-test focused run; macOS integration 3/3; representative direct Seatbelt smoke passed.

## Resolution record

| Event | Date | Actor | Evidence/notes |
|-------|------|-------|----------------|
| Candidate created | 2026-07-19 | prior reviewer | C3 in project code review |
| Accepted with scope correction | 2026-08-11 | codex-sol | Mach/IPC accepted; read claim rejected by documented contract |
| Fix ready | 2026-08-11 | codex-sol | wildcard rules removed |
| Verification complete | 2026-08-11 | codex-sol | direct smoke, unit, integration, typecheck |
| Closed | 2026-08-11 | codex-sol | verified-fixed |

### Independent Critical verification

- Verifier: codex-sol, independent of the 2026-07-19 review.
- Independent proof: current profile and documented boundary were re-read; representative commands were run under the narrowed kernel profile.
- Fix bypass/negative testing: unit test rejects either wildcard; integration proves allowed writes and denied outside writes.
- Verdict/date: confirmed with scope correction and verified-fixed on 2026-08-11.
