---
name: debug-n-fix
description: Diagnose and repair a reported bug, error, or failing test using reproduction evidence and checks of the original symptom. Use when a fix is requested.
agent: debug
argument-hint: <symptom, error message, or failing test>
---

Diagnose and fix the issue described in $ARGUMENTS.

## Phase 1 - Diagnose

1. **Reproduce**: trace the symptom to a minimal entry path.
2. **Bug reality gate**: capture the concrete failure signal before diagnosing: command/action, input, observed output/error, and expected behavior.
3. **Root cause**: confirm the exact file, line, and condition. State the root cause explicitly before moving to Phase 2.

For UI symptoms (misrendering, dead controls, blank pages, console errors, failed requests): when a read-capable WebMCP bridge is connected, capture the T1 evidence triad on the authorized page — a11y snapshot, console errors, and failed-request metadata — as the concrete failure signal before static reading. Use a screenshot as additional evidence for visual symptoms; it does not replace the structured snapshot. Never replay an action whose completion is uncertain just to gather evidence; read current state instead. If a read grant is denied, fall back to static tracing and record the missing evidence.

For a reproducible localhost UI bug whose failure can be expressed as a structured assertion, prefer `browser_workflow` when available: freeze the scenario with a failing assertion control, fix, then run the same hash twice. Existing approvals apply unchanged.

Build a small repeatable feedback loop that fails on the reported symptom and
can pass after the fix: a focused test, CLI fixture, request replay, or bounded
runtime probe. Record the input, environment, expected behavior, and actual
failure. A generic successful build is not a reproduction check.

Use `repo_wiki` for module responsibilities and `code_intelligence` or `lsp` for exact
symbols/callers when available; confirm the relevant source and index freshness.
Empty or partial results do not prove absence. Trace values across the failing
boundary and check existing guards. For ambiguous causes, record each candidate's
prediction and test the cheapest observation that can rule it out, one variable
at a time. Revise contradicted hypotheses rather than accumulating patches.

When available, use `debug_open_case`, `debug_capture_evidence`, and
`debug_propose_hypothesis` to keep observations separate from explanations.
Use `debug_analyze` for stack traces; its confidence and unresolved frames are
not proof. Otherwise use focused read/search/bash checks.

Do not start writing code until the root cause is confirmed. If the bug cannot be reproduced or evidenced, stop and report the attempted reproduction path, unconfirmed hypotheses, and the evidence needed next.

Use this classification before editing:

- **Confirmed bug**: a command, test, user action, log, stack trace, or runtime probe demonstrates the failure, and the observed behavior violates a stated expectation.
- **Confirmed by existing failing test**: a targeted test already fails before the fix, and the failing assertion/output matches the reported symptom.
- **Unconfirmed hypothesis**: static reading, call-chain analysis, or intuition suggests a cause, but no observed failure signal proves it.
- **Not reproduced**: the attempted reproduction path does not fail.

Do not fix an unconfirmed hypothesis unless the user explicitly asks for a speculative hardening change. A passing test after the fix is not proof that the original bug was real unless the original failure was captured first.

## Phase 2 - Fix

4. Implement the minimal change that directly addresses the confirmed root cause.
5. Prefer a regression test that fails before the fix and passes after it when the behavior can be tested locally.
6. Do not refactor surrounding code, rename variables, or change behaviour beyond what the fix requires.
7. Do not add error handling for unrelated cases, new tests for pre-existing behaviour, or comments that describe what the code does.

## Phase 3 - Verify

8. Run the most specific relevant test or verification command for the current repository.
   - Prefer a single focused test file or package-local command when one covers the fix.
   - If no focused test exists, run the smallest broader check that gives meaningful coverage.
   - Do not run a full suite unless the fix touches a cross-cutting concern or repository instructions require it.
9. Verify the original failure path no longer fails. This is separate from general regression tests.
10. If tests fail after the fix, diagnose and resolve before reporting done.
11. Check that no related path regresses by reading the test output carefully.
12. In the final report, include the pre-fix failure evidence and post-fix verification command/output summary.

Prefer existing debugger or replay support when it answers the question without
source edits. If temporary probes are necessary, record their purpose and removal
path with `debug_plan_instrumentation` when available, capture the observations,
then remove only your probes and mark the plan `removed` before final verification.
Cleanup changes source bytes: rerun checks on the final files.

When available, run `verify_project` with `workflow: "debug"`, include the symptom
check in `commands.test` when the inferred command does not cover it, and pass a
returned envelope id to `debug_apply_verification` for the hypothesis. Apply the
whole verification set; report skipped, stale, failed, or inconclusive checks
explicitly. Do not claim resolution from an unrelated passing check.

## Constraints

- Fix only what the root cause requires - one bug, one fix.
- If the root cause reveals a design problem that needs more than a targeted fix, stop and describe the larger issue rather than attempting a partial rewrite.
- Follow the current repository's instructions from AGENTS.md or equivalent local guidance.
