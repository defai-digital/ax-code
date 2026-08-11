# AUDIT-permission-001: Repository policy could grant tool permissions

| Field | Value |
|-------|-------|
| ID | `AUDIT-permission-001` |
| Module | [`permission`](../MODULE-AUDIT.md) |
| Primary category | security |
| Secondary tags | policy, repository-trust, privilege-grant |
| Severity | Critical |
| Status | verified-fixed |
| Origin | prior-review |
| Reporter / owner | 2026-07-19 quality review / AX Code maintainers |
| First observed | `4097631a94f06b4639e889335891c3a2c49c6b21` on 2026-07-19 |
| Source | `packages/ax-code/src/permission/index.ts:615-643` |
| Impacted units | agent/tool permission evaluation |
| Target / expiry | immediate / n/a |
| Fix / test | current code / `packages/ax-code/test/permission/next.test.ts` |
| Independent verifier | codex-sol |

## Summary

The prior loader converted repository `.ax-code/policy.json` rules directly into the active ruleset, allowing a checkout to grant itself tool access. Current `loadPolicy()` keeps only `deny` rules unless the environment-only project-trust opt-in is active, while logging ignored grants.

## Evidence

1. `fromPolicy()` maps file/tool/action tuples into normal permission rules.
2. `loadPolicy()` now returns all rules only when `ProjectConfigTrust.enabled()` is true.
3. Otherwise it filters to `action === "deny"`; repository `allow` and `ask` entries cannot broaden authority.
4. `loadPolicy - untrusted project policy retains only deny rules` covers the default, and the adjacent trusted test covers the explicit opt-in.

The wider `ask()` path was also checked: safety-policy/explicit rule evaluation happens before autonomous `full-access` auto-approval, so user deny rules retain precedence.

## Impact and severity

Original reachability was opening a malicious repository, and the blast radius included arbitrary tools permitted by its policy. This is a Critical trust-boundary failure. Residual risk is limited to the deliberate external project-trust opt-in.

## Root cause and violated invariant

> Untrusted repository policy may reduce authority but must never grant or prompt for additional authority.

Root cause: the loader lacked provenance-aware rule reduction.

## Verification

```bash
cd packages/ax-code && AX_TEST_FILES=test/permission/next.test.ts pnpm exec vitest run
pnpm --dir packages/ax-code run typecheck
```

Result: permission tests were included in the 148-test focused run; all passed. Source re-read at `054002dd73198d659d505539f080200bdbc66bc8` plus working tree.

| Event | Date | Actor | Evidence |
|-------|------|-------|----------|
| Candidate created | 2026-07-19 | prior reviewer | policy merge trace |
| Fix independently verified | 2026-08-11 | codex-sol | deny-only filter and tests |
| Closed | 2026-08-11 | codex-sol | verified-fixed |

### Independent Critical verification

- Verifier: codex-sol.
- Proof: repository policy provenance traced through `fromPolicy` and `loadPolicy`.
- Bypass testing: mixed untrusted policy retains deny only; explicit external opt-in is required for grants.
- Verdict: verified-fixed on 2026-08-11.
