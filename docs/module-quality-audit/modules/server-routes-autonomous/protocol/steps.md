# Protocol steps — server-routes-autonomous

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Slug: `server-routes-autonomous`
Primary source read: `packages/ax-code/src/server/routes/autonomous.ts` (110 LOC)
Supporting sources read for cross-checks:
`packages/ax-code/src/server/routes/project-config.ts`, `packages/ax-code/src/server/routes/super-long.ts`,
`packages/ax-code/src/flag/scoped.ts`, `packages/ax-code/src/flag/flag.ts`, `packages/ax-code/src/util/feature-flags.ts`,
`packages/ax-code/src/server/validation.ts`, `packages/ax-code/src/server/server.ts`.

## Step 1 Scope and map

The unit is a single Hono router factory, `AutonomousRoutes` (`packages/ax-code/src/server/routes/autonomous.ts:20`),
mounted at `/autonomous` in the server composition root (`packages/ax-code/src/server/server.ts:303`). It exposes
two endpoints on the `/` sub-path: `GET /` (lines 22–51) returning `BooleanFeatureState` and `PUT /` (lines 52–109)
accepting the same schema. OpenAPI metadata is attached via `describeRoute` (lines 24, 54) with operationIds
`autonomous.get` and `autonomous.set`, so this file contributes to the SDK contract. The module imports
`BooleanFeatureState`, `persistProjectConfigBooleanFeatureResponse`, and `readProjectConfigFeatureState` from the
sibling `./project-config` module (lines 8–12), reusing the shared persistence helper rather than re-implementing
file I/O. No other exports; surface is exactly one symbol.

## Step 2 Threat and failure model

This is a network-facing HTTP route that mutates two kinds of state: the project config file `ax-code.json`
(via `persistProjectConfigBooleanFeatureResponse`, line 76) and the process environment
(`FeatureFlag.set`, `process.env[...]` writes, lines 102–104). The validator on the PUT body
(line 69, `validator("json", BooleanFeatureState)`) gates input through `BooleanFeatureState` (a zod object
requiring `enabled: JsonBoolean`, defined in `project-config.ts:20-22`); invalid bodies are rejected by the
shared `invalidRequest` handler in `packages/ax-code/src/server/validation.ts:11`. No secrets are handled.
The genuine hazard is **cross-project env contamination**: `FeatureFlag.set` is literally
`process.env[key] = String(value)` (`packages/ax-code/src/util/feature-flags.ts:2-4`), which is process-global.
On a server hosting multiple project directories (desktop app, CLI worktrees) this is last-writer-wins; the
codebase's mitigation is the `ScopedFlag` per-directory store (`packages/ax-code/src/flag/scoped.ts:51-61`),
which this route also writes (line 104). Auth/authorization is not enforced in this file — it relies on the
upstream server middleware stack, consistent with every other route in `server.ts`.

## Step 3 Correctness — control flow over the two handlers

GET handler (lines 39–50): always re-reads from disk via `readProjectConfigFeatureState` (line 45). The comment
block at lines 40–44 documents the deliberate choice to never short-circuit on a stale env value. Inside the
helper (`project-config.ts:82-93`), after computing `enabled` it calls `FeatureFlag.set(...)` and
`ScopedFlag.recordCurrent(...)`, so the env is reconciled to match disk on every read. Correct.

PUT handler (lines 70–108): the ordering is **persist-then-mutate-env** — `persistProjectConfigBooleanFeatureResponse`
is awaited first (line 76), and only if it does NOT return an error does the code proceed to write the env
(line 96 short-circuits with `c.json(state, 500)` on `error`). This is the correct order: the comment at
lines 72–75 explains the prior bug where env was written before persistence and a crash would silently revert.
The `super_long`-disabling branch (lines 89–93) preserves a configured `duration_hours` while flipping
enablement, matching the contract documented at lines 83–88. Logic is sound for the disable path.

## Step 4 Correctness — the re-enable asymmetry (MEDIUM finding)

There is a real gap on the **re-enable** path. When `enabled=false`, the handler clears both super-long env
vars and writes the scoped flag (lines 102–104). When `enabled=true`, the handler writes
`config.autonomous = true` (line 82) and persists, but it does **not** touch the super-long env or scoped
value. The runtime precedence for super-long is documented in `packages/ax-code/src/server/routes/super-long.ts:62-76`
as: session override → base env (`AX_CODE_SUPER_LONG`) → config → model default. Consequence: if a prior state
left `AX_CODE_SUPER_LONG=true` in the process env (e.g., set by the shell, or by another project's PUT in the
same server process), re-enabling autonomous will leave that stale base env in place, so `Flag.AX_CODE_SUPER_LONG`
resolves true even though `config.super_long` is false. The comment at lines 83–88 explicitly calls out this
exact "silent resurrection" failure mode for the persisted config — but only fixes the config side. The env
side is mitigated only when something later hits `GET /super-long` (which reconciles env at
`super-long.ts:131-133`), so the window between an autonomous re-enable PUT and the next super-long GET can
produce UI/runtime disagreement. Filing as MEDIUM, not higher, because the super-long GET self-heals.

## Step 5 Performance

GET does an unlocked file read of `ax-code.json` on every call (`readProjectConfig` → `Filesystem.readText`,
`project-config.ts:99-104`). No cache. For a single TUI client polling `/autonomous` this is fine (sub-millisecond
on local disk, no zod parse of an unbounded object — `Config.Info.safeParse` is bounded). No database, no N+1,
no async fan-out. PUT acquires both an in-process `Lock.write` and a cross-process `FileLock` inside
`updateProjectConfig` (`project-config.ts:138-156`), serializing writers per file — correct and cheap. No
hotspot worth flagging.

## Step 6 Design — coupling between autonomous and super-long

The two route modules independently hardcode the same env-var string constants: `autonomous.ts:15-16` and
`super-long.ts:19-20` both define `SUPER_LONG_OVERRIDE = "AX_CODE_SUPER_LONG_SESSION_OVERRIDE"` and
`SUPER_LONG_BASE = "AX_CODE_SUPER_LONG"`. The canonical owner of these names is `flag.ts:257`
(`defineBooleanFlagWithOverride("AX_CODE_SUPER_LONG", "AX_CODE_SUPER_LONG_SESSION_OVERRIDE")`). If the override
naming convention in `flag.ts` ever changes, both route files break silently with no compile-time signal. The
right home for these constants is `flag/scoped.ts` or `flag/flag.ts` re-exported as named string literals.
This is a LOW-severity maintainability finding, not a correctness bug. Aside from this, the design is clean:
`AutonomousState` reuses `BooleanFeatureState.meta({ ref })` for OpenAPI (line 18), the `lazy()` wrapper
defers Hono construction, and the handler bodies stay narrow by delegating to `project-config.ts` helpers.

## Step 7 Dead code, hygiene, error paths

No empty catch blocks in this file (the route-level error handling is delegated; persistence errors surface via
the `{ error }` return shape checked at line 96). No TODOs, no commented-out code, no unreachable branches.
All six imports on lines 1–12 are used. The `log` instance (line 14) is referenced at line 106 only on the
success path; the error path is logged inside `persistProjectConfigResponse` via `createPersistErrorLogger`
(`project-config.ts:24-28`), so failures are not silently swallowed. One minor hygiene note: the
`SUPER_LONG_OVERRIDE`/`SUPER_LONG_BASE` constants exist _only_ for the disable branch (lines 102–103); if the
Step 4 asymmetry were resolved by also reconciling on enable, these constants would naturally migrate to the
shared location proposed in Step 6.

## Step 8 Tests

The route handlers in `autonomous.ts` are **not** directly exercised by any test I could locate. The tests
listed in `MODULE-AUDIT.md` for this unit are adjacent but not on-target: `autonomous-active.test.ts` covers
the unrelated TUI view-model `autonomousActiveView` (`packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`),
`question/autonomous.test.ts` covers the question subsystem's autonomous gating, and the `control-plane/*` tests
exercise the SSE surface rather than `PUT /autonomous`. The shared helper `persistProjectConfigBooleanFeatureResponse`
is presumably covered via other feature routes (capability, etc.), but the specific contract here — "disabling
autonomous also flips `config.super_long` to `{ enabled: false }` while preserving `duration_hours`, and clears
both super-long env vars" (lines 89–104) — has no regression test. A focused route-level test that PUTs
`{ enabled: false }` against a config seeded with `{ super_long: { enabled: true, duration_hours: 8 } }` and
asserts both the persisted shape and the env state would lock in the Step 3 invariant and the Step 4 gap. LOW
severity (the behavior is documented in comments), but it is a coverage hole.

## Step 9 Findings register and exit

Three findings for this unit, none Critical, none High:

1. **[MEDIUM] Asymmetric super-long env reconciliation on autonomous re-enable.** Re-enabling autonomous
   (`enabled=true`) does not clear `AX_CODE_SUPER_LONG` / `AX_CODE_SUPER_LONG_SESSION_OVERRIDE`, so a stale
   base env can resurrect Super-Long until the next `GET /super-long` reconciles. Evidence:
   `packages/ax-code/src/server/routes/autonomous.ts:89-105` (disable branch only) vs the runtime precedence
   at `packages/ax-code/src/server/routes/super-long.ts:62-76`. Suggested fix: on `enabled=true`, also
   `delete process.env[SUPER_LONG_OVERRIDE]` and recompute `SUPER_LONG_BASE` from the persisted `config.super_long`
   via `SuperLongPolicy`, mirroring the disable branch.
2. **[LOW] Duplicated super-long env-var constants.** `autonomous.ts:15-16` and `super-long.ts:19-20` redefine
   the same two strings that are canonically defined via `flag.ts:257`. Suggested fix: export the names from
   `flag/flag.ts` or `flag/scoped.ts` and import in both route files.
3. **[LOW] No direct route-handler test for AutonomousRoutes.** The disable+super-long-coupling invariant
   (lines 89–104) is comment-documented but not asserted by any test in the audit's test list.

No Critical items, so no `reverify.md` is required by the protocol gate. Independent verification (codex-sol)
can confirm the MEDIUM finding by reproducing: seed a project with `super_long.enabled=true` in `ax-code.json`
and `AX_CODE_SUPER_LONG=true` in the env, then `PUT /autonomous { enabled: false }` followed by
`PUT /autonomous { enabled: true }`, and observe that `Flag.AX_CODE_SUPER_LONG` resolves true despite
`config.super_long` being false — until a `GET /super-long` reconciles.

Exit status: primary review complete for `server-routes-autonomous`; awaiting verifier pass.
