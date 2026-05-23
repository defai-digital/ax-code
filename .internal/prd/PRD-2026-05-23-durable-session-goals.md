# PRD: Durable Session Goals

**Date:** 2026-05-23
**Status:** Phase 0 implemented
**Author:** ax-code agent
**Related:** `.internal/adr/ADR-014-durable-session-goals.md`, `.internal/prd/PRD-2026-05-23-autonomous-continuation-contract-hardening.md`

---

## Executive Summary

`/goal` should give `ax-code` a durable, inspectable objective for long-running work. The correct implementation is not a slash-command prompt alias. It is session state plus model-visible tools plus runtime continuation rules that keep the task alive until it is complete, blocked, paused, cleared, or budget-limited.

The first implementation slice should be small and enforce the core contract:

- A goal is persisted per session.
- `/goal` can view, set, pause, resume, and clear that state.
- The model can read the current goal and mark it complete or blocked through tools.
- The session loop injects active goal context and schedules bounded continuations after ordinary model stops.

## Problem Statement

`ax-code` already has autonomous continuation for pending todos, step limits, and completion-gate retries. That machinery helps a single run continue, but it does not give the user a durable task contract. A normal prompt can still finish with useful progress while leaving a larger objective unfinished, and a resumed or compacted session has no first-class state that says what the long-running task is trying to achieve.

Without a durable goal layer, users must rely on repeated prompts like "please continue", manual todos, or long context history. Those are weaker than a goal contract because they are not independently inspectable, cannot be paused or cleared, and cannot distinguish "turn ended" from "objective achieved".

## Goals

- Add first-class session goal persistence.
- Add `/goal` command behavior:
  - `/goal` shows the current goal.
  - `/goal <objective>` creates an active goal and starts work.
  - `/goal pause`, `/goal resume`, and `/goal clear` control lifecycle.
- Add model tools:
  - `get_goal`
  - `create_goal`
  - `update_goal`
- Inject active goal state into the system prompt.
- Continue automatically after a model stop while an active goal remains incomplete, bounded by existing continuation limits and optional token budget.
- Track token usage against the goal from assistant message usage.
- Add focused tests for goal storage, tool contract, and command behavior.

## Non-Goals

- Do not build a full TUI goal dashboard in this phase.
- Do not change autonomous mode defaults.
- Do not remove or replace todo-based continuation.
- Do not let the model pause, resume, clear, budget-limit, or usage-limit a goal.
- Do not make goals span multiple root sessions in this phase.
- Do not implement background daemon execution independent of the current session loop.

## Best-Practice Review

Durable goals should follow these rules:

- **State beats prompt memory.** Store the objective and lifecycle outside the transcript so compaction and resumptions retain the contract.
- **User/system own lifecycle controls.** The model can declare complete or blocked, but pause, resume, clear, and budget-limit are runtime/user decisions.
- **Completion must be explicit.** The loop should not treat a normal assistant stop as goal completion unless the goal state says complete.
- **Budgets should stop new work.** When a token budget is exhausted, mark the goal `budget_limited` and ask for a wrap-up instead of starting more substantive work.
- **Continuations must be bounded.** Use existing continuation caps for Phase 0; add richer long-horizon scheduling only after the state contract is stable.
- **Goal context is untrusted user data.** Inject it as task context, not as higher-priority instructions.

## Implementation Plan

### Phase 0: Runtime Contract MVP

Status: Complete on 2026-05-23.

Files:

- `packages/ax-code/src/session/goal.ts`
- `packages/ax-code/src/session/session.sql.ts`
- `packages/ax-code/src/storage/schema.ts`
- `packages/ax-code/migration/20260523000000_session_goal/migration.sql`
- `packages/ax-code/src/tool/goal.ts`
- `packages/ax-code/src/tool/registry.ts`
- `packages/ax-code/src/command/index.ts`
- `packages/ax-code/src/session/prompt.ts`
- `packages/ax-code/src/session/prompt-helpers.ts`
- `packages/ax-code/src/session/prompt-autonomous-continuations.ts`
- focused tests under `packages/ax-code/test/session/` and `packages/ax-code/test/tool/`

Tasks:

1. Add a `session_goal` table keyed by `session_id`.
2. Implement `SessionGoal` read/create/update/pause/resume/clear/addUsage helpers.
3. Register `get_goal`, `create_goal`, and `update_goal` tools.
4. Add `/goal` to the command list and handle it as a built-in control command.
5. Inject active/paused/budget-limited goal context into each system prompt.
6. Add goal continuation after normal model stops when the goal is still active.
7. Mark a goal `budget_limited` when usage reaches its token budget.

Validation:

- Passed: `cd packages/ax-code && bun test test/session/goal.test.ts`
- Passed: `cd packages/ax-code && bun test test/tool/goal.test.ts`
- Passed: `cd packages/ax-code && bun run typecheck`
- Passed: `bun run script/structure.ts`

### Phase 1: UI and Resume Polish

Open follow-up:

- Show active goal status in the session header/footer.
- Add a dedicated goal dialog or command-palette entry.
- Add sync state for live goal updates if needed by TUI surfaces.
- Add resume-specific UX for paused or blocked goals.

## Acceptance Criteria

- A goal survives ordinary session message processing and can be queried from storage.
- `/goal <objective>` persists a goal and starts work.
- `/goal pause`, `/goal resume`, `/goal clear`, and bare `/goal` return deterministic status messages without invoking the model.
- `get_goal` returns structured goal state.
- `create_goal` refuses to infer or replace an existing active goal.
- `update_goal` only accepts `complete` or `blocked`.
- A normal assistant stop with an active goal schedules a bounded continuation.
- Budget exhaustion marks the goal `budget_limited` and prevents further goal continuation.

## Progress Log

- 2026-05-23: PRD created after reviewing OpenAI Codex `/goal` docs/source behavior and current `ax-code` autonomous continuation architecture.
- 2026-05-23: Phase 0 implemented. Added persisted session goals, `/goal` command handling, goal model tools, system prompt context, bounded goal continuation, token budget accounting, and focused tests.
