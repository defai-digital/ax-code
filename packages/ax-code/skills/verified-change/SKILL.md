---
name: verified-change
description: Implement a code change only after capturing a failing signal, then re-run the smallest relevant check. Use when shipping a bugfix, API change, or backend behavior change that must be proven, not just edited.
agent: build
argument-hint: <what to change and how to prove it>
---

Implement the change described in $ARGUMENTS and treat "done" as observed proof, not a diff.

## Phase 1 - Bound the change

- Identify the service/module, the user-visible behavior, and the smallest command that can fail today (unit test, integration test, curl, CLI).
- Prefer the repository's existing test runner. Detect it from the repo (package.json scripts, cargo, go test, pytest, mvn/gradle) — do not assume Node.
- If no automated check exists, state that explicitly and define a reproducible manual probe (command + expected output).

## Phase 2 - Capture the before signal

- Run the targeted check or probe **before** editing. Record command, input, observed result, expected result.
- Classification:
  - **Confirmed failure**: the check fails in the way the request describes.
  - **Missing coverage**: no check exists; write the smallest failing test or probe first when the behavior is testable.
  - **Already passing**: stop and ask — do not "fix" a green path unless the user wants a refactor.
- Do not start the production edit until the before-signal is captured.

## Phase 3 - Minimal edit

- Change only what the request requires.
- Do not refactor neighbors, rename for taste, or add unrelated error handling.

## Phase 4 - After signal

- Re-run the **same** command as Phase 2. It must now pass.
- If you added a test, that test must have failed before the edit.
- If the change can affect callers, run the next-smallest suite (package-local tests). Do not hide behind "I did not run tests."
- In the final report include: before command/output, files changed, after command/output. If a check was skipped, say why.

## Constraints

- A passing test that was not shown failing first is not proof of the original bug.
- Do not claim verification from typecheck alone when runtime tests exist.
- Do not apply migrations, deploy, or mutate production state.
