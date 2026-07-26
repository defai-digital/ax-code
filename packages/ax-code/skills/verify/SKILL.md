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
- If browser tools are available (AX_CODE_EXPERIMENTAL_BROWSER_AGENT), prefer them for UI verification.
- Otherwise, use curl/httpie for API endpoints or the project's test runner for logic changes.

## Phase 3 - Exercise

- Trigger the changed code path with representative inputs.
- For UI changes: navigate to the page, interact with the component, take a screenshot.
- For API changes: send requests with valid and edge-case payloads.
- For CLI changes: run the command with typical and boundary arguments.
- Capture observed output (screenshots, response bodies, logs).

## Phase 4 - Report

Produce a structured verdict:

**Status**: PASS or FAIL

**What was tested**: the specific actions taken.

**Expected vs Observed**: for each test point, what should happen vs what did happen.

**Evidence**: screenshots, response snippets, or log excerpts.

**Issues found**: if FAIL, describe each issue with reproduction steps.

## Constraints

- Do not fix issues found — report them only.
- Do not modify source code.
- Clean up any background processes started during verification.
- If the change cannot be exercised at runtime (e.g. pure type-level change), say so and verify via typecheck + tests instead.
