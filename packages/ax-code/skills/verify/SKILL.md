---
name: verify
description: Verify that a code change actually does what it's supposed to by running the app and observing behavior.
agent: build
argument-hint: <what to verify, e.g. "the login fix" or "PR #123">
---

Verify that the change described in $ARGUMENTS works correctly by exercising it at runtime.

## Phase 1 - Understand the Change

- Identify what was changed: `git diff HEAD~1 --stat` or the specific files/PR referenced.
- Determine the expected behavior: read the changed code, commit messages, or PR description.
- Identify the entry point: how does a user or test trigger this code path?

## Phase 2 - Set Up

- Ensure dependencies are installed and the project builds.
- If a dev server is needed, start it in the background.
- For UI verification, use the available WebMCP skill and the actual bridge tool schemas. Discover deferred tools with `tool_search` when available. T0 page tools, T1 observations and T2 interactions differ; a connection alone does not provide every capability.
- "UI-facing" means the expected behavior must be observed in a browser render or interaction. API, CLI, and type-level changes follow their original paths; when no bridge is connected, HTTP/build/test evidence can still constitute a PASS on its own.
- Otherwise, use curl/httpie for API endpoints or the project's test runner for logic changes.

## Phase 3 - Exercise

- Trigger the changed code path with representative inputs.
- For UI changes: establish the expected outcome on the authorized page, then use an applicable page tool or admitted UI interaction. Verify with semantic snapshots, or screenshots for visual questions when model vision is available. Missing interaction tools may leave the requested behavior unverified.
- When a read-capable bridge is connected and the change is UI-facing, do not derive PASS from HTTP status, build success, or a screenshot alone — a structured observation (snapshot or page-tool result) is required. For purely visual changes (CSS, layout), pair a snapshot for page identity and structure with a screenshot for the visual claim.
- Record an evidence table for each UI action: the action, pre/post snapshot identity, console error delta, failed-request metadata delta, and origin. A pre-action entry may be `N/A` on first navigation — never fabricate an identity. A tool acknowledgement is not a PASS.
- If a capability required to exercise the requested UI behavior is denied or blocked by managed policy, report BLOCKED and name it; do not retry or work around it. A disconnected or non-read-capable bridge alone does not invalidate an otherwise sufficient non-browser verification path.
- If the localhost behavior is expressible as a structured assertion and a read-capable bridge is connected, the frozen `browser_workflow` scenario (failing control before the edit, the same hash run twice after) is the default verification path for that UI change. When the frozen path was considered but any condition failed — not localhost-reproducible, not assertion-expressible, or no read-capable bridge — name the failed condition and the evidence used instead. Layout, canvas, and purely visual claims stay on snapshot plus screenshot.
- For API changes: send requests with valid and edge-case payloads.
- For CLI changes: run the command with typical and boundary arguments.
- Capture observed output (screenshots, response bodies, logs).

## Phase 4 - Report

Produce a structured verdict:

**Status**: PASS (expected outcome observed), FAIL (observed mismatch), or BLOCKED (required capability, authority or evidence unavailable).

**What was tested**: the specific actions taken.

**Expected vs Observed**: for each test point, what should happen vs what did happen.

**Evidence**: snapshots, screenshots, response snippets, or log excerpts. State what each proves; HTTP reachability alone does not verify UI rendering or interaction.

**Issues found**: if FAIL, describe each issue with reproduction steps. If BLOCKED, state what remains unverified. An observed broken UI is FAIL, not unavailable verification.

## Constraints

- Do not fix issues found — report them only.
- Do not modify source code.
- Clean up any background processes started during verification.
- If the change cannot be exercised at runtime (e.g. pure type-level change), say so and verify via typecheck + tests instead.
