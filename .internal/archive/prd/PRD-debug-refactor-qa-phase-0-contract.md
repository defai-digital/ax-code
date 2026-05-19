# PRD Companion: Phase 0 Contract — Debug, Refactor, QA Assurance Lane

**Date:** 2026-04-26
**Status:** Draft for review
**Scope:** Internal
**Last reviewed:** 2026-04-26
**Owner:** ax-code agent
**Companion PRD:** `.internal/prd/PRD-debug-refactor-qa-competitive-closeout.md`
**Companion backlog:** `.internal/prd/PRD-debug-refactor-qa-implementation-backlog.md`
**Related:** `.internal/adr/ADR-002-distribution-source-plus-bun.md`, `.internal/adr/ADR-003-opentui-bun-mainline-hardening.md`

---

## Purpose

This document locks the smallest contract every later phase of the assurance lane depends on. It does three things:

1. corrects a false premise in the original Phase 0 (the artifact families it asks us to "unify" do not exist yet)
2. anchors every later phase to verified file paths and real type shapes already in the repo
3. records the competitive baseline (April 2026) that informs the shared schemas

This document does not introduce new product code. It produces vocabulary, schemas, and decisions that Phase 1+ will implement.

## Correction to the original Phase 0

The implementation backlog (P0.2 and the "Shared finding contract" section) treats `review_finding`, `debug_hypothesis`, and `qa_failure` as existing artifact families to be unified. A grep across `packages/ax-code/src` returns zero matches for any of those identifiers. They are aspirational names, not current code.

The corrected Phase 0 stance:

- the shared finding contract is a **new design**, not a unification of existing artifacts
- `debug_analyze` already returns a usable analysis result (chain + confidence + explain) but it lives in tool metadata, not as a persisted, queryable artifact family
- `refactor_apply` already returns structured check results, but with a different shape than the planner verification module — Phase 2 must reconcile, not unify
- the review prompt template `packages/ax-code/src/command/template/review.txt` already documents the four review entry forms (no-arg, commit, branch, PR) and uses `gh pr view` + `gh pr diff` for PR diffs — so the entry-contract groundwork exists in prose

The rest of this document treats the contract as net-new design grounded in what does exist.

## Verified existing primitives

Every file path and type shape below was verified by reading source on 2026-04-26.

### Verification — `packages/ax-code/src/planner/verification/index.ts`

```ts
export type VerificationStatus = "passed" | "failed" | "skipped" | "timeout" | "error"

export interface VerificationIssue {
  file: string
  line?: number
  column?: number
  severity: "error" | "warning"
  message: string
  code?: string
}

export interface VerificationResult {
  name: string
  type: "typecheck" | "lint" | "test" | "custom"
  passed: boolean
  status: VerificationStatus
  issues: VerificationIssue[]
  duration: number
  output?: string
}

export interface PhaseVerification {
  phaseId: string
  passed: boolean
  results: VerificationResult[]
  duration: number
}
```

This is already very close to the "shared verification envelope" the PRD asks for. Phase 2 should **extend it**, not invent a new shape.

### Verification — divergent shape inside `refactor_apply`

`packages/ax-code/src/tool/refactor_apply.ts` consumes a different shape from `DebugEngine.applySafeRefactor`:

```text
result.checks.typecheck = { ok: bool, errors: [...] }
result.checks.lint      = { ok: bool, errors: [...] }
result.checks.tests     = { ok: bool, selection: ..., ran: number, failed: number }
```

This is the divergence Phase 2 must reconcile. The two shapes carry overlapping but not identical information. Phase 2 owners must pick whether `refactor_apply` adopts the `VerificationResult[]` shape, or whether the verification module exposes a `RefactorChecks` view of the same underlying data.

### Refactor — `packages/ax-code/src/tool/refactor_apply.ts` and `packages/ax-code/src/tool/refactor_plan.ts`

- `refactor_plan` returns `{ planId, kind, edits[], affectedFiles[], risk, summary, status }` and is the only DRE tool gated behind permission `edit` for pre-flight (because the shadow worktree runs project commands)
- `refactor_apply` is the only DRE tool that writes files; gated by `permission: "edit"` per file pattern
- both are gated by `AX_CODE_EXPERIMENTAL_DEBUG_ENGINE`
- supporting code lives under `packages/ax-code/src/debug-engine/` — **not** `packages/ax-code/src/worktree/` or `packages/ax-code/src/planner/` as the original backlog claimed. There is no `src/worktree/` directory. The shadow worktree implementation is `packages/ax-code/src/debug-engine/shadow-worktree.ts`. The refactor planner is `packages/ax-code/src/debug-engine/plan-refactor.ts`. The safe-apply pipeline is `packages/ax-code/src/debug-engine/apply-safe-refactor.ts`.

### Debug — `packages/ax-code/src/tool/debug_analyze.ts`

`DebugEngine.analyzeBug` returns:

```text
{
  chain: StackFrame[],          // each: { frame, role, file, line, symbol? }
  confidence: number,            // capped at 0.95
  truncated: boolean,
  explain: { heuristicsApplied: string[], graphQueries: ... }
}
```

This is delivered as `metadata.result` on the tool result, not as a named, queryable artifact family. There is **no** `debug_hypothesis` table or persistent artifact today.

There is, however, a quality-shadow capture: `QualityShadow.captureDebugAnalyze({ session, callID, error, stackTrace, metadata })` in `packages/ax-code/src/quality/shadow-runtime.ts`. Phase 3 should treat this as the existing persistence seam, not invent a parallel one.

### Risk — `packages/ax-code/src/risk/score.ts`

Already exposes a richer assessment shape than the proposed finding contract:

```ts
type Level = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
type Readiness = "ready" | "needs_validation" | "needs_review" | "blocked"

type Assessment = {
  level: Level
  score: number
  confidence: number
  readiness: Readiness
  signals: NormalizedSignals
  summary: string
  breakdown: Factor[]
  evidence: string[]
  unknowns: string[]
  mitigations: string[]
}
```

The shared finding contract should **align severity with Risk.Level** (lowercased) so review/debug/qa findings can roll up into existing risk surfaces without a translation layer.

### Review — `packages/ax-code/src/command/template/review.txt`

Already encodes the four entry shapes the backlog asks for:

1. no-arg → `git diff` + `git diff --cached` + `git status --short`
2. commit hash → `git show $ARGUMENTS`
3. branch name → `git diff $ARGUMENTS...HEAD`
4. PR URL/number → `gh pr view $ARGUMENTS` + `gh pr diff $ARGUMENTS`

It also already states the right Tier 1 narrowing rules (bugs / structure / performance / behavior changes; do not flag style; only review changes; do not invent hypothetical problems). Phase 1 work is therefore not "design the entry contract" — it is "emit a machine-readable artifact alongside the existing prose output without changing prose quality."

## Competitive baseline (April 2026)

Verified via direct documentation fetch on 2026-04-26.

### Claude Code

- `/review [PR]` — review a PR locally in current session ([commands ref](https://code.claude.com/docs/en/commands))
- `/ultrareview [PR]` — deep multi-agent code review in cloud sandbox
- `/security-review` — git-diff-only, focused on injection / auth / data exposure
- `/simplify [focus]` — bundled skill, "Spawns three review agents in parallel, aggregates their findings, and applies fixes"
- `/debug [description]` — bundled skill, enables debug logging and analyzes session log
- `/autofix-pr` — watches a PR and pushes fixes when CI fails or reviewers comment; uses `gh pr view` for PR detection
- `/install-github-app` — Claude GitHub Actions integration
- Config files: `CLAUDE.md` (instructions); skills declare `hooks`, `allowed-tools`, `agent` (sub-agent), `paths` (glob-scoped activation)

### Cursor Bugbot

- Triggers automatically on every PR update; manual via comment `cursor review` or `bugbot run` ([docs](https://cursor.com/docs/bugbot))
- Reads existing GitHub PR comments to avoid duplicates
- Inline PR comments + PR review with "Fix in Cursor" / "Fix in Web" links
- Findings: bugs, security, code quality, custom violations
- Per-repo enable/disable, scoped paths via globs, manual-only mode
- Project rules in `.cursor/BUGBOT.md`; rule fields: `Name`, `Rule content`, `Scoped paths`
- Has "Learned rules from team activity" — confirms the original backlog's deferral of "auto-rule learning" to v5.0.0 is sensible

### aider

- `--lint-cmd <cmd>`, `--no-auto-lint` (auto-lint is **on by default**), `--test-cmd <cmd>`, `--auto-test`, `--lint "language: cmd"` ([docs](https://aider.chat/docs/usage/lint-test.html))
- In-chat: `/lint`, `/test`, `/run`, `/diff`, `/commit`, `/git`, `/undo`, `/add`, `/drop`
- No `/review` command in current docs
- Failure-to-repair contract is dead-simple: command must "print errors on stdout/stderr and return non-zero exit code"; aider then "will try and fix any errors"
- Format-loop pitfall documented: linters that auto-format produce false positives, so docs recommend running twice in a wrapper script

### Gemini CLI

- No documented `/review`, `/debug`, `/qa`, `/lint`, `/test` slash commands as of April 2026 ([commands ref](https://geminicli.com/docs/reference/commands))
- `GEMINI.md` hierarchical context files (global / project / subdirectory, concatenated); `/memory refresh` reloads
- `--output-format json` and `--output-format stream-json` for scripting/automation
- "Pull Request Reviews" exists as a GitHub Action integration, not a slash command
- `/agents` exists for sub-agents

### Common patterns the field has converged on

| Pattern | Where seen | Implication for ax-code |
|---|---|---|
| `gh pr view` + `gh pr diff` for PR diff acquisition | Claude Code `/autofix-pr`, ax-code `review.txt`, Cursor Bugbot (via webhook equivalent) | Use `gh` as the primary PR diff source; do not invent a parallel fetcher |
| Project-level instruction file (Markdown) | CLAUDE.md, GEMINI.md, .cursor/BUGBOT.md, AGENTS.md | Adopt project-rooted Markdown; precedence rules are Cursor-style (workspace > user) |
| Severity classes converge on bugs / security / quality / behavior change | Cursor Bugbot, ax-code `review.txt`, Claude Code `/security-review` | Adopt this taxonomy as the v1 severity *category*, separate from the severity *level* |
| Verify-and-repair via exit code + stdout | aider, ax-code `refactor_apply` | Keep the contract simple: structured failure list inside the envelope, plus raw output for inspection |
| JSON output flag for automation | Gemini CLI `--output-format json/stream-json` | Mirror this for ax-code review/qa export |
| Multi-agent reviewer orchestration | Claude Code `/ultrareview`, `/simplify` | This is the "specialized parallel reviewer fleet" the PRD defers to v5.0.0 — confirms the deferral is sensible because competitors are still maturing it |
| Inline PR comments vs aggregate session output | Cursor inline; Claude Code aggregate | ax-code should produce one artifact that *both* surfaces consume, not pick one |

## Workflow surfaces (canonical names and entry points)

| Workflow | Entry surfaces | Primary file home | Status |
|---|---|---|---|
| `review` | CLI: existing skill template `packages/ax-code/src/command/template/review.txt`; future TUI invocation; future JSON export | the existing template plus a new finding emitter | template exists, machine-readable emitter does not |
| `debug` | Tool: `packages/ax-code/src/tool/debug_analyze.ts`; future workflow that wraps it | `packages/ax-code/src/tool/debug_analyze.ts` + `packages/ax-code/src/debug-engine/analyze-bug.ts`; future debug workflow file | static analysis exists; runtime workflow does not |
| `qa` | Verification: `packages/ax-code/src/planner/verification/index.ts`; refactor verify-and-repair: `packages/ax-code/src/debug-engine/apply-safe-refactor.ts` | extension of `planner/verification` + reconciliation with `refactor_apply` checks | both partial implementations exist; shared contract does not |

These names — `review`, `debug`, `qa` — are reserved for v4.x.x assurance-lane workflows. New tools or commands in this lane must adopt one of these names or extend an existing artifact tied to one of them.

## Shared finding contract v1

A finding is a single actionable claim about code or runtime state, produced by review, debug, or qa.

### Design discipline

This v1 schema is intentionally minimal. Every field below is required by a named consumer in Phase 1, 2, or 3. Discriminated unions, "future-proofing" placeholders, and convenience subtypes were considered and dropped — they belong in v2 if and when a real consumer needs them. The v1 surface is roughly aider's `--auto-test`-and-stdout simplicity plus the structured fields review/debug/qa cannot do without.

### Schema fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `schemaVersion` | literal `1` | yes | v1 is locked. Structural changes ship as `schemaVersion: 2` with parallel emit for one v4.x release. New enum members go in a registry file (see "Versioning policy" below) — they do not bump the version |
| `findingId` | string | yes | deterministic hash: `sha256(workflow + category + file + anchorRef + ruleId).hex.slice(0,16)` where `anchorRef` is `line:N` or `symbol:ID`. Enables dedup across runs and across PR comment refresh |
| `workflow` | `"review" \| "debug" \| "qa"` | yes | canonical lane name |
| `category` | `"bug" \| "security" \| "regression_risk" \| "behavior_change" \| "missing_verification" \| "migration_safety"` | yes | covers the four Tier 1 classes the PRD names plus security and behavior_change. Names match PRD vocabulary verbatim — `regression_risk` not `quality`, `missing_verification` not `verification`, so search-replace from PRD lands here |
| `severity` | `"CRITICAL" \| "HIGH" \| "MEDIUM" \| "LOW" \| "INFO"` | yes | upper-case to match existing `Risk.Level` (`packages/ax-code/src/risk/score.ts`). `INFO` added for non-actionable observations |
| `confidence` | number 0–1 | optional | optional for **all** workflows. Emit when the producing tool has a meaningful confidence signal (debug_analyze does; deterministic lint findings typically don't). No asymmetry between review and debug |
| `summary` | string, ≤ 200 chars | yes | one-line headline |
| `file` | string (POSIX, repo-relative) | yes | |
| `anchor` | union: `{ kind: "line"; line: number; endLine?: number }` \| `{ kind: "symbol"; symbolId: string }` | yes | `line` is the default. `symbol` uses `CodeNodeID` from `src/code-intelligence/id.ts`. The "nearest stable anchor" idea from the original backlog is dropped from v1 — it has no algorithm spec and would require a fuzzy-match runtime |
| `rationale` | string | yes | why this is a finding; not the same as evidence |
| `evidence` | `string[]` | yes | each entry is a free-form evidence string (file:line ref, command output snippet, quote). `[]` is allowed but discouraged for severity ≥ MEDIUM. Typed back-references go in `evidenceRefs` instead |
| `evidenceRefs` | `{ kind: "verification" \| "log" \| "graph" \| "diff"; id: string }[]` | optional | typed back-references when a finding is anchored to another artifact (a `VerificationEnvelope`, a runtime log capture, a CodeIntelligence graph query, a diff hunk). Optional because most v1 review findings will have only string evidence |
| `suggestedNextAction` | string | yes | concrete next step the user can take. NOT a patch |
| `ruleId` | string | optional | format: `"<source>:<rule-name>"` where `source ∈ {"axcode", "policy", "user"}`. Examples: `axcode:bug-empty-catch`, `policy:require-changelog`. Required when produced by a Phase 4 policy rule; otherwise omitted |
| `source` | `{ tool: string, version: string, runId: string }` | yes | `tool` is the producing tool's identifier (e.g. `"review"`, `"debug_analyze"`). `runId` is the ax-code session ID (correlates with replay/share). `version` is the ax-code package version |

### Versioning policy

- `schemaVersion: 1` is locked for the entire v4.x.x assurance lane.
- New enum members (additional `category`, `severity`, `evidenceRefs.kind`) MUST be added to a registry file `packages/ax-code/src/quality/finding-registry.ts` whose contents are imported into the Zod enum at build time. PRs adding members must update the registry and the consumer that reads them. No silent additions.
- Field additions (new optional fields), field removals, or semantic changes require `schemaVersion: 2`. v1 and v2 emit in parallel for one v4.x release before v1 is dropped.
- Consumers (CI exports, GitHub integrations) MUST validate `schemaVersion` and refuse unknown values.

### Rendering contract

A finding renderer is a pure function:

```ts
type FindingRenderer = (findings: Finding[], opts?: { color?: boolean; group?: "file" | "severity" | "category" }) => string
```

- Pure: no IO, no global state. Same input → same output.
- Lives at `packages/ax-code/src/quality/finding-render.ts`.
- Two outputs ship in v4.x.x: `render.terminal()` (human-readable) and `render.json()` (`JSON.stringify(findings, null, 2)`). Both go through Zod-validated `Finding[]`. They are NOT separate code paths — `json()` is just `stringify`.
- Phase 1 must implement both. No third renderer (HTML, Markdown table, GitHub comment) ships in v4.x.x.

## Shared verification envelope v1

This extends `planner/verification`'s existing `VerificationResult` rather than replacing it. The envelope is the per-run record. Multi-run policies (escalation, retry) are workflow-level concerns described separately below.

### Schema

```ts
export interface VerificationEnvelope {
  schemaVersion: 1
  workflow: "review" | "debug" | "qa"
  scope: {
    kind: "file" | "package" | "workspace" | "custom"
    paths?: string[]                  // when kind is file/package
    description?: string              // when kind is custom
  }
  command: {
    runner: string                    // e.g. "tsc", "eslint", "bun test", "custom"
    argv: string[]                    // exact invocation
    cwd: string                       // workspace-relative
  }
  result: VerificationResult           // existing type from planner/verification
  structuredFailures: StructuredFailure[]
  artifactRefs: { kind: "finding" | "log" | "diff" | "snapshot"; id: string }[]
  source: { tool: string, version: string, runId: string }
}

type StructuredFailure =
  | { kind: "typecheck"; file: string; line: number; column?: number; code: string; message: string }
  | { kind: "lint"; file: string; line: number; rule: string; severity: "error" | "warning"; message: string }
  | { kind: "test"; testName: string; framework: string; file?: string; assertion?: string; stack?: string }
  | { kind: "custom"; message: string; details?: unknown }
```

### What this fixes

- `refactor_apply.checks` and `planner/verification.VerificationResult` collapse into one shape. Phase 2 picks the implementation: refactor_apply emits `VerificationEnvelope[]`, and the legacy `result.checks.{typecheck,lint,tests}` shape is re-derived only if an external consumer needs it.
- Consumers no longer reparse terminal output to detect failure types.
- Review and debug workflows attach a `VerificationEnvelope` via the `evidenceRefs` field on `Finding` (not a separate concept).

### Workflow-level escalation policy (not part of the envelope)

Scope escalation is a workflow concern, not a property of a single run. The envelope records the scope of *this* run; the workflow decides whether to widen scope on the *next* run.

The v4.x.x policy is documented at the workflow layer, not in the envelope schema:

- workflows enter at scope = `file` (changed files only)
- escalation to `package` or `workspace` is explicit: a CLI flag, a policy rule, or a repair-handoff loop fence
- a workflow that escalates emits one envelope per run; consumers correlate by `source.runId` + scope

This keeps the envelope a flat record and avoids consumers having to know workflow state machines.

## PR diff acquisition (decision)

**Decision:** v4.x.x review-on-PR requires the `gh` CLI. No fallback.

| Step | Command | When |
|---|---|---|
| 1 | `gh auth status` | workflow entry; if not authed, fail fast with a clear error pointing at `gh auth login` |
| 2 | `gh pr view <id>` | obtain PR metadata |
| 3 | `gh pr diff <id>` | obtain unified diff |

Rationale:

- matches what `packages/ax-code/src/command/template/review.txt` already documents
- matches Claude Code `/autofix-pr` and Cursor Bugbot conventions
- avoids embedding a GitHub API client (auth surface, rate-limit handling) inside ax-code
- a `--no-gh` flag with a `git fetch origin pull/N/head` fallback was considered and rejected for v1: two paths means two test surfaces and two error stories, and aider/Claude Code show the field has accepted a hard `gh` requirement. Add a fallback in v5.0.0 only if a real user blocks on it.

## Policy file conventions (Phase 4 contract sketch)

ax-code already has a project-namespaced config directory `.ax-code/` with established discovery walk-up logic (`packages/ax-code/src/config/paths.ts`). Phase 4 policy files live inside that namespace, not at the repo root.

| File | Scope | Loaded when | Precedence |
|---|---|---|---|
| `.ax-code/review.md` | review workflow only | review workflow invoked | workspace > project (walk-up) > user (`~/.ax-code/review.md`) |
| `.ax-code/qa.md` | qa workflow only | qa workflow invoked | workspace > project (walk-up) > user (`~/.ax-code/qa.md`) |
| `CLAUDE.md` / `AGENTS.md` | general (existing) | always | unchanged from current behavior |

Decisions:

- files live under the existing `.ax-code/` namespace — matches `paths.ts` precedent for `agents/`, `commands/`, `plugins/`, `ax-code.json`. Repo-root files like `AX_REVIEW.md` were considered and rejected: they pollute the project root and don't share precedence/discovery with the rest of ax-code's config
- review and qa policies are loaded **only** when the matching workflow is invoked, not into every prompt — Phase 4 P4.2 explicit
- v4.x.x is **declarative only**: rules can require checks, narrow finding categories, set severity floors, scope by glob, and reference rule IDs. No executable hooks; no shelling out from policy
- precedence walks up the directory tree exactly the way `ConfigPaths.directories` already does — no new walker, no parallel resolution path

## Mapping each workflow to existing primitives

### review

| Need | Existing primitive | Gap |
|---|---|---|
| four entry forms (no-arg, commit, branch, PR) | `command/template/review.txt` (prose) | machine-readable emitter |
| diff acquisition | `gh` CLI usage in template | wrapper that exposes a typed `Diff` object |
| Tier 1 finding categories | template prose | finding emission per `FindingSchema v1` |
| risk roll-up | `src/risk/score.ts` `Risk.Assessment` | wire findings into `Risk.signals` |
| session capture | session quality surfaces (existing) | route findings through `QualityShadow` capture path analogous to `captureDebugAnalyze` |

### debug

| Need | Existing primitive | Gap |
|---|---|---|
| static call-chain analysis | `tool/debug_analyze.ts` + `debug-engine/analyze-bug.ts` | fully covered |
| persistence | `QualityShadow.captureDebugAnalyze` | extend to emit a `Finding` with category `bug` and `confidence` from analyzeBug |
| runtime evidence capture | none | new — Phase 3 |
| temporary instrumentation | none | new — Phase 3 (must use `apply_patch` reversal contract for "easy to remove") |
| verify-after-fix | `planner/verification` + `refactor_apply` checks | wire into the envelope above |

### qa

| Need | Existing primitive | Gap |
|---|---|---|
| typecheck runner | `planner/verification.typecheck()` | already adequate; needs envelope wrapping |
| custom command runner | `planner/verification.custom()` | already adequate |
| lint runner | none in `planner/verification` | new (extract from `apply-safe-refactor` lint path or wrap user's `bun run lint`) |
| test runner | none in `planner/verification` (test runner exists inside `apply-safe-refactor`) | reconcile — Phase 2 |
| failure structuring | partial (typecheck has `parseTypeScriptErrors`) | new (lint, test) |
| repair handoff | partial (refactor_apply only) | new — Phase 2 |

## What to extend vs build new

| Surface | Action | File / location |
|---|---|---|
| Shared verification envelope | extend | new types alongside `packages/ax-code/src/planner/verification/index.ts` |
| Finding contract types | new | new file `packages/ax-code/src/quality/finding.ts` (Zod schemas; co-located with quality module) |
| Review entry shim | extend | wrapper around `command/template/review.txt` invocation that emits findings as JSON to a session artifact |
| `refactor_apply` checks | refactor | adopt `VerificationEnvelope`; preserve old shape via a derived view if any external consumer reads it |
| `debug_analyze` output | extend | additionally emit a `Finding` with `category: "bug"` and `confidence` from `result.confidence` |
| Runtime debug capture | new | new module `packages/ax-code/src/debug-engine/runtime-capture.ts`; reverse-via-apply_patch contract |
| Lint runner | new | new function `lint()` in `planner/verification/index.ts` matching `typecheck()` shape |
| Test runner (shared) | extract | extract from `debug-engine/apply-safe-refactor.ts` into `planner/verification/` |
| `.ax-code/review.md` and `.ax-code/qa.md` loaders | new | new file `packages/ax-code/src/quality/policy.ts`; reuses `ConfigPaths.directories` walk-up |
| PR diff acquisition wrapper | new | new file `packages/ax-code/src/quality/pr-diff.ts` (wraps `gh`; fails fast if `gh` is missing) |
| Finding renderer | new | new file `packages/ax-code/src/quality/finding-render.ts` (pure function, no IO) |

## Explicit non-goals for v4.x.x (reaffirmed and extended)

The original PRD defers the following to v5.0.0; this Phase 0 reaffirms and extends:

- always-on background QA automation
- specialized parallel reviewer fleet (Claude Code's `/ultrareview` / `/simplify` style)
- full managed PR review service
- learned rules from team activity (Cursor's "learned rules" feature)
- inline PR comment posting via the GitHub API — v4.x.x emits the artifact; a thin GitHub Action consumer is v5.0.0 candidate
- streaming JSON output for live-tail consumers — v4.x.x emits one artifact per run
- nearest-stable-anchor finding placement — `Finding.anchor` is `line | symbol` only in v1; nearest-anchor needs a fuzzy-match algorithm spec we are not writing now
- `--no-gh` PR diff fallback — gh is required in v4.x.x; revisit only on real user demand
- third-party renderers (HTML, Markdown table, GitHub comment formatter) — v1 ships terminal + JSON only

## Go / No-Go for Phase 0

Phase 0 is complete when **all** are true:

- [ ] this document is reviewed and approved
- [ ] the implementation backlog's Phase 1–4 ownership rows are corrected to use the verified file paths above (specifically: remove `src/worktree/**`, replace with `src/debug-engine/**`; correct `src/planner/**` references that meant `src/debug-engine/plan-refactor.ts`)
- [ ] Zod schemas for `Finding v1` and `VerificationEnvelope v1` exist in `packages/ax-code/src/quality/finding.ts` and alongside `planner/verification` respectively (types-only PR; no consumers yet)
- [ ] one fixture test under `packages/ax-code/test/quality/finding.test.ts` exercises the `Finding v1` Zod schema
- [ ] the `gh` decision is captured in the backlog's Phase 1 entry-contract row

Phase 0 is **not** complete if any of:

- the schema is published without a versioning policy
- ownership rows still cite non-existent paths
- review/debug/qa workflow names are not reserved as canonical
- the divergence between `refactor_apply.checks` and `VerificationResult` is left unresolved at the contract level (the implementation reconciliation is Phase 2; the contract decision is Phase 0)

## Appendix A: Zod schema sketches

These are sketches for reviewer alignment, not final code. Final code lands in Phase 0 closeout under `packages/ax-code/src/quality/finding.ts` and as a typed extension alongside `packages/ax-code/src/planner/verification/index.ts`.

```ts
// packages/ax-code/src/quality/finding.ts (sketch)
import { z } from "zod"
import { Severity, Category, EvidenceRefKind } from "./finding-registry"

export const SeverityEnum = z.enum(Severity)         // ["CRITICAL","HIGH","MEDIUM","LOW","INFO"]
export const CategoryEnum = z.enum(Category)         // see finding-registry.ts
export const WorkflowEnum = z.enum(["review", "debug", "qa"])

export const FindingAnchor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("line"), line: z.number().int().min(1), endLine: z.number().int().min(1).optional() }),
  z.object({ kind: z.literal("symbol"), symbolId: z.string() }),
])

export const EvidenceRef = z.object({
  kind: z.enum(EvidenceRefKind),                     // ["verification","log","graph","diff"]
  id: z.string(),
})

export const Finding = z.object({
  schemaVersion: z.literal(1),
  findingId: z.string().regex(/^[0-9a-f]{16}$/),
  workflow: WorkflowEnum,
  category: CategoryEnum,
  severity: SeverityEnum,
  confidence: z.number().min(0).max(1).optional(),
  summary: z.string().max(200),
  file: z.string(),
  anchor: FindingAnchor,
  rationale: z.string(),
  evidence: z.array(z.string()),
  evidenceRefs: z.array(EvidenceRef).optional(),
  suggestedNextAction: z.string(),
  ruleId: z.string().regex(/^(axcode|policy|user):[a-z0-9-]+$/).optional(),
  source: z.object({ tool: z.string(), version: z.string(), runId: z.string() }),
})

export type Finding = z.infer<typeof Finding>

// Deterministic finding ID — for dedup across runs.
// Hash inputs are stable across renames only when anchor.kind === "symbol".
export function computeFindingId(input: {
  workflow: Finding["workflow"]
  category: Finding["category"]
  file: string
  anchor: Finding["anchor"]
  ruleId?: string
}): string {
  const anchorRef = input.anchor.kind === "line" ? `line:${input.anchor.line}` : `symbol:${input.anchor.symbolId}`
  const payload = [input.workflow, input.category, input.file, anchorRef, input.ruleId ?? ""].join("\u0000")
  // implementation uses Bun.hash or crypto.subtle.digest("SHA-256", ...).slice(0,16)
  return /* sha256(payload).hex.slice(0,16) */ "" // sketch
}
```

```ts
// packages/ax-code/src/quality/finding-registry.ts (sketch)
// Single source of truth for enum members. Adding a member requires updating the
// matching consumer; PR review enforces this by requiring both files in the diff.

export const Severity = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const
export const Category = [
  "bug",
  "security",
  "regression_risk",
  "behavior_change",
  "missing_verification",
  "migration_safety",
] as const
export const EvidenceRefKind = ["verification", "log", "graph", "diff"] as const
```

```ts
// extension of packages/ax-code/src/planner/verification/index.ts (sketch)
import { z } from "zod"

export const StructuredFailure = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("typecheck"), file: z.string(), line: z.number(), column: z.number().optional(), code: z.string(), message: z.string() }),
  z.object({ kind: z.literal("lint"), file: z.string(), line: z.number(), rule: z.string(), severity: z.enum(["error", "warning"]), message: z.string() }),
  z.object({ kind: z.literal("test"), testName: z.string(), framework: z.string(), file: z.string().optional(), assertion: z.string().optional(), stack: z.string().optional() }),
  z.object({ kind: z.literal("custom"), message: z.string(), details: z.unknown().optional() }),
])

export const VerificationEnvelope = z.object({
  schemaVersion: z.literal(1),
  workflow: z.enum(["review", "debug", "qa"]),
  scope: z.object({
    kind: z.enum(["file", "package", "workspace", "custom"]),
    paths: z.array(z.string()).optional(),
    description: z.string().optional(),
  }),
  command: z.object({
    runner: z.string(),
    argv: z.array(z.string()),
    cwd: z.string(),
  }),
  // result reuses the existing VerificationResult interface from planner/verification
  structuredFailures: z.array(StructuredFailure),
  artifactRefs: z.array(z.object({ kind: z.enum(["finding", "log", "diff", "snapshot"]), id: z.string() })),
  source: z.object({ tool: z.string(), version: z.string(), runId: z.string() }),
})
```

### Renderer sketch

```ts
// packages/ax-code/src/quality/finding-render.ts (sketch)
import type { Finding } from "./finding"

export function terminal(findings: Finding[], opts: { color?: boolean; group?: "file" | "severity" | "category" } = {}): string {
  // pure: sort, group, format. No IO, no global state.
  // Severity glyph: CRITICAL ✗, HIGH ✗, MEDIUM ⚠, LOW ·, INFO ·
  // ...
  return ""
}

export function json(findings: Finding[]): string {
  return JSON.stringify(findings, null, 2)
}
```

## Appendix B: Citations

- Claude Code commands reference — https://code.claude.com/docs/en/commands
- Claude Code skills (hooks, agent, paths) — https://code.claude.com/docs/en/slash-commands
- Cursor Bugbot — https://cursor.com/docs/bugbot
- aider lint and test loop — https://aider.chat/docs/usage/lint-test.html
- aider in-chat commands — https://aider.chat/docs/usage/commands.html
- Gemini CLI commands reference — https://geminicli.com/docs/reference/commands
- Gemini CLI repository (PR review action, GEMINI.md) — https://github.com/google-gemini/gemini-cli

## Sidebar and dashboard rework — deferred to post-Phase-1

A separate question was raised during Phase 0 review: should the TUI sidebar (specifically its **Analysis** / **Quality** sections — the latter rendering review/debug/qa cards via `packages/ax-code/src/cli/cmd/tui/routes/session/quality.ts`) and the DRE web dashboard (`packages/ax-code/src/server/routes/dre-graph.ts`) be reworked in the same wave?

A short recon (sidebar.tsx, dialog-dre.tsx, dialog-dre-graph.tsx, quality.ts, dre-graph.ts route, home.tsx) confirmed both surfaces exist, are functional, and are non-trivial in size. An initial proposal listed seven Tier 0/1/2 changes (rename "Analysis" → "DRE", cut the ASCII execution graph, cut the `/dre-graph/` index, add empty states for Quality/Analysis, registry-ify quality gates, default the dashboard's `?quality=true` to true, and surface Finding counts in Quality cards).

After self-critique, **all of those proposals are deferred to post-Phase-1**.

### Why defer

- The Quality sidebar cards currently consume readiness-gate data only. Phase 1 lands the real `Finding` data source. Judging the cards as "noisy" or "low-value" before that data exists is judging on half the signal.
- "Analysis" is a friendlier user-facing label than "DRE"; the apparent inconsistency between the label and the internal `/dre-dashboard` slash command is the same pattern as `/git status` rendering as "Version control" — internal jargon for power users, friendly label for the rest. Not a real defect.
- Cuts (ASCII graph, `/dre-graph/` index page) lack usage data. URLs and muscle memory are unidirectional; reverting a cut is more expensive than reverting an addition.
- Silent absence of the Quality section when data is missing may be a deliberate noise-reduction choice, not a bug. Adding empty-state placeholders without confirming intent could regress the design.
- A second registry (`quality-gates-registry.ts` mirroring `finding-registry.ts`) is premature — gates may not survive Phase 1 as a separate concept once `VerificationEnvelope` lands.
- `?quality=true` may be opt-in because computing it is expensive; flipping the default without measuring the cost is a behavior change.

### Re-evaluation trigger

The deferred items become judgeable **after both** of these are true:

1. Phase 1 review workflow has landed and is emitting `Finding` records into the session (per the contract above).
2. At least one full release cycle (≈1–2 sprints) has produced real findings users have looked at, so the Quality sidebar cards have shown non-empty `Finding` counts in actual use.

Until then, the appropriate work on these surfaces is **none**. Surface rework without the new data source in place would be optimizing a render path against absent inputs.

### Deferred item ledger

| Item | Status | Re-evaluation gate |
|---|---|---|
| Rename sidebar label "Analysis" → "DRE" | rejected (DRE is internal jargon) | not re-evaluating; the existing label is correct |
| Cut DRE dialog ASCII execution graph | deferred | Phase 1 + usage log instrumentation |
| Cut web dashboard `/dre-graph/` index page | deferred | Phase 1 + measured zero traffic over 30 days |
| Add empty-state placeholders for Quality / Analysis | deferred | confirm with user whether silent absence is intended |
| `quality-gates-registry.ts` (mirror of finding-registry) | deferred | Phase 1; revisit only if gates remain a separate concept after `VerificationEnvelope` lands |
| Default `?quality=true` on `/dre-graph/session/{id}` | deferred | Phase 1 + measured cost of always-computing quality |
| Wire `Finding` counts into the Quality sidebar review/debug/qa cards | **DONE 2026-04-26** (commit `99a0a08`) | renders as "Review · 2 HIGH · 1 MED" via `renderSessionQualitySidebarLine`, finding counts override quality readiness gate text when present |

### Phase 1 status (2026-04-26)

Phase 1 is functionally complete end-to-end. The shipped pipeline:

`/review` → model calls `register_finding` per finding → `Session.recorder` records `tool.result` with `metadata.finding` → `SessionFindings.load(sessionID)` rebuilds `Finding[]` from session events on demand → `/session/:id/risk?findings=true` exposes them over HTTP → client sync schema parses → sidebar Quality cards render `"Review · 2 HIGH · 1 MED"` via `countByWorkflow` + `renderSessionQualitySidebarLine`.

Backlog mapping:
- P1.1 entry contract (uncommitted/commit/branch/PR via `gh`) — done in `command/template/review.txt` + register_finding tool
- P1.2 stable artifact (Zod-validated, deterministic findingId) — done in `quality/finding.ts` + `register_finding.ts`
- P1.3 terminal + JSON renderer — `renderTerminal` and `renderJson` shipped (`quality/finding-render.ts`); CLI export slash command not shipped (a `/findings-export` is plausible polish, not blocking)
- P1.4 narrow Tier 1 — guidance lives in `command/template/review.txt`; no fixture test (review.txt is prose, hard to test directly)
- P1.5 sidebar wiring — done

Phase 1 commits: `cc55386` (schema bedrock), `e55427e` (sidebar Quality lines), `6eeedd5` (register_finding tool), `a7263a8` (SessionFindings + risk route), `99a0a08` (sidebar wiring end-to-end).

### Pointer for the next agent

Phase 1 sidebar polish is **done**. Future revisits of the sidebar / Quality section should:

1. Not re-design the Quality line shape — it now renders `"Review · 2 HIGH · 1 MED"` when findings exist and falls back to gate text when they don't. This is the user-facing contract.
2. The verbose internal-vocab format remains in `renderSessionQualityInlineSummary` for the `/quality` dialog only.
3. If Phase 2 lands `VerificationEnvelope` consumers, surface them as a separate sidebar element (probably a "Checks" section adjacent to "Quality") rather than overloading the Quality cards.

## Phase 4 P4.4: future hook design (deferred to v5.0.0)

Phase 4 P4.4 in the backlog says "document a future hook design for review/debug/qa workflows, but keep the v4.x.x implementation to declarative policy only unless an existing hook can be safely reused." This section is the deferred design.

### Why hooks were not shipped in v4.x.x

Declarative rules (P4.3, shipped in `.ax-code/review.rules.json` and `.ax-code/qa.rules.json`) cover the dominant policy use cases — required categories, severity floors, prohibited categories, scope globs. Hooks are a strictly more powerful but strictly more dangerous mechanism: they execute user-provided code on every workflow event. We deferred them because:

- v4.x.x has no observed user request for executable policy logic.
- A safe hook execution model (sandboxing, error isolation, async fan-out, ordering guarantees) is multi-week work.
- Declarative rules + the existing `.ax-code/agents/` and `.ax-code/commands/` mechanisms cover the imaginable v1 use cases.

Adding hooks now would expand the trust boundary without a real consumer driving the design.

### Shape sketch (for v5.0.0 planning, not implementation)

If hooks land in v5.0.0, they should:

1. Live under `.ax-code/hooks/<workflow>/<event>.ts` (or `.js` / `.mjs`) — same namespace conventions as the rest of `.ax-code/`.
2. Match a single typed event signature per file. Event names are versioned: `review.finding.before-emit.v1`, `review.run.after-complete.v1`, `qa.envelope.after-emit.v1`, etc.
3. Receive a typed input (immutable copy of the event payload) and return either:
   - `{ continue: true }` — proceed unchanged
   - `{ continue: true, mutated: <payload> }` — proceed with a modified payload (must validate against the same schema as the original)
   - `{ continue: false, reason: string }` — stop the workflow with a recorded reason (e.g. "blocked by policy: missing changelog entry")
4. Run inside a `Bun.spawn` subprocess with a hard CPU/wall-clock timeout (default 5 s). Crashes, timeouts, and non-zero exits are treated as `{ continue: true }` with a warning (fail-open) — hooks must not be able to brick a workflow.
5. Be discovered via `ConfigPaths.directories` walk (same precedence as policy files: workspace > project > user). Hooks at multiple levels run nearest-first; any `{ continue: false }` short-circuits.
6. Emit a `hook.executed` event into the session log with input/output/duration so users can inspect what their hooks did.

### Things hooks must NOT do in v5.0.0

- Read/write files outside `.ax-code/`.
- Make network calls.
- Block on user input (hooks are non-interactive).
- Replace declarative rules — declarative remains the default, hooks are an escape hatch.

### Status

- v4.x.x: **declarative rules only** (P4.3 shipped). No hook runtime, no hook discovery, no `.ax-code/hooks/` namespace.
- v5.0.0: candidate scope per the sketch above. Reconsider if and only if real user demand surfaces specific hook use cases that declarative rules cannot express.

## Final note

This document does not change the v4.x.x scope or the v5.0.0 deferrals. It corrects three defects in the original Phase 0 and applies a discipline pass:

1. the artifact-unification framing is replaced with a net-new schema design (the named artifacts do not exist)
2. file-ownership paths are corrected (no `src/worktree/`, `src/debug-engine/` is the real home)
3. the divergence between `refactor_apply.checks` and `planner/verification.VerificationResult` is named as a Phase 2 reconciliation task

The discipline pass trimmed the v1 schema in seven concrete ways:

- `evidence` is `string[]`, not a six-kind discriminated union (typed back-references moved to optional `evidenceRefs`)
- `anchor` is `line | symbol`, not three kinds (nearest-anchor dropped — no algorithm spec)
- `severity` matches the existing repo convention (`Risk.Level` upper-case), not external industry lower-case
- `category` names match PRD vocabulary verbatim (`regression_risk`, `missing_verification`)
- `confidence` is optional everywhere — no asymmetry between debug and review
- `escalation` moved out of `VerificationEnvelope` into a workflow-level note
- `findingId`, `ruleId`, `runId` semantics are spelled out, not implied
- enum membership lives in a registry file with required-co-edit discipline
- policy files live under the existing `.ax-code/` namespace, not a new `AX_*.md` repo-root convention
- PR diff acquisition is gh-only with no `--no-gh` fallback in v1

Phase 1 implementation may begin once this document is approved, the implementation backlog's ownership rows are corrected, and the Zod schema files exist as types-only modules.
