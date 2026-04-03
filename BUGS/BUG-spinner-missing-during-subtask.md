# BUG: Spinner/progress bar disappears during subtask execution

**Date:** 2026-04-03
**Severity:** Medium
**Status:** Fixed

## Symptoms

- When the agent launches a subtask (Task tool), the spinner and "esc interrupt" text disappear
- The prompt area shows idle state (`tab agents  ctrl+p commands`) even though the agent is actively working
- The subtask timer (`Debug · glm-5 · 15.1s`) is visible but the progress bar is not
- Users think the system has hanged

## Root Cause

The subtask execution path at `prompt.ts:359` did not re-assert `SessionStatus.set(sessionID, { type: "busy" })` before starting the long-running subtask. The status was set to "busy" at the top of the loop (line 278), but after the first LLM step completed and the loop re-entered, the subtask block didn't maintain the busy state.

## Fix

Added `SessionStatus.set(sessionID, { type: "busy" })` at the start of the subtask execution block.

## Files Changed

- `packages/ax-code/src/session/prompt.ts:359`
