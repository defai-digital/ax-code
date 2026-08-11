# AUDIT-hooks-001: Repository hooks required an out-of-band trust gate

| Field | Value |
|-------|-------|
| ID | `AUDIT-hooks-001` |
| Module | [`hooks`](../MODULE-AUDIT.md) |
| Primary category | security |
| Secondary tags | RCE, repository-trust, shell |
| Severity | Critical |
| Status | verified-fixed |
| Origin | prior-review |
| Reporter / owner | 2026-07-19 quality review / AX Code maintainers |
| First observed | `4097631a94f06b4639e889335891c3a2c49c6b21` on 2026-07-19 |
| Source | `packages/ax-code/src/hooks/lifecycle.ts:182-218` |
| Impacted units | session tool lifecycle |
| Target / expiry | immediate / n/a |
| Fix / test | current code / `packages/ax-code/test/hooks/lifecycle.test.ts` |
| Independent verifier | codex-sol |

## Summary

The prior implementation loaded `.ax-code/hooks.json` from a checkout and later executed matching commands with `shell: true`. Opening an attacker-controlled repository and using a tool was therefore a command-execution path. Current code returns no project hooks unless `ProjectConfigTrust.enabled()` is set through the environment-only opt-in.

## Evidence

1. `runForWorkspace` resolves repository hooks before every supported lifecycle event.
2. `loadProjectHooks(directory, trusted = ProjectConfigTrust.enabled())` now returns `[]` before reading the file when trust is absent.
3. The opt-in is `AX_CODE_TRUST_PROJECT_CONFIG`; a repository cannot set it through its own config.
4. The regression writes a valid project hook, asserts the default result is empty, then explicitly passes trusted state and sees the hook.

## Impact and severity

Original reachability was normal use of a cloned repository, with arbitrary user-level command execution. That remains Critical under the PRD rubric. Current residual risk is explicit: a user who deliberately enables project trust authorizes project executable configuration.

## Root cause and violated invariant

> Repository-controlled files must not create executable lifecycle hooks without trust established outside that repository.

Root cause: project and user-owned hook sources were previously treated equivalently.

## Verification

```bash
cd packages/ax-code && AX_TEST_FILES=test/hooks/lifecycle.test.ts pnpm exec vitest run
pnpm --dir packages/ax-code run typecheck
```

Result: included in the 148-test hooks/permission/isolation run; all passed. Current source re-read at `054002dd73198d659d505539f080200bdbc66bc8` plus working tree.

| Event | Date | Actor | Evidence |
|-------|------|-------|----------|
| Candidate created | 2026-07-19 | prior reviewer | executable project hook trace |
| Fix independently verified | 2026-08-11 | codex-sol | trust gate and negative test |
| Closed | 2026-08-11 | codex-sol | verified-fixed |

### Independent Critical verification

- Verifier: codex-sol.
- Proof: source-to-shell flow and out-of-band trust source independently re-read.
- Bypass testing: default project hook load is empty; explicit trusted load remains functional.
- Verdict: verified-fixed on 2026-08-11.
