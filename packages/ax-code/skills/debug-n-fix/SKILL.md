---
name: debug-n-fix
description: Diagnose a bug and implement the fix. Confirms root cause before making changes, then verifies with the relevant tests.
argument-hint: <symptom, error message, or failing test>
---

Diagnose and fix the issue described in $ARGUMENTS.

## Phase 1 - Diagnose

Follow the same investigation steps as `debug-only`:

1. **Reproduce**: trace the symptom to a minimal entry path.
2. **Bug reality gate**: capture the concrete failure signal before diagnosing: command/action, input, observed output/error, and expected behavior.
3. **Root cause**: confirm the exact file, line, and condition. State the root cause explicitly before moving to Phase 2.

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

8. Run the relevant test file: `bun test test/path/to/file.test.ts` from `packages/ax-code/`.
   - If no specific test file covers the fix, run `bun run test:unit`.
   - Do not run the full suite unless the fix touches a cross-cutting concern.
9. Verify the original failure path no longer fails. This is separate from general regression tests.
10. If tests fail after the fix, diagnose and resolve before reporting done.
11. Check that no related path regresses by reading the test output carefully.
12. In the final report, include the pre-fix failure evidence and post-fix verification command/output summary.

## Constraints

- Fix only what the root cause requires - one bug, one fix.
- If the root cause reveals a design problem that needs more than a targeted fix, stop and describe the larger issue rather than attempting a partial rewrite.
- Follow ax-code architecture rules: do not introduce Effect or Effect Schema; use Zod for validation; use `async/await` for async; use `Log.create` for structured logging.
