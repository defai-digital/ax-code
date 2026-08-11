# Protocol — 9-step review for unit `flag`

Reviewer: codex-sol (model `gpt-5.6-sol-xhigh`)
Verifier lane: ax-code-glm

## Step 1 Scope and public surface

The `flag` unit consists of `packages/ax-code/src/flag/flag.ts` and `packages/ax-code/src/flag/scoped.ts`. The first exports `parsePositiveIntegerFlagValue` at `packages/ax-code/src/flag/flag.ts:45` and the `Flag` namespace at `packages/ax-code/src/flag/flag.ts:53`; the second exports the two-name `ScopedFlagName` union at `packages/ax-code/src/flag/scoped.ts:21`, the guard at `packages/ax-code/src/flag/scoped.ts:33`, and the `ScopedFlag` namespace at `packages/ax-code/src/flag/scoped.ts:37`. The unit is a central environment-to-runtime adapter rather than an isolated feature: imports reach configuration, isolation, providers, sessions, tools, telemetry, and server routes.

## Step 2 Trust boundaries and failure modes

All external input enters through `process.env`; even credential-shaped values such as `AX_CODE_SERVER_PASSWORD` and `AX_CODE_SERVER_USERNAME` are only returned at `packages/ax-code/src/flag/flag.ts:100-101`, not logged or persisted here. Isolation mode and backend getters allowlist exact values at `packages/ax-code/src/flag/flag.ts:341-349` and `packages/ax-code/src/flag/flag.ts:364-372`, while the network getter accepts only explicit true/false or 1/0 at `packages/ax-code/src/flag/flag.ts:352-361`. Invalid input therefore degrades to `undefined` and lets downstream defaults apply. Neither source file performs filesystem, network, subprocess, or logging operations, so the principal failure mode is an incorrect interpretation or stale snapshot of environment state rather than direct data disclosure or command execution.

## Step 3 Parsing and precedence correctness

The shared tri-state parser normalizes whitespace and case and recognizes true/1/yes/on plus false/0/no/off at `packages/ax-code/src/util/env.ts:137-148`; the helpers in `packages/ax-code/src/flag/flag.ts:3-9` deliberately collapse an unrecognized value to false for opt-in checks. Dynamic boolean getters re-read the environment and apply a fallback at `packages/ax-code/src/flag/flag.ts:21-29`. Super-Long correctly gives the session override precedence over the base variable at `packages/ax-code/src/flag/flag.ts:32-43` and attaches that behavior at line 257. Positive-integer parsing rejects signs, decimals, exponents, zero, and blank input at lines 45-51. One Low residual edge is that it checks `Number.isInteger`, not `Number.isSafeInteger`; very large digit strings can lose precision before they reach token caps (`packages/ax-code/src/provider/transform.ts:24-49`) or the bash timeout (`packages/ax-code/src/tool/bash-impl.ts:51-52`).

## Step 4 Directory-scoped state and concurrency

The project layer installs an async-context-aware directory resolver once at `packages/ax-code/src/project/instance.ts:21-24`. `recordCurrent` then stores booleans in a directory-keyed map at `packages/ax-code/src/flag/scoped.ts:51-61`, and `peek` selects only the current directory at lines 72-76. The autonomous accessor falls back to the process-global getter at lines 78-81, whereas `superLong` deliberately preserves `undefined` at lines 83-90 so `SuperLongPolicy` can continue its precedence chain. This prevents last-writer-wins leakage between simultaneously hosted projects. The map and managed-name set at lines 23-29 have no eviction API; a long-lived server that visits an unbounded number of distinct directories can retain those strings and two booleans per directory. That is a Low lifecycle risk, not a cross-directory correctness failure in the observed flow.

## Step 5 Integration behavior

Configuration reconciliation distinguishes a pristine user environment from a process-managed mirror at `packages/ax-code/src/config/config-impl.ts:721-739`, preserving an explicit external `AX_CODE_AUTONOMOUS` while recording resolved config per directory. Project feature routes update the environment only after persistence succeeds and then record scoped booleans at `packages/ax-code/src/server/routes/project-config.ts:52-63`; GET reconciliation follows the same pairing at lines 82-92. The Super-Long GET clears a stale session override, rewrites the base value, and records the scoped result at `packages/ax-code/src/server/routes/super-long.ts:111-134`. Disabling autonomous also forces Super-Long false in both process and scoped state at `packages/ax-code/src/server/routes/autonomous.ts:97-105`. These sites agree with the precedence documented by the module.

## Step 6 Performance and allocation

Ordinary `Flag` access is either a captured string/boolean or a constant-time property getter; definitions at `packages/ax-code/src/flag/flag.ts:11-43` add no polling, I/O, or asynchronous work. Boolean parsing operates on one short environment string, and numeric parsing performs one anchored regular-expression match at lines 45-50. Scoped reads are two map lookups at `packages/ax-code/src/flag/scoped.ts:72-75`; writes allocate at most one inner map per new directory at lines 55-60. No hot loop or blocking work exists in the unit. The only accumulation concern is the missing directory-map cleanup identified in Step 4.

## Step 7 Design and code hygiene

Resolver injection at `packages/ax-code/src/flag/scoped.ts:38-44` keeps the lower-level flag module independent of the project/instance module, while the registration in `packages/ax-code/src/project/instance.ts:21-24` owns context selection. Runtime-injected namespace members are declared in the public type at `packages/ax-code/src/flag/flag.ts:56-58` and installed as non-configurable enumerable getters at lines 11-29 and 228-336; this is unusual but internally consistent and passes static checking. The reviewed source has no catch blocks that discard errors, no TODO markers, and no commented-out implementations. Static snapshots such as `AX_CODE_CONFIG` at lines 54-55 coexist intentionally with access-time flags whose callers may mutate the environment after import.

## Step 8 Tests and ledger disposition

`packages/ax-code/test/flag/flag.test.ts:20-46` covers autonomous defaults and Super-Long override ordering; lines 53-69 prove selected string getters refresh after mutation; lines 71-80 cover the normal invalid/valid integer forms. `packages/ax-code/test/flag/scoped.test.ts:13-62` exercises the name guard, per-directory separation, environment fallback, undefined Super-Long state, and managed tracking. Gaps remain for safe-integer overflow, direct isolation getter validation, and lifecycle cleanup. The audit's additional test entry at `docs/module-quality-audit/modules/flag/MODULE-AUDIT.md:51-54` is not module coverage: `packages/ax-code/test/cli/tui/network-flags.test.ts:1-2` imports only `hasExplicitNetworkBindFlag`. The finding register remains empty at `docs/module-quality-audit/modules/flag/MODULE-AUDIT.md:68-72`, and no files exist under this unit's `findings/` directory; neither Low residual note warrants a Critical record.

## Step 9 Verification and sign-off

On 2026-08-11, `AX_TEST_FILES=test/flag/flag.test.ts,test/flag/scoped.test.ts pnpm exec vitest run` from `packages/ax-code` passed 2 files and all 10 tests. `pnpm --dir packages/ax-code run typecheck` also completed successfully with `tsgo --noEmit`. The runtime getter contract is supported by `packages/ax-code/test/flag/flag.test.ts:53-69`, and the cross-directory contract is supported by `packages/ax-code/test/flag/scoped.test.ts:19-43`. Primary review is complete for slug `flag`; there is no Critical-severity finding requiring `protocol/reverify.md`.
