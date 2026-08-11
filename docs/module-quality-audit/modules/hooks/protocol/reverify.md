# Independent re-verification: hooks

- Verifier: codex-sol
- Date: 2026-08-11
- Finding: AUDIT-hooks-001
- Status: verified-fixed

## Source re-read

`packages/ax-code/src/hooks/lifecycle.ts:20` imports `ProjectConfigTrust`. In `loadProjectHooks`, lines 182-185 default the `trusted` parameter to `ProjectConfigTrust.enabled()`, and line 186 immediately returns `[]` when that value is false. The project hook path is not constructed until line 187 and `.ax-code/hooks.json` is not read until line 189, so the untrusted path exits before repository-controlled hook data is accessed. The normal resolver calls `loadProjectHooks(input.directory)` without overriding the gate at line 212.

`packages/ax-code/src/config/project-config-trust.ts:8` names the out-of-band switch as `AX_CODE_TRUST_PROJECT_CONFIG`; lines 10-12 implement the check, with line 11 returning true only when the environment value is exactly `"1"`. Therefore, when the trust environment variable is unset, `enabled()` is false, the default at `lifecycle.ts:184` is false, and the early return at `lifecycle.ts:186` prevents project hooks from loading.

`packages/ax-code/test/hooks/lifecycle.test.ts:73-80` creates a valid repository hook file. Line 81 verifies that the default load returns `[]`; lines 82-83 separately prove loading works only when trust is explicitly supplied. I re-ran this focused test with `AX_CODE_TRUST_PROJECT_CONFIG` explicitly removed from the process environment: all 10 tests passed.

## Verdict

AUDIT-hooks-001 remains **verified-fixed**. The normal `runForWorkspace`/`resolveHooks` path cannot load `.ax-code/hooks.json` while the trust environment variable is unset.

## Residual risk

Setting `AX_CODE_TRUST_PROJECT_CONFIG=1` authorizes repository-controlled hook commands that are later executed through a shell; the opt-in is process-wide rather than scoped to a particular repository. Also, the regression test relies on the ambient default at line 81, so test environments that set the trust variable must explicitly unset it to exercise the negative case reliably.
