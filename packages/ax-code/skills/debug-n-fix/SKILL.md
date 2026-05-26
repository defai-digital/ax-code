---
name: debug-n-fix
description: Diagnose a bug and implement the fix. Confirms root cause before making changes, then verifies with the relevant tests.
argument-hint: <symptom, error message, or failing test>
---

Diagnose and fix the issue described in $ARGUMENTS.

## Phase 1 - Diagnose

Follow the same investigation steps as `debug-only`:

1. **Reproduce**: trace the symptom to a minimal entry path.
2. **Root cause**: confirm the exact file, line, and condition. State the root cause explicitly before moving to Phase 2.

Do not start writing code until the root cause is confirmed.

## Phase 2 - Fix

3. Implement the minimal change that directly addresses the root cause.
4. Do not refactor surrounding code, rename variables, or change behaviour beyond what the fix requires.
5. Do not add error handling for unrelated cases, new tests for pre-existing behaviour, or comments that describe what the code does.

## Phase 3 - Verify

6. Run the relevant test file: `bun test test/path/to/file.test.ts` from `packages/ax-code/`.
   - If no specific test file covers the fix, run `bun run test:unit`.
   - Do not run the full suite unless the fix touches a cross-cutting concern.
7. If tests fail after the fix, diagnose and resolve before reporting done.
8. Check that no related path regresses by reading the test output carefully.

## Constraints

- Fix only what the root cause requires - one bug, one fix.
- If the root cause reveals a design problem that needs more than a targeted fix, stop and describe the larger issue rather than attempting a partial rewrite.
- Follow ax-code architecture rules: no Effect outside `src/effect/`, `src/session/`, `src/file/watcher.ts`; Zod for validation; `async/await` for async; `Log.create` for structured logging.
