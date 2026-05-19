# PRD: Prompt Auto-Continuation Boundary Hardening

**Date:** 2026-05-18
**Status:** Complete - Phase 1 prompt todo continuation boundary complete
**Author:** ax-code agent

---

## Executive Summary

`packages/ax-code/src/session/prompt.ts` remains the largest and most fragile runtime hotspot. It mixes provider execution, tool resolution, permission handling, compaction, autonomous completion gates, todo auto-continuation, message creation, and shell/command entry points in one namespace.

This PRD narrows the next maintainability fix to one low-risk slice: extract the autonomous todo auto-continuation decision from the prompt loop into a pure helper in `prompt-todo-continuation.ts`.

## Problem Statement

The prompt loop currently mutates retry counters, compares pending todo signatures, chooses stop-vs-continue behavior, and builds stagnation state inline. This makes the loop harder to reason about because side effects, logging, continuation text, and policy decisions are interleaved.

The fragile area is not a package-boundary violation; it is a local state-machine boundary problem:

- The same loop owns completion gate retries, context convergence, deadline convergence, normal todo continuation, provider fallback, compaction, and error budgets.
- Todo continuation state is spread across `todoRetries`, `lastPendingTodoSignature`, and `stagnantTodoRetries`.
- Existing tests cover low-level todo formatting helpers, but not the stop/continue decision for model-finished pending todos.

## Goals

- Move normal model-finished pending-todo continuation decision into a pure helper.
- Keep all storage, logging, message creation, and session-loop side effects in `prompt.ts`.
- Preserve behavior for step-limit stop, retry-budget stop, stagnant retry accounting, and continuation attempts.
- Add focused tests for the decision helper.
- Keep the implementation small enough to review independently.

## Non-Goals

- Do not rewrite the prompt loop.
- Do not change provider fallback behavior.
- Do not change completion gate behavior.
- Do not change context-convergence or deadline-convergence reminders in this slice.
- Do not change todo text formatting or user-facing continuation copy except through existing values.

## Implementation Plan

### Phase 1: Extract Pending Todo Continuation Decision

Status: Complete on 2026-05-18.

Files:

- Update `packages/ax-code/src/session/prompt-todo-continuation.ts`.
- Update `packages/ax-code/src/session/prompt.ts`.
- Update `packages/ax-code/test/session/prompt-todo-continuation.test.ts`.

Tasks:

- Completed: added a pure `pendingTodoContinuationDecision()` helper.
- Completed: returns one of `stop_step_limit`, `stop_retry_budget`, or `continue`.
- Completed: returns the next `lastPendingTodoSignature`, `stagnantTodoRetries`, and `todoRetries` values for the loop to persist.
- Completed: kept message text, logging, and `createAutonomousUserContinuation()` in `prompt.ts`.
- Completed: added tests for step limit, retry budget, signature change, signature stagnation, and attempt incrementing.

Validation:

- Passed: `cd packages/ax-code && bun test test/session/prompt-todo-continuation.test.ts`
- Passed: `cd packages/ax-code && bun test test/session/prompt-helpers.test.ts`
- Passed: `cd packages/ax-code && bun run typecheck`
- Passed: `bun run script/structure.ts`

## Acceptance Criteria

- `prompt.ts` no longer owns the core normal pending-todo continuation decision inline.
- The helper is pure and has no dependency on `Session`, `Todo`, `Locale`, logging, or storage.
- Existing continuation behavior remains unchanged.
- Targeted tests and package typecheck pass.

## Progress Log

- 2026-05-18: PRD created. Phase 1 selected as a narrow fix for the largest runtime hotspot without expanding the scope into a prompt-loop rewrite.
- 2026-05-18: Phase 1 implemented. Normal pending-todo auto-continuation state transitions now live behind `pendingTodoContinuationDecision()`; the prompt loop keeps the side effects and user-facing continuation text. Focused tests, package typecheck, and structure guard pass.
