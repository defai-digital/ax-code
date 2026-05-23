# PRD: Autonomous Continuation Contract Hardening

**Date:** 2026-05-23
**Status:** Complete - Phase 2 empty-model-turn decision extraction complete
**Author:** ax-code agent
**Related:** `.internal/adr/ADR-012-autonomous-continuation-contracts.md`, `.internal/architecture/autonomous-mode-review-2026-05.md`

---

## Executive Summary

Autonomous mode has the right core safety behavior, but several high-value contracts still live as inline logic inside `packages/ax-code/src/session/prompt.ts`. The next meaningful improvement is not a large rewrite. It is to make continuation prompts and agent-preservation behavior explicit, testable contracts while preserving current terminal semantics.

## Problem Statement

The prompt loop currently owns both orchestration and prompt construction for every autonomous continuation path. That makes future changes risky because a prompt wording edit can accidentally touch:

- retry counter mutation,
- cache invalidation,
- session message creation,
- completion-gate diagnostics,
- terminal reason mapping,
- specialist-agent routing preservation.

Past autonomous regressions show the important failure modes are semantic, not just structural:

- Pending todos or blocked subagent evidence must not be reported as true completion.
- Synthetic continuation prompts must not auto-route to a different specialist agent because todo wording contains routing keywords.
- Empty model turns must stop with a diagnostic after retry exhaustion.

## Goals

- Extract autonomous continuation prompt text into named builder functions.
- Preserve current session-loop side effects and terminal reasons.
- Add focused tests for prompt builders.
- Add or strengthen a flow test proving synthetic continuation keeps the current agent even when the continuation text contains routing keywords.
- Update internal PRD/ADR indexes so the new planning documents are discoverable.

## Non-Goals

- Do not extract the full autonomous decision tree in this phase.
- Do not change `SafetyPolicy` enforcement behavior in this phase.
- Do not change completion-gate rules.
- Do not change retry budgets, caps, or config defaults.
- Do not change user-facing prompt text beyond moving it behind builders.

## Implementation Plan

### Phase 1: Prompt Builder Boundary

Status: Complete on 2026-05-23.

Files:

- Add `packages/ax-code/src/session/prompt-autonomous-continuations.ts`.
- Update `packages/ax-code/src/session/prompt.ts`.
- Add `packages/ax-code/test/session/prompt-autonomous-continuations.test.ts`.
- Update `packages/ax-code/test/session/prompt-flow.test.ts`.
- Add this PRD and ADR-012 to `.internal/prd/INDEX.md` and `.internal/adr/INDEX.md`.

Tasks:

- Move continuation prompt strings into builder functions:
  - global step-limit continuation,
  - agent step-limit continuation,
  - empty model turn recovery,
  - completion-gate retry,
  - large-context report todo convergence,
  - deadline convergence,
  - pending-todo continuation.
- Keep `createAutonomousUserContinuation()` as the single creation path for synthetic continuation messages.
- Add tests for key prompt fragments and dynamic todo formatting.
- Strengthen flow coverage so report-style continuation text keeps the `build` agent instead of routing to `debug`.

Validation:

- Passed: `cd packages/ax-code && bun test test/session/prompt-autonomous-continuations.test.ts`
- Passed: `cd packages/ax-code && bun test test/session/prompt-flow.test.ts`
- Passed: `cd packages/ax-code && bun run typecheck`

### Phase 2: Empty Model Turn Decision Boundary

Status: Complete on 2026-05-23.

Files:

- Add `packages/ax-code/src/session/prompt-autonomous-decisions.ts`.
- Add `packages/ax-code/test/session/prompt-autonomous-decisions.test.ts`.
- Update `packages/ax-code/src/session/prompt.ts`.

Tasks:

- Move the empty-model-turn `ignore` / `recover` / `stop` state transition into a pure helper.
- Preserve the prompt loop as the owner of logging, assistant error publication, synthetic continuation creation, and `break` / `continue`.
- Keep recover/stop counter mutation inside the autonomous branch so non-autonomous behavior does not change.
- Preserve the diagnostic message that says empty model turn stops are not task completion.

Validation:

- Passed: `cd packages/ax-code && bun test test/session/prompt-autonomous-decisions.test.ts`
- Passed: `cd packages/ax-code && bun test test/session/prompt-flow.test.ts`
- Passed: `cd packages/ax-code && bun run typecheck`

## Acceptance Criteria

- `prompt.ts` no longer contains the long autonomous continuation prompt template literals inline.
- The prompt builder tests cover every exported builder.
- The session-flow test proves synthetic autonomous continuations preserve the current agent across keyword-heavy todo text.
- Existing autonomous completion, retry, and safety-stop behavior is unchanged.

## Progress Log

- 2026-05-23: PRD created after review of `.internal/architecture/autonomous-mode-review-2026-05.md`. Phase 1 selected as the safest meaningful implementation slice.
- 2026-05-23: Phase 1 implemented. Continuation prompt strings moved into `prompt-autonomous-continuations.ts`; prompt-loop side effects and terminal semantics stayed in `prompt.ts`; targeted builder tests and prompt-flow preservation tests pass.
- 2026-05-23: Phase 2 implemented. Empty-model-turn retry/stop state transition moved into `prompt-autonomous-decisions.ts`; prompt-loop side effects remained local; targeted decision tests and prompt-flow tests pass.
