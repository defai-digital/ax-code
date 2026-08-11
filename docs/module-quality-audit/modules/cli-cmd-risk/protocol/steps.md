# Protocol Steps — cli-cmd-risk

Unit: `cli-cmd-risk`
Resolved root: `packages/ax-code/src/cli/cmd/risk.ts` (247 LOC)
Reviewer lane: `ax-code-glm` (model `zai-coding-plan/glm-5.2[1m]`)
Cross-lane verifier: `codex-sol`
Baseline commit: `cab6c0089e3b7b3410f050bc9d824c06a3c3a814`

The candidate source was read in full (`packages/ax-code/src/cli/cmd/risk.ts:1-247`), along with its
load-bearing dependencies `packages/ax-code/src/session/risk.ts`, `packages/ax-code/src/cli/cmd/cmd.ts`,
`packages/ax-code/src/cli/cmd/session-required.ts`, `packages/ax-code/src/id/branded.ts`, and the
existing view test `packages/ax-code/test/cli/risk-view.test.ts`.

## Step 1 Scope and inventory

`cli-cmd-risk` is a single-file unit. Top-level exports are two: the `RiskView` namespace
(`packages/ax-code/src/cli/cmd/risk.ts:7`) and the yargs `RiskCommand`
(`packages/ax-code/src/cli/cmd/risk.ts:194`). `RiskView.lines` (declared at
`packages/ax-code/src/cli/cmd/risk.ts:76`) is a namespace member used both by the command handler
(`risk.ts:243`) and by the unit test (`test/cli/risk-view.test.ts:2,7,36,125,179,215,261,318`).

Imports are tight and justified: `cmd` from `./cmd` (the local `CommandModule` passthrough at
`packages/ax-code/src/cli/cmd/cmd.ts:5`), `Instance` for project bootstrapping, `SessionRisk` for the
data load, `SessionID` for the branded identifier, and `ProbabilisticRollout` purely to derive the
`ReplayReadinessSummary` type alias at `risk.ts:8`. No unreachable imports, no orphan helpers.

## Step 2 Threat and failure model

This command is read-only with respect to the world: it calls `process.cwd()`
(`risk.ts:228`) as a project anchor, calls `SessionRisk.load` (`risk.ts:231`), and writes only to
stdout via `console.log` (`risk.ts:239,243`). There is no shell exec, no filesystem mutation, and no
network egress in this file. The interesting boundary is error propagation: `SessionRisk.load`
(`packages/ax-code/src/session/risk.ts:112-157`) calls `Session.get(sessionID)` at line 123, which
throws `NotFoundError` (re-exported via `packages/ax-code/src/cli/cmd/session-required.ts:3`) when the
session does not exist. The handler at `risk.ts:226-246` does not catch this; the raw error reaches
the user with a stack trace.

A second boundary subtlety: `SessionID.make(args.sessionID as string)` at `risk.ts:230` looks like
validation but, per `packages/ax-code/src/id/branded.ts:19-21`, `make` is a pure type-brand cast
(`return id as ID`) with no runtime check. The only real liveness check on the identifier is therefore
the downstream `Session.get` call, which feeds back into the error-handling gap above.

## Step 3 Public surface correctness

`RiskView.lines(input, explain = false)` is a pure string-builder. The non-null assertion at
`risk.ts:123` (`input.reviewResults.at(-1)!`) is guarded by the length check at `risk.ts:119`, so it
cannot dereference undefined. The rollup fallback at `risk.ts:58`
(`debug.rollups.length > 0 ? debug.rollups : debug.cases.map(item => ({ ...item, effectiveStatus: item.status }))`)
correctly synthesizes a rollup view when the bundle has cases but no precomputed rollups — this is
exercised by the "renders debug case rollups" test at `test/cli/risk-view.test.ts:170-212`.

The `replaceAll("_", " ")` calls at `risk.ts:37` and `risk.ts:85` assume snake_case enum values; the
tests confirm this contract (`reviewDecisionLabel` is checked via `test/cli/risk-view.test.ts:167`
expecting `"request changes"`, and readiness wording is normalized by
`test/cli/risk-view.test.ts:317-376`). The `validation` helper at `risk.ts:13-18` returns
`"validation unrecorded"` as a defensive fallback for any state outside the three named branches,
which is the right behavior for forward-compatible enum evolution.

## Step 4 Control-flow and option wiring

The handler (`risk.ts:226-246`) is a linear `Instance.provide` block that loads detail and then either
prints JSON (`risk.ts:238-241`) or renders text (`risk.ts:243`). The four data-inclusion flags
(`quality`, `hints`, `review-results`, `debug`; defaults `true` at `risk.ts:208,213,218,223`) are each
forwarded via `Boolean(args.X)` into `SessionRisk.load` options (`risk.ts:232-235`). The mapping is
1:1 — `quality` → `includeQuality`, `hints` → `includeDecisionHints`, `review-results` →
`includeReviewResults`, `debug` → `includeDebug`. There is no `includeFindings`/`includeEnvelopes`
wiring here, which is intentional: the view renderer never reads `detail.findings` or
`detail.envelopes` directly (only `reviewResults`, `debug`, `decisionHints`, `quality`, `drivers`,
`semantic`, `assessment`), so loading them would be wasted work.

The early `return` inside the JSON branch (`risk.ts:240`) correctly skips the text rendering path;
both branches push a trailing empty string so output spacing is consistent.

## Step 5 Performance and resource use

`RiskView.lines` is linear in the number of decision hints × evidence slice plus drivers, breakdown,
evidence, unknowns, and mitigations. The evidence slice is capped at 3 with a `+N more` continuation
(`risk.ts:143-147`), so output size is bounded regardless of hint cardinality. The data loader
`SessionRisk.load` already parallelizes the heavy awaits with `Promise.all`
(`packages/ax-code/src/session/risk.ts:104-108,123-126`) and the optional sub-loads at lines 136-144
run sequentially but each is itself cheap or already parallel internally. There is no N+1 pattern and
no unbounded growth surface introduced by this file.

## Step 6 Design and coupling

The unit depends on four sibling modules (`Instance`, `SessionRisk`, `SessionID`,
`ProbabilisticRollout`) plus the local `cmd` helper, all in the expected direction (CLI → session →
storage). There is no circular edge. The inline type aliases at `risk.ts:8-11` use `NonNullable<...>`
extraction against the canonical `SessionRisk.Detail` schema rather than redefining field shapes, which
keeps the view coupled to the single source of truth in `packages/ax-code/src/session/risk.ts:48-65`.
`RiskView` is exported (not file-private) specifically so the test module
(`test/cli/risk-view.test.ts`) can call `lines` directly without spinning up a yargs handler — this is
a justified, test-driven export, not leakage.

## Step 7 Hygiene and dead code

No empty catch blocks, no `TODO`/`FIXME` markers, no commented-out blocks, no unreachable statements.
Every helper has a live call site: `validation` → `risk.ts:99`; `qualityLine` → `risk.ts:107-109`;
`decisionHintReadiness` → `risk.ts:139`; `reviewDecisionLabel` → `risk.ts:51,52`;
`reviewResultLine` → `risk.ts:123`; `debugCasesLine` → `risk.ts:126`. The only mild smell is the
repeated literal `"  " + "-".repeat(40)` section-divider idiom (five occurrences at `risk.ts:115,122,
130,137,161`), which is cosmetic and below the threshold that would justify a helper.

## Step 8 Findings register

- **MEDIUM — Missing friendly "session not found" handling.** `risk.ts:231` invokes
  `SessionRisk.load` directly. On a missing session, `Session.get` throws `NotFoundError`
  (`packages/ax-code/src/session/risk.ts:123`), and the handler at `risk.ts:226-246` lets it propagate
  raw with a stack trace. Sibling commands `rollback.ts:33`, `branch.ts:22`, and `compare.ts:32-33`
  all route through `getRequiredSession` (`packages/ax-code/src/cli/cmd/session-required.ts:5-13`),
  which catches `NotFoundError`, emits `UI.error("Session not found: <id>")`, and `process.exit(1)`.
  Suggested fix: call `await getRequiredSession(sessionID, args.sessionID as string)` before
  `SessionRisk.load`, mirroring `rollback.ts:32-33`.
- **LOW — `SessionID.make` performs no runtime validation.** `packages/ax-code/src/id/branded.ts:19-21`
  is a pure brand cast, so the cast at `risk.ts:230` validates nothing. The real liveness check is
  `Session.get` downstream. Not actionable inside `risk.ts` alone; recorded as cross-cutting context
  for the medium finding above.
- **LOW — Boolean flag UX gap.** `--quality`, `--hints`, `--review-results`, and `--debug` default to
  `true` (`risk.ts:208,213,218,223`). Users must know yargs' implicit `--no-<flag>` convention to
  disable them, but the `describe` strings do not mention it. A one-line note in each describe would
  close the gap.
- **INFO — JSON output shape varies with option flags.** `JSON.stringify(detail, null, 2)` at
  `risk.ts:239` drops `undefined` optional fields, so `--json --no-quality` produces a different key
  set than `--json`. Acceptable for a CLI inspector; noted for documentation only.

No High or Critical findings were identified during this independent pass.

## Step 9 Verification

Two checks are appropriate for this unit:

1. `pnpm --dir packages/ax-code run typecheck` — confirms the `RiskView` / `RiskCommand` typing
   against the current `SessionRisk.Detail` schema.
2. `pnpm --dir packages/ax-code exec vitest run test/cli/risk-view.test.ts` — directly exercises the
   seven `RiskView.lines` scenarios that cover confidence wording, quality readiness, structured
   review results, debug rollups, verification-policy-failed wording, decision-hint evidence slicing,
   and stale next-action normalization.

No Critical findings were raised, so no second-lane `reverify.md` pass is required by the protocol
gate for `cli-cmd-risk`. The medium-severity error-handling gap should be tracked as a follow-up
against `packages/ax-code/src/cli/cmd/risk.ts:226-246`.
