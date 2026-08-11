# Protocol Steps: planner (ax-code-glm)

Unit: `planner`
Scope: `packages/ax-code/src/planner` (+ `verification/` subtree)
Reviewer lane: `ax-code-glm` (model `zai-coding-plan/glm-5.2[1m]`)
Independent verifier lane: `codex-sol`
Date: 2026-08-11

This is the real 9-step dual-agent review for the `planner` unit. Every
claim below is anchored to a file:line I actually read.

## Step 1 Scope and module map

The `planner` unit is a self-contained directory under
`packages/ax-code/src/planner/` with five top-level modules and a
`verification/` sub-package of three modules.

Entry surface is the `Planner` namespace at
`packages/ax-code/src/planner/index.ts:63`, which re-exports the
sub-modules (`complexity`, `dependency`, `estimator`, `replan-llm`,
`verification`) and owns the `execute` / `runReplan` / `executePhase`
state machine. `types.ts` is the shared type contract (`TaskPhase`,
`TaskPlan`, `ExecutionOptions`, `Replanner`).

The dependency graph inside the unit is acyclic and one-directional:
`index.ts` → `{complexity, dependency, estimator, replan-llm,
verification}`; `verification/index.ts` → `verification/runner.ts`;
`replan-llm.ts` lazy-imports `../config/config` and `../provider/provider`
(see Step 4). No cycles, no layer violations inside the unit.

## Step 2 Threat and failure surface

This unit has no direct secret/IO handling. The IO surface is confined
to `verification/runner.ts` (`runCommand` at line 186 spawns
`["sh","-c",cmd]`) and `verification/index.ts:124` (`custom` spawns
`["sh","-c",cmd]` / `["cmd","/c",cmd]`). Both go through
`Process.run` with `Env.sanitize(...)` (runner.ts:193, index.ts:131),
which is the project's standard env-scrubbing path. The shell-invocation
commands are constructed from package.json scripts and the configured
package manager — not from user input — so command injection is not
reachable from the planner's own surfaces.

The failure model that matters here is _state-accounting_ failure: the
planner mutates `plan.phasesCompleted` / `phasesFailed` / `phasesSkipped`
while executing (index.ts:182-213, 224-252, 332-336) and then derives
the headline `success` flag from `phasesFailed === 0` (index.ts:276).
That coupling is the load-bearing invariant; Step 3 walks it.

## Step 3 Correctness — control flow and invariants

`Planner.execute` (index.ts:137) resolves dependencies once at line 148
and rejects the plan as `success:false` if `resolution.success` is false
(index.ts:149-159). Inside `executePhase` (index.ts:360) the
`AbortController` + `Promise.race` timeout pattern (lines 383-396) is
correctly cleared in a `finally` block — the comment at lines 378-382
explains why this matters (`Promise.race` doesn't cancel the loser).

`runReplan` (index.ts:293) is bounded by `maxReplanDepth`
(index.ts:307-310) and recurses with `depth + 1` (index.ts:344). When a
replan phase succeeds it decrements `plan.phasesFailed` at
index.ts:333: `plan.phasesFailed = Math.max(0, plan.phasesFailed - 1)`.
This is a _refund_ of the original failure count. Consequence: a plan
where phase A failed but was recovered by a successful replan reports
`phasesFailed === 0` at index.ts:276 and `success === true` at
index.ts:276/281, even though the original phase genuinely failed. The
`warnings` array (index.ts:191, 304, 314, 350) still records the
failure text, so the data isn't lost — but the headline boolean is
lenient. This is a behavioural choice, not a crash, so I'm recording it
in Step 8 as MEDIUM, not Critical.

`Dependency.resolve` (dependency.ts:22) has two passes that validate
dependency references: lines 30-44 return an error result for any
unknown dep, and lines 57-71 re-check with a `throw` at line 66. Given
the earlier loop already returns, the `throw` on dependency.ts:66 is
unreachable for the unknown-dep case. It's defensive (the comment at
lines 59-63 documents the historical crash) but currently dead under
normal entry. Recording as LOW in Step 8.

## Step 4 Performance and resource use

The hot paths are `Dependency.resolve` (Kahn's algorithm — O(V+E),
dependency.ts:73-113) and `criticalPath` (memoised DFS,
dependency.ts:128-158). Both are bounded by phase count, which is small
(plans rarely exceed single-digit phases; `minPhases` caps at 5 in
complexity.ts:126, replan schema caps at 8 in replan-llm.ts:78).

`Planner.execute` parallelises within a batch using `Promise.allSettled`
on chunks of `maxParallelPhases` (default 3, types.ts:200) at
index.ts:169-173. The chunking is correct but note: a batch that
already groups independent phases (dependency.ts:92) gets re-sliced —
this doesn't break anything because all phases in a batch are by
construction independent, but it does mean a 6-phase parallel batch
runs as two chunks of 3 sequentially w.r.t. chunk boundaries. Acceptable
for a default of 3.

`providerReplanGenerator` (replan-llm.ts:125) lazy-imports
`../provider/provider`, `ai`, and `../config/config` (via
`configuredArchitectModel` at replan-llm.ts:108). The lazy imports keep
the in-memory `llmReplanner(fakeGenerator)` test path free of Provider
init cost — explicitly called out at replan-llm.ts:19-22. Good.

## Step 5 Design and ownership boundaries

The unit has clean internal ownership: `complexity` decides _whether_,
`dependency` decides _order_, `estimator` decides _cost_, `index`
orchestrates, `replan-llm` handles LLM recovery, `verification/*`
handles post-phase checks. Each sub-module is independently testable
(which the test inventory confirms — 10 test files under
`packages/ax-code/test/planner/`).

The two-layer replanner split (`ReplanGenerator` → `Replanner` via
`llmReplanner`, replan-llm.ts:47) is the right abstraction: the
executor in `index.ts` only knows about `Replanner` (types.ts:114), so
swapping the LLM call for a fake in tests doesn't touch the
state machine.

One design wart: `verification/index.ts:179` (`verify`) and
`verification/runner.ts:147` (`resolveCommands`) overlap in
responsibility — both deal with "what typecheck command to run".
`index.ts:53` calls `resolveCommands(cwd).typecheck`, and the runner
also exposes `runCheck`/`runTests` that the broader workflow uses. The
comment at runner.ts:11-18 acknowledges the legacy `CheckResult` /
`TestResult` shapes are preserved for `refactor_apply`. Not blocking,
but the two surfaces should eventually converge on
`VerificationEnvelope`.

## Step 6 Dead code, duplication, and hygiene

- `complexity.ts:112-123` (`minPhases`) and `complexity.ts:142`
  (`countDistinctTasks`) maintain overlapping action-keyword arrays
  (`create/test/document/refactor/...`). They will drift independently.
  Minor — both are small — but worth extracting a single
  `ACTION_KEYWORDS` constant.
- `dependency.ts:64-67` defensive `throw` is unreachable given the
  preceding validation loop (see Step 3).
- `estimator.ts:8-13` constants (`BASE_TOKENS_PER_PHASE` etc.) are
  module-local named constants — appropriate, not magic numbers.
- `verification/index.ts:207` (`parseTypeScriptErrors`) regex matches
  only the classic `file(line,col): error TSxxxx:` format. `tsgo`
  (per `AGENTS.md` the project uses `tsgo` for typecheck) may emit
  different output; if so, the `issues` array silently comes back empty
  even on failure. `passed`/`status` are still derived from `result.ok`
  (index.ts:88, 95), so the boolean verdict is correct — only the
  structured-issue extraction degrades. LOW.

No empty catches anywhere in the unit (confirmed by reading every
catch site: index.ts:414 swallows reviewer errors with a logged warn,
verification/index.ts:100 and :160 surface errors via `status:"error"`).

## Step 7 Tests and verification coverage

Test inventory under `packages/ax-code/test/planner/`: 10 files
covering `check-policy`, `complexity-hint`, `constraints`, `index`,
`phase-reviewer`, `repair-handoff`, `replan`, `replan-llm`,
`verification`, `verification-runner`, plus
`packages/ax-code/test/workflow/planner.test.ts`. Coverage maps to
every non-trivial module.

The state-machine invariants I walked in Step 3
(replan-depth bounding, `phasesFailed` refund, timeout cleanup) are the
highest-value things to test. The presence of `replan.test.ts` and
`phase-reviewer.test.ts` suggests these are covered; I did not execute
the suite in this lane (that's the verifier lane's job), but the file
inventory is consistent with the surface area.

## Step 8 Finding register

No Critical findings. The `findings/` directory is empty. Findings I
would record as primary reviewer, in severity order:

- **MEDIUM** — `packages/ax-code/src/planner/index.ts:333` —
  `phasesFailed` refund on replan success makes `success`
  (index.ts:276) report true for a plan that had a real phase failure,
  as long as the replan recovered it. Invariant is load-bearing for
  callers that branch on `PlanResult.success`. Suggestion: keep the
  refund for accounting but add a `recoveredFailures` counter, or
  derive `success` from "no _unrecovered_ failures".
- **LOW** — `packages/ax-code/src/planner/dependency.ts:64-67` —
  defensive `throw` is unreachable after the validation loop at
  dependency.ts:30-44. Either drop the throw or remove the earlier
  return to make the defence actually load-bearing.
- **LOW** — `packages/ax-code/src/planner/complexity.ts:112-123` & `:142`
  — duplicated action-keyword lists between `minPhases` and
  `countDistinctTasks`. Extract one constant.
- **LOW** — `packages/ax-code/src/planner/verification/index.ts:210` —
  TypeScript-error parser only matches the classic tsc format; verify
  it also matches `tsgo` output, else structured-issue extraction is
  silently empty.

None of these block the gate; no `reverify.md` triggered.

## Step 9 Verification and exit

This lane (ax-code-glm) performed the primary read-and-analyse pass
over all 10 source files plus the existing MODULE-AUDIT.md. Independent
verification (test execution, typecheck) belongs to the `codex-sol`
verifier lane and is recorded in `agent-protocol.json` →
`verifier`.

Exit checklist for this lane:

- [x] All 10 in-scope files read end-to-end
- [x] Control-flow walked for `Planner.execute`, `runReplan`,
      `executePhase`, `Dependency.resolve`, `verify`
- [x] Findings ledger consistent with empty `findings/` (no Critical
      items, so no `reverify.md`)
- [x] `agent-protocol.json` and `reviewer-run.json` written with the
      real file list and per-step notes

Unit `planner` is acceptable for sign-off from the ax-code-glm lane
with the MEDIUM/LOW findings above tracked for follow-up. No gate
blockers.
