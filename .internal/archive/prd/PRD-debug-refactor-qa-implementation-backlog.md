# PRD Companion: Debug, Refactor, and QA Implementation Backlog

**Date:** 2026-04-26
**Status:** Phase 4 closed; v4.x.x assurance-lane backlog closed
**Scope:** Internal
**Last reviewed:** 2026-04-30
**Owner:** ax-code agent
**Companion PRD:** `.internal/prd/PRD-debug-refactor-qa-competitive-closeout.md`
**Phase 0 contract:** `.internal/prd/PRD-debug-refactor-qa-phase-0-contract.md` (canonical for finding schema, verification envelope, file-path ownership, gh-CLI decision, `.ax-code/` policy convention)
**Related:** `.internal/adr/ADR-002-distribution-source-plus-bun.md`, `.internal/adr/ADR-003-opentui-bun-mainline-hardening.md`

---

## Purpose

This document turns the assurance-lane PRD into an execution backlog.

It is intended to answer four implementation questions before code work starts:

1. what ships in `v4.x.x`
2. what order it should ship in
3. which code areas each phase should touch
4. what evidence is required before a phase is considered done

Execution policy:

- keep the scope local-first and workflow-first
- reuse existing review, quality, session, and refactor primitives
- avoid introducing a second parallel assurance framework
- do not pull `v5.0.0` items into `v4.x.x`
- finish each phase with tests and a short written sign-off, not only implementation progress

## Version Boundary

Included in this backlog:

- Phase 0: contract alignment
- Phase 1: PR review workflow
- Phase 2: generalized verify-and-repair loop
- Phase 3: runtime debug workflow
- Phase 4: review and QA policy surfaces

Explicitly excluded from this backlog:

- always-on background QA automation
- specialized parallel review fleet
- full managed PR review service
- organization-wide analytics or workflow cost dashboards

Those items remain future-direction work for `v5.0.0` planning.

## Ownership Model

Use code-slice ownership instead of loose shared ownership.

| Owner slice | Primary responsibility | Primary files / areas | Review responsibility |
|---|---|---|---|
| Docs and scope owner | PRD/backlog scope, version boundary, workflow contracts, rollout notes | `.internal/prd/*.md`, `.internal/adr/*.md`, release notes / internal rollout docs | reviews every phase gate before implementation expands |
| Review workflow owner | diff collection, finding schema, review command flow, terminal and JSON output | `packages/ax-code/src/command/**`, `packages/ax-code/src/server/**`, `packages/ax-code/src/session/**`, `packages/ax-code/src/quality/**` | owns Phase 1 implementation and artifact stability |
| Verification owner | shared check runner, failure envelope, repair handoff, check-selection policy | `packages/ax-code/src/tool/refactor_apply.ts`, `packages/ax-code/src/debug-engine/**` (shadow-worktree.ts, plan-refactor.ts, apply-safe-refactor.ts), `packages/ax-code/src/planner/verification/**`, shared verification helpers | owns Phase 2 execution semantics and cost control |
| Runtime debug owner | debug workflow contract, instrumentation path, evidence capture, hypothesis synthesis | `packages/ax-code/src/tool/debug_analyze.ts`, `packages/ax-code/src/debug-engine/**`, session artifact surfaces, debug capture helpers | owns Phase 3 evidence quality and reversibility |
| Policy owner | project-level review and QA rule loading, precedence, trust boundary, future hook contract | config / project-rule loading, session prompt bootstrap, policy readers, docs | owns Phase 4 safety and project-specific behavior |
| Quality owner | contract tests, artifact tests, session quality/readiness expectations, PTY/CLI evidence | `packages/ax-code/test/**`, quality readiness tests, server contract tests, TUI/CLI session tests | owns go/no-go evidence for every phase |

## Cross-Phase Rules

- every phase must reuse existing artifact families where possible before introducing a new one
- every new user-facing workflow needs one machine-readable artifact contract and one human-readable rendering path
- every workflow must remain useful from local CLI/TUI first; GitHub or service integration stays additive
- no phase may depend on background daemons, multi-agent orchestration, or hosted infrastructure
- if a phase reveals missing product language or scope drift, update the PRD/backlog first
- tests that define workflow contracts should land before or with the implementation that consumes them

## Shared Contract Direction

The first implementation wave converges on two shared contracts. **The canonical specs live in `.internal/prd/PRD-debug-refactor-qa-phase-0-contract.md`** — the summary below is for orientation only; if it disagrees with the contract doc, the contract doc wins.

### Shared finding contract (summary)

Net-new schema for review, debug, and QA findings (no existing `review_finding`/`debug_hypothesis`/`qa_failure` artifact families to unify — those names did not exist in the codebase). v1 fields:

- `schemaVersion`, `findingId` (deterministic hash), `workflow`, `category`, `severity` (matches `Risk.Level` upper-case)
- `summary`, `file`, `anchor` (line | symbol)
- `rationale`, `evidence: string[]`, optional `evidenceRefs[]` for typed back-references
- `suggestedNextAction`, optional `ruleId`, optional `confidence`
- `source: { tool, version, runId }`

See contract doc for exact Zod schema, registry-file discipline for enums, and rendering contract.

### Shared verification contract (summary)

Extension of the existing `packages/ax-code/src/planner/verification/index.ts` `VerificationResult` shape, not a replacement. Adds:

- `workflow`, `scope`, `command` identity, `structuredFailures` (typed per check kind)
- `artifactRefs` for cross-linking with findings
- `source` for traceability

Scope escalation is a workflow-level concern, not part of the envelope. See contract doc for the typed shape and the Phase 2 reconciliation with `refactor_apply.result.checks`.

## Phase Backlog

### Phase 0: Contract Alignment

Objective:

- freeze the smallest product contract that all later phases build on

Backlog:

| ID | Concrete task | File ownership | Test ownership / evidence |
|---|---|---|---|
| P0.1 | define the canonical workflow names and entry surfaces for `review`, `debug`, and `qa` across CLI, TUI, and exported artifacts | Docs and scope owner with Review workflow owner review: `.internal/prd/PRD-debug-refactor-qa-competitive-closeout.md`, this backlog doc, command/help text surfaces if naming drift exists | docs review only; one approved workflow surface table |
| P0.2 | design and ratify the shared finding contract. **CORRECTED:** the original "map onto current `review_finding`/`debug_hypothesis`/`qa_failure`" framing was incorrect — those artifact families do not exist in the codebase. Phase 0 deliverable is a net-new schema. See `.internal/prd/PRD-debug-refactor-qa-phase-0-contract.md` for the v1 contract | Review workflow owner and Runtime debug owner: contract doc, then types-only `packages/ax-code/src/quality/finding.ts` and `packages/ax-code/src/quality/finding-registry.ts` | one fixture test under `packages/ax-code/test/quality/finding.test.ts` exercises the v1 Zod schema |
| P0.3 | ratify the shared verification envelope as an extension of the existing `planner/verification.VerificationResult` (not a replacement). Identify the divergence with `refactor_apply.result.checks.{typecheck,lint,tests}` as a Phase 2 reconciliation task | Verification owner: contract doc plus a typed extension alongside `packages/ax-code/src/planner/verification/index.ts` | gap list captured in contract doc; types-only alongside `planner/verification` |
| P0.4 | freeze `v4.x.x` scope and explicitly mark `v5.0.0` deferrals so implementation PRs cannot backdoor background automation or fleet orchestration | Docs and scope owner | docs review only |

Go / No-Go:

- go only if workflow names, artifact vocabulary, and verification vocabulary are all explicit
- no-go if later phases would still need to invent their own finding or verification shape ad hoc

### Phase 1: PR Review Workflow

Objective:

- turn existing review/risk/quality primitives into a first-class review workflow

Backlog:

| ID | Concrete task | File ownership | Test ownership / evidence |
|---|---|---|---|
| P1.1 | define one review entry contract that can review uncommitted diff, branch diff, and PR diff through the same internal pipeline. **DECIDED:** PR diff acquisition is `gh` CLI only in v4.x.x — see Phase 0 contract doc; no `--no-gh` fallback. Existing template `review.txt` already documents all four entry shapes, so this is wiring not design | Review workflow owner: `packages/ax-code/src/command/template/review.txt`, new `packages/ax-code/src/quality/pr-diff.ts` (gh wrapper), review command routing, diff selection helpers, session prompt helpers | command/template tests and prompt helper tests for all three entry shapes; tests cover gh-missing failure path |
| P1.2 | standardize the machine-readable review artifact so findings carry severity, anchor, rationale, evidence, and next action consistently | Review workflow owner with Quality owner review: `packages/ax-code/src/quality/**`, review export logic, server/session artifact readers | `packages/ax-code/test/session/risk.test.ts`, `test/server/session-risk.test.ts`, `test/quality/probabilistic-rollout.test.ts` coverage for stable artifact export |
| P1.3 | add a review output path that renders findings clearly in terminal output and exports the same run as JSON without separate logic | Review workflow owner: CLI/TUI review output surfaces, server/export path if needed | snapshot or rendering tests plus JSON round-trip test |
| P1.4 | keep Tier 1 findings narrow: correctness, regression risk, missing verification, and migration safety; defer style commentary | Review workflow owner and Docs and scope owner: review prompt/template surfaces and finding filters | focused review fixture tests that prove style-only noise is not elevated |
| P1.5 | ensure review artifacts show up cleanly in existing session quality/readiness surfaces without inventing a new side system | Review workflow owner with Quality owner review: `packages/ax-code/src/cli/cmd/tui/context/sync*.ts*`, session risk routes, session quality helpers | `packages/ax-code/test/cli/tui/session-quality.test.ts`, `test/cli/tui/sync-result.test.ts`, `test/cli/tui/sync-event-dispatch.test.ts` |

Go / No-Go:

- go only if one codepath can review local diff, branch diff, and PR diff and produce the same artifact family
- no-go if PR review depends on a separate service path or if findings cannot be exported and rendered consistently

### Phase 2: Generalized Verify-and-Repair Loop

Objective:

- turn verification from a refactor-specific safeguard into a shared workflow primitive

Backlog:

| ID | Concrete task | File ownership | Test ownership / evidence |
|---|---|---|---|
| P2.1 | extract or formalize a reusable verification runner from the current `refactor_apply` path without weakening the existing shadow-worktree guarantees. **NOTE:** the actual shadow-worktree implementation lives at `packages/ax-code/src/debug-engine/shadow-worktree.ts` (not `src/worktree/`); the safe-apply pipeline is `packages/ax-code/src/debug-engine/apply-safe-refactor.ts`; the Phase 2 runner should also reconcile `refactor_apply.result.checks.{typecheck,lint,tests}` with `packages/ax-code/src/planner/verification/`'s `VerificationResult` shape — see Phase 0 contract doc | Verification owner: `packages/ax-code/src/tool/refactor_apply.ts`, `packages/ax-code/src/debug-engine/{shadow-worktree,apply-safe-refactor}.ts`, `packages/ax-code/src/planner/verification/index.ts` | preserve existing `refactor_apply` tests and add targeted tests for the extracted runner |
| P2.2 | define the smallest-relevant-checks-first policy, including how to escalate from targeted check to broader verification | Verification owner with Docs and scope owner review: shared verification policy helper and workflow docs | unit tests for selection/escalation policy plus fixture examples |
| P2.3 | emit a structured failure envelope for typecheck, lint, and test failures so later repair steps do not need to scrape plain terminal text | Verification owner: shared result model, check adapters, export helpers | new tests for structured failure output across at least one typecheck, one lint, and one test failure |
| P2.4 | add an opt-in repair handoff for local, well-bounded failures while keeping the loop observable and cancelable | Verification owner and Review workflow owner: session/tool workflow surfaces that consume the failure envelope | focused tests for repair handoff creation, abort, and pass-through when auto-repair is not appropriate |
| P2.5 | make review and debug workflows able to attach verification artifacts without duplicating check runners | Verification owner with Runtime debug owner review: shared artifact attachment logic and session artifact surfaces | integration tests showing review/debug workflows can reuse the same verification output |

Go / No-Go:

- go only if non-refactor edits can use the same verification contract as `refactor_apply`
- no-go if verification remains tied to one tool path or if failures are still only available as raw terminal blobs

Phase 2 closeout sign-off (2026-04-30):

- **P2.1 reusable runner + shape reconciliation:** `packages/ax-code/src/planner/verification/runner.ts` is shared by `verify_project` and `applySafeRefactor`; `DebugEngine.ApplyResult.checks` now preserves runner `skipped`, `timedOut`, and `exitCode` metadata so `refactor_apply` and `VerificationEnvelope` statuses stay aligned.
- **P2.2 smallest-relevant-checks-first policy:** `packages/ax-code/src/planner/verification/check-policy.ts` owns the pure scope-selection policy and has unit coverage for file/package/workspace escalation.
- **P2.3 structured failure envelopes:** `packages/ax-code/src/quality/verification-envelope-builder.ts` emits citable `VerificationEnvelope[]` for refactor and generic verification runs, with structured typecheck/lint/test parsing and timeout/skipped propagation.
- **P2.4 opt-in repair handoff:** `packages/ax-code/src/planner/verification/repair-handoff.ts` owns the pure handoff decision/brief logic; `verify_project` exposes it through `repairHandoff: true` without editing files or starting an automatic repair loop.
- **P2.5 review/debug verification attachment:** session verification loaders preserve run boundaries and metadata; `review_complete`, `debug_propose_hypothesis`, and `debug_apply_verification` can cite verification artifacts without duplicating check runners.

Closeout evidence:

- `bun test test/quality/verification-envelope-builder.test.ts test/planner/verification-runner.test.ts test/planner/check-policy.test.ts test/planner/repair-handoff.test.ts`
- `bun test test/debug-engine/phase2-3.test.ts`
- `bun test test/tool/verify_project.test.ts test/tool/review_complete.test.ts test/tool/debug_apply_verification.test.ts test/tool/debug_propose_hypothesis.test.ts test/session/verifications.test.ts test/session/decision-hints.test.ts test/debug-engine/verify-after-fix.test.ts`
- `pnpm --dir packages/ax-code run typecheck`
- `pnpm --dir packages/ax-code run build -- --single`
- `bun run packages/ax-code/script/tui-startup-smoke.ts --bin packages/ax-code/dist/ax-code-darwin-arm64/bin/ax-code --backend-transport worker --timeout-ms 20000`

Phase 2 is closed for the v4.x.x assurance-lane backlog. Remaining work should move to Phase 3 runtime debug workflow unless new Phase 2 regressions are found.

### Phase 3: Runtime Debug Workflow

Objective:

- make debugging evidence-driven and verify-after-fix capable

Backlog:

| ID | Concrete task | File ownership | Test ownership / evidence |
|---|---|---|---|
| P3.1 | define the minimal runtime debug workflow: issue description -> evidence request or capture -> hypothesis -> fix -> verification result | Runtime debug owner: `packages/ax-code/src/tool/debug_analyze.ts`, `packages/ax-code/src/debug-engine/analyze-bug.ts`, debug prompt surfaces, session workflow docs | workflow contract tests and prompt tests for the minimum happy path |
| P3.2 | support explicit, temporary instrumentation or log-capture requests that are auditable and easy to remove | Runtime debug owner: debug capture helpers, session artifact writers, any temp-instrumentation helper layer | tests proving instrumentation plans are explicit and removable; no silent persistent edits |
| P3.3 | combine graph-backed `debug_analyze` output with runtime evidence into a ranked hypothesis artifact instead of a purely static explanation. **NOTE:** there is no existing `debug_hypothesis` artifact family — see Phase 0 contract doc; this task emits a `Finding` with `category: "bug"` and `confidence` propagated from `analyzeBug.result.confidence`, persisted via the existing `QualityShadow.captureDebugAnalyze` seam | Runtime debug owner with Quality owner review: `packages/ax-code/src/debug-engine/**`, `packages/ax-code/src/quality/shadow-runtime.ts`, artifact mapping, session risk/readiness surfaces | new `Finding` contract tests and session quality export tests |
| P3.4 | wire the shared verification runner into debug resolution so fix verification is recorded, not implied | Runtime debug owner and Verification owner: debug workflow integration points and artifact attachments | end-to-end tests for unresolved vs verified debug outcomes |
| P3.5 | ensure unresolved debug cases remain clearly unresolved in session artifacts and user-facing summaries | Runtime debug owner with Quality owner review: session quality/readiness summaries, exported debug artifacts | tests for unresolved state wording and artifact export behavior |

Go / No-Go:

- go only if at least one path can go from bug report to evidence to fix verification using persisted artifacts
- no-go if runtime debug remains only a stack-trace explainer with no evidence or no explicit unresolved state

Phase 3 closeout sign-off (2026-04-30):

- **P3.1 runtime workflow contract:** `packages/ax-code/src/debug-engine/runtime-debug.ts` defines the persisted case, evidence, instrumentation-plan, and hypothesis artifacts. Prompt guardrail tests keep the required `debug_analyze` -> `debug_open_case` / `debug_capture_evidence` / `debug_plan_instrumentation` / `debug_propose_hypothesis` -> `verify_project(workflow: "debug")` -> `debug_apply_verification` path visible to agents.
- **P3.2 temporary instrumentation lifecycle:** `debug_plan_instrumentation` now records `planned`, `applied`, and `removed` status updates for the same deterministic plan id. Prompt guidance now surfaces the tool so temporary probes have an auditable removal path instead of becoming silent persistent edits.
- **P3.3 graph-backed hypothesis validation:** `debug_propose_hypothesis` now rejects fabricated or mismatched `staticAnalysis.sourceCallId` references. A hypothesis can only cite static analysis when the session contains a completed `debug_analyze` result with matching `chainLength` and `chainConfidence`.
- **P3.3 debug-analyze finding export:** `debug_analyze` emits a validated `Finding` with `workflow: "debug"`, `category: "bug"`, confidence-derived severity, and graph/runtime evidence. `ProbabilisticRollout.exportReplay(session, "debug")` now preserves that finding summary on the `debug_hypothesis` replay item instead of dropping it during export.
- **P3.3/P3.5 runtime debug replay export:** `ProbabilisticRollout.exportReplay(session, "debug")` now exports persisted runtime debug cases and ranked hypotheses from `debug_open_case` / `debug_capture_evidence` / `debug_propose_hypothesis` metadata, so the Phase 3 workflow feeds the shared readiness and benchmark artifact path instead of only the TUI/CLI summaries.
- **P3.4 go/no-go proof path:** `packages/ax-code/test/tool/debug_runtime_workflow.test.ts` proves one persisted path from debug case -> temporary instrumentation -> evidence -> hypothesis -> `verify_project(workflow: "debug")` -> `debug_apply_verification` -> resolved session rollup.
- **P3.5 CLI unresolved-case visibility:** `ax-code risk` now loads debug case rollups by default and renders a `Debug Cases` section, so unresolved runtime debug work stays visible outside the TUI.
- **P3.5 TUI unresolved-case visibility:** session risk sync carries debug rollups into the TUI, and the sidebar / quality overview render unresolved, investigating, open, and resolved debug cases without relying on replay labels.
- **Shared verification id stability:** `computeEnvelopeId` now omits undefined object fields during canonicalization so the envelope ids shown by `verify_project` survive JSON session persistence and can be used by `debug_apply_verification`.

Closeout evidence:

- `bun test test/quality/probabilistic-rollout.test.ts test/session/findings.test.ts test/session/debug.test.ts test/session/risk.test.ts test/tool/debug_plan_instrumentation.test.ts test/tool/debug_propose_hypothesis.test.ts test/tool/debug_apply_verification.test.ts test/tool/debug_runtime_workflow.test.ts test/debug-engine/runtime-debug.test.ts test/cli/risk-view.test.ts test/cli/tui/session-quality.test.ts test/cli/tui/sync-session-risk.test.ts test/session/debug-workflow-prompts.test.ts`
- `pnpm --dir packages/ax-code run typecheck`
- `pnpm --dir packages/ax-code run build -- --single`
- `pnpm --dir packages/ax-code run tui:startup-smoke -- --bin packages/ax-code/dist/ax-code-darwin-arm64/bin/ax-code --timeout-ms 20000`
- `pnpm --dir packages/ax-code run tui:startup-smoke -- --bin packages/ax-code/dist/ax-code-darwin-arm64/bin/ax-code --backend-transport process --timeout-ms 20000`

Phase 3 is closed for the v4.x.x assurance-lane backlog. Remaining work should move to Phase 4 review and QA policy surfaces unless new Phase 3 regressions are found.

### Phase 4: Review and QA Policy Surfaces

Objective:

- give teams a durable way to teach AX Code what to review and what to verify

Backlog:

| ID | Concrete task | File ownership | Test ownership / evidence |
|---|---|---|---|
| P4.1 | define a minimal `.ax-code/review.md` and `.ax-code/qa.md` contract, including scope, precedence, and safe loading rules. **DECIDED:** files live under the existing `.ax-code/` namespace and reuse `ConfigPaths.directories` walk-up — see Phase 0 contract doc | Policy owner: new `packages/ax-code/src/quality/policy.ts` (reuses `packages/ax-code/src/config/paths.ts`), docs, prompt bootstrap surfaces | config and project-state tests for discovery and precedence |
| P4.2 | load review and QA policy separately from general coding instructions so assurance workflows do not rely on prompt repetition | Policy owner: session prompt/bootstrap assembly, project context loading, config readers | prompt assembly tests showing review/qa context is present only where intended |
| P4.3 | allow policies to require checks, finding classes, or migration-safety expectations without introducing arbitrary code hooks yet | Policy owner and Verification owner: policy reader + workflow filters/selectors | fixture tests for required checks and narrowing false positives |
| P4.4 | document a future hook design for review/debug/qa workflows, but keep the `v4.x.x` implementation to declarative policy only unless an existing hook can be safely reused | Policy owner and Docs and scope owner | docs review only unless a narrow existing SDK hook is reused without new runtime complexity |
| P4.5 | verify that policy surfaces narrow false positives instead of only adding more output | Policy owner with Quality owner review: review fixtures and QA workflow tests | before/after fixture evidence in tests or rollout notes |

Go / No-Go:

- go only if teams can encode project-specific review or QA expectations without custom prompts
- no-go if policy loading blurs trust boundaries or becomes a generic hook platform in `v4.x.x`

Phase 4 closeout sign-off (2026-04-30):

- **P4.1 policy discovery boundary:** `ConfigPaths.policyDirectories(directory, worktree)` now centralizes review/QA policy directory discovery on top of `ConfigPaths.directories`, preserving nearest project `.ax-code/` precedence while inheriting `AX_CODE_DISABLE_PROJECT_CONFIG`.
- **P4.1 safe fallback behavior:** `Policy.loadReviewPolicy` / `Policy.loadQaPolicy` still load only namespaced `.ax-code/review.md` and `.ax-code/qa.md`; when project config is disabled, project policies are skipped and user `~/.ax-code/` policy can be used as the fallback.
- **P4.2 workflow-specific prose context:** `Policy.loadWorkflowPolicy` and `verify_project` now load `.ax-code/review.md` only for `workflow: "review"` and `.ax-code/qa.md` only for `workflow: "qa"`. Debug verification and general prompts do not inherit review/QA prose policy.
- **P4.3 declarative-only rule surface:** existing `.ax-code/review.rules.json` and `.ax-code/qa.rules.json` validation remains declarative-only: required checks, categories, severity floors, and scope globs; no hook runtime or executable policy path was added.
- **P4.4 hook deferral:** `.internal/prd/PRD-debug-refactor-qa-phase-0-contract.md` records the future hook design as a v5.0.0 candidate only. Final audit found no `.ax-code/hooks` discovery, `hook.executed` event, or policy-layer subprocess hook runtime in the v4.x.x implementation.
- **P4.5 false-positive reduction evidence:** `review_complete` now records `metadata.policy.impact` with pre-policy and post-policy finding counts, blocking-finding counts, recommended decisions, dropped finding count, and dropped blocking finding ids. The user-visible output also reports the policy impact line, so policy narrowing is auditable rather than just hidden filtering.

Progress evidence:

- `bun test test/quality/policy.test.ts test/quality/policy-filter.test.ts test/tool/verify_project.test.ts test/tool/review_complete.test.ts test/session/debug-workflow-prompts.test.ts`
- `bun test test/tool/review_complete.test.ts test/quality/policy-filter.test.ts test/quality/policy.test.ts test/tool/verify_project.test.ts`
- `bun test test/config/config.test.ts test/config/tui.test.ts test/quality/policy.test.ts`
- `pnpm --dir packages/ax-code run typecheck`
- `pnpm --dir packages/ax-code run build -- --single`
- `pnpm --dir packages/ax-code run tui:startup-smoke -- --bin packages/ax-code/dist/ax-code-darwin-arm64/bin/ax-code --timeout-ms 20000`
- `pnpm --dir packages/ax-code run tui:startup-smoke -- --bin packages/ax-code/dist/ax-code-darwin-arm64/bin/ax-code --backend-transport process --timeout-ms 20000`

Phase 4 is closed for the v4.x.x assurance-lane backlog. The next work item should be a release/readiness pass or a scoped commit, not more Phase 4 feature expansion, unless a regression is found.

## Phase Dependencies

| Phase | Depends on | Why |
|---|---|---|
| 0 | none | contract freeze comes first |
| 1 | 0 | review output should adopt approved finding vocabulary |
| 2 | 0, 1 | verification should align to shared contracts and attach to review artifacts |
| 3 | 0, 2 | runtime debug becomes much more useful once evidence and verification schemas are stable |
| 4 | 0, 1, 2, 3 | policy surfaces should target workflows that already exist, not speculative ones |

## Minimum Evidence Per Phase

| Phase | Required evidence before merge |
|---|---|
| 0 | approved PRD/backlog diff and explicit contract summary for workflow names, finding vocabulary, and verification vocabulary |
| 1 | review command coverage for local diff / branch diff / PR diff, stable artifact export proof, and readable terminal rendering proof |
| 2 | extracted or shared verification runner proof, structured failure envelope tests, and one repair-handoff proof |
| 3 | debug workflow contract proof, persisted runtime evidence artifact proof, and verified vs unresolved debug outcome proof |
| 4 | policy discovery and precedence tests, workflow-specific prompt/context proof, and false-positive narrowing evidence |

## Recommended Implementation Order

1. Phase 0: lock contracts before changing code paths
2. Phase 1: ship review first because it is the biggest visible competitive gap
3. Phase 2: generalize verification next because it benefits both coding-first and assurance-first users
4. Phase 3: add runtime debug on top of shared artifacts and verification
5. Phase 4: add review/QA policy once the workflows are real enough to target

## Concrete First Sprint

If implementation starts immediately after review, the first sprint should be deliberately narrow:

1. finish Phase 0 docs and artifact vocabulary review
2. implement Phase 1 entry-contract unification for local diff / branch diff / PR diff
3. standardize the review finding export shape without broadening review scope
4. keep the initial terminal rendering plain and stable
5. leave verify-and-repair and runtime debug for later sprints once the review artifact path is solid

## Final Recommendation

Treat this backlog as the execution companion to the assurance-lane PRD.

The right first implementation wave for `v4.x.x` is:

- one review workflow
- one verification workflow
- one runtime debug workflow
- one policy layer to steer them

Everything else should wait.
