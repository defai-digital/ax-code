# Nine-step review — cli-cmd-workflow

Reviewer: codex-sol  
Model: `gpt-5.6-sol-xhigh`  
Date: 2026-08-11

## Step 1 Scope and public surface

The nominal unit is `packages/ax-code/src/cli/cmd/workflow.ts`, whose only statement re-exports everything from
`./workflow-impl` (`packages/ax-code/src/cli/cmd/workflow.ts:1`). A useful review therefore has to follow that edge:
`packages/ax-code/src/cli/cmd/workflow-impl.ts:93-105` begins the exported status API, lines 110-261 export the
formatters, lines 759-800 export parsers, and line 967 exports `WorkflowCommand`. This also corrects the static map's
claim of zero exports (`docs/module-quality-audit/modules/cli-cmd-workflow/MODULE-AUDIT.md:24-29`): the barrel has no
named declaration of its own, but it exposes the implementation's symbols. The production entry point imports the
barrel at `packages/ax-code/src/cli/boot.ts:48` and registers the resulting command at
`packages/ax-code/src/cli/boot.ts:103`.

## Step 2 Threat boundaries and safety controls

This local CLI accepts template IDs, session IDs, model/provider selectors, arbitrary workflow input values, and
flags that can permit larger or write-capable executions (`packages/ax-code/src/cli/cmd/workflow-impl.ts:533-621`).
The dangerous settings remain opt-in: scheduler defaults are false for both scale expansion and write workflows
(`packages/ax-code/src/workflow/scheduler.ts:33-40`), and creation of a run rejects a template unless its stored
trust is `trusted` (`packages/ax-code/src/workflow/template.ts:181-190`). Routine invocation adds another boundary:
the selected API routine must be enabled, local-only, and trusted (`packages/ax-code/src/workflow/routine.ts:183-196`).
Artifact payload disclosure is also explicit; the CLI defaults `--include-payload` to false and compacts every result
unless requested (`packages/ax-code/src/cli/cmd/workflow-impl.ts:836-875`), while the compactor removes `payload`
(`packages/ax-code/src/workflow/artifact.ts:17-22`). No direct credential ingestion or shell command construction
appears in this module.

## Step 3 Command registration and runtime gating

The root command defines `workflow` plus alias `wflow`, registers sixteen subcommands, and requires one of them
(`packages/ax-code/src/cli/cmd/workflow-impl.ts:967-991`). All state-reading and state-changing handlers use
`withWorkflowRuntime`, which checks the feature flag before entering project bootstrap
(`packages/ax-code/src/cli/cmd/workflow-impl.ts:1024-1035`). The `runtime` subcommand intentionally sits outside that
guard so a disabled user can still obtain status and enable instructions (`packages/ax-code/src/cli/cmd/workflow-impl.ts:953-964`).
The flow is coherent: the barrel is resolved by `boot.ts`, yargs receives the command object, disabled operations fail
before database/project initialization, and runtime errors propagate to the shared CLI error path instead of being
silently converted into successful output.

## Step 4 Inputs, identifiers, and lifecycle correctness

Yargs restricts run-status and artifact-kind values at definition time (`packages/ax-code/src/cli/cmd/workflow-impl.ts:333-347`
and `packages/ax-code/src/cli/cmd/workflow-impl.ts:846-864`). Branded run, phase, child, and optional session identifiers
are parsed through their zod schemas before reaching storage or scheduler calls
(`packages/ax-code/src/cli/cmd/workflow-impl.ts:787-800`). Start and routine-run handlers pass model policy, parsed
inputs, and the four scheduler controls without swapping fields (`packages/ax-code/src/cli/cmd/workflow-impl.ts:608-627`
and `packages/ax-code/src/cli/cmd/workflow-impl.ts:707-726`). Input parsing splits only on the first `=`, preserves an
empty value, parses valid JSON, and deliberately falls back to a raw string (`packages/ax-code/src/cli/cmd/workflow-impl.ts:772-809`);
the focused expectations at `packages/ax-code/test/cli/workflow.test.ts:440-470` cover both successful mixed values
and invalid identifiers. No lifecycle-routing defect was found.

## Step 5 Performance and scale behavior

The ordinary `list` command is a single bounded query when `--limit` is supplied, and the underlying schema rejects
non-positive values or values above 500 (`packages/ax-code/src/workflow/state.ts:328-332`). The dashboard path is more
expensive: it first lists runs and then launches one `getDetail` call per run through an unbounded `Promise.all`
(`packages/ax-code/src/cli/cmd/workflow-impl.ts:363-391`). Because `--limit` is optional and `WorkflowRun.list` applies
SQL `LIMIT` only when a value exists (`packages/ax-code/src/workflow/run/index.ts:130-151`), a long-lived project can
produce a large read fan-out. This is a LOW operational concern for a user-invoked local command, not a release
blocker; a modest default dashboard limit with an explicit override would avoid latency and memory spikes while
preserving access to older runs.

## Step 6 Design and ownership

The CLI layer mostly owns presentation and argument translation, then delegates persistence, trust, planning, and
scheduling to workflow modules imported at `packages/ax-code/src/cli/cmd/workflow-impl.ts:6-28`. That boundary is
healthy: for example, the CLI forwards `--trusted`, but routine validation and saving remain in
`packages/ax-code/src/workflow/routine.ts:107-139`; likewise, starting delegates policy enforcement to the scheduler.
One maintainability pressure is the near-duplicate start-option builders for `start` and `run-routine`
(`packages/ax-code/src/cli/cmd/workflow-impl.ts:533-607` and `packages/ax-code/src/cli/cmd/workflow-impl.ts:632-706`),
which could drift as new model or execution flags are added. A shared builder helper would reduce that risk. The
one-line barrel is justified as a stable import path, proven by the focused test importing it rather than the
implementation (`packages/ax-code/test/cli/workflow.test.ts:2-17`).

## Step 7 Error paths, dead code, and output hygiene

There are no TODO/FIXME markers or empty catch bodies in `workflow-impl.ts`. Its two catches have explicit fallback
semantics: malformed JSON input becomes a literal string (`packages/ax-code/src/cli/cmd/workflow-impl.ts:803-809`),
and a non-serializable artifact payload is stringified defensively (`packages/ax-code/src/cli/cmd/workflow-impl.ts:1126-1133`).
Machine-readable output is centralized in `writeJson` (`packages/ax-code/src/cli/cmd/workflow-impl.ts:1045-1047`),
while human output uses the platform EOL imported at line 1. The reusable control-command factory eliminates repeated
pause/resume/cancel handler logic and validates run IDs before dispatch (`packages/ax-code/src/cli/cmd/workflow-impl.ts:994-1022`).
The exported formatters and parsers are exercised from the barrel, and `WorkflowCommand` is consumed by boot, so no
dead public symbol was established.

## Step 8 Test evidence and gaps

The direct test is `packages/ax-code/test/cli/workflow.test.ts`: it imports fourteen helpers through the candidate
barrel (`packages/ax-code/test/cli/workflow.test.ts:2-17`) and covers provider normalization, template/run/dashboard/
routine/eval/artifact/detail formatting, typed input parsing, and branded IDs through line 471. The focused run passed
all 12 tests. The audit's generated test list instead names broad adjacent CLI tests and omits this direct file
(`docs/module-quality-audit/modules/cli-cmd-workflow/MODULE-AUDIT.md:31-46`), so that inventory should not be treated as
a coverage map. A LOW gap remains: no test references `WorkflowCommand`, `wflow`, `create-routine`, `run-routine`, or
the yargs handlers themselves; consequently command registration, runtime gating, option-to-handler camel-case
mapping, and JSON-vs-human branches are checked only by static review. A small command-level test would cover the
highest-value wiring.

## Step 9 Findings and verification result

No Critical, High, or Medium issue was found, and the on-disk audit ledger contains no accepted finding
(`docs/module-quality-audit/modules/cli-cmd-workflow/MODULE-AUDIT.md:60-64`). Two LOW follow-ups remain: cap the default
dashboard fan-out evidenced at `packages/ax-code/src/cli/cmd/workflow-impl.ts:379-386`, and add handler-level coverage
around the command tree at `packages/ax-code/src/cli/cmd/workflow-impl.ts:967-991`. The duplicated start/routine option
builder is advisory maintainability work. Verification on 2026-08-11 passed with
`AX_TEST_FILES=test/cli/workflow.test.ts pnpm exec vitest run` (1 file, 12 tests) and
`pnpm --dir packages/ax-code run typecheck` (exit 0). Since neither the ledger nor this independent evidence pass
contains a Critical item, the Critical-only `reverify.md` artifact is not applicable.
