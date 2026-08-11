# AUDIT-config-001: Untrusted config restrictions were source-dependent

| Field | Value |
|-------|-------|
| ID | `AUDIT-config-001` |
| Module | [`config`](../MODULE-AUDIT.md) |
| Primary category | security |
| Secondary tags | trust-boundary, command-execution, secrets |
| Severity | High |
| Status | verified-fixed |
| Origin | new |
| Reporter / owner | codex-sol / codex-sol |
| First observed | `054002dd73198d659d505539f080200bdbc66bc8` on 2026-08-11 |
| Source | `packages/ax-code/src/config/config-impl.ts:158-200, 1272-1330, 1434-1449` |
| Impacted units | format, LSP, provider, config HTTP route |
| Target / expiry | 2026-08-14 / n/a |
| Fix / test | working tree / `packages/ax-code/test/config/config.test.ts` |
| Independent verifier | n/a (recommended for High security) |

## Summary

Two config paths crossed the untrusted boundary without the complete restriction set. Remote well-known config used `trusted: false` but only project-tagged sources lost executable formatter/LSP, shell, provider credential-routing, skill, and instruction fields. Separately, `Config.update()` evaluated `{file:}`/`{env:}` references from an existing repository file before writing the merged object back, which could materialize a local secret into project config.

## Evidence

### Source and control/data flow

1. The well-known loader explicitly passed `trusted: false` to `load()`.
2. `load()` always reduced permission grants, but called the broader `restrictUntrustedProjectConfig()` only when `options.projectTrust === true`; remote config omitted that flag.
3. `Format` spawns configured formatter commands on `File.Event.Edited`, and LSP startup consumes configured server commands, so retained executable fields had a normal downstream sink.
4. `Config.update()` called the semantic `loadFile()` on the existing project file. That path substitutes config references, after which `writeJson()` persisted the substituted value.

### Reproduction or failing tests

- The expanded well-known test returns malicious `shell`, provider, instruction, command, LSP, and formatter fields while project trust is enabled. Before the fix, those executable fields survived.
- The update test stores an absolute `{file:...}` reference to a sentinel secret, calls `Config.update`, and asserts the reference—not its contents—remains in the file. Before the fix, the sentinel was written literally.

## Impact and severity

- Reachability: a configured/authenticated well-known endpoint plus a later edit/LSP use; or a project config plus a config update.
- Blast radius: current AX Code process/project; credential text could subsequently be committed or otherwise disclosed.
- Workaround: do not connect untrusted well-known endpoints and do not update config in unreviewed repositories.
- Severity: High because meaningful preconditions and a second action are required, while the resulting command/secret trust-boundary violation is serious and user recovery is possible.

## Root cause and violated invariant

Required invariant:

> Every source explicitly marked untrusted receives the same executable and credential restrictions, and config mutation never persists evaluated secret references.

Root cause: trust semantics were coupled to the project-opt-in flag, and a read-modify-write API reused the semantic evaluation loader.

## Recommended fix

Apply the full restriction function to every `!trusted` config. In `Config.update`, parse the raw JSONC only for schema validation/merge rather than evaluating substitutions. This preserves the public schema and precedence model while changing only the unsafe paths.

## Test and verification plan

```bash
cd packages/ax-code && AX_TEST_FILES=test/config/config.test.ts pnpm exec vitest run
pnpm --dir packages/ax-code run typecheck
```

Focused combined result: 127/127 tests passed; core typecheck passed.

## Resolution record

| Event | Date | Actor | Evidence/notes |
|-------|------|-------|----------------|
| Candidate and acceptance | 2026-08-11 | codex-sol | two reachable source-to-sink traces |
| Fix ready | 2026-08-11 | codex-sol | universal untrusted restriction; raw update parse |
| Verification complete | 2026-08-11 | codex-sol | adversarial regressions and typecheck pass |
| Closed | 2026-08-11 | codex-sol | verified-fixed |

Residual risk: trusted global/account/custom sources intentionally retain executable and substitution capabilities.
