---
name: simplify
description: Review changed code for reuse, quality, and efficiency, then fix any issues found.
agent: build
argument-hint: <optional focus area or file path>
---

Review the code changed in this session (or the files specified in $ARGUMENTS) and improve it.

## Phase 1 - Identify Changes

- Run `git diff --name-only HEAD` to find modified files. If $ARGUMENTS specifies files, use those instead.
- If no changes exist, report that there is nothing to review and stop.

## Phase 2 - Analyze

For each changed file, evaluate:

1. **Reuse**: Is there existing code in the codebase that does the same thing? Search for similar patterns with grep/glob before concluding something is novel.
2. **Quality**: Are there code smells — deep nesting, long functions, unclear names, dead code, missing error handling at boundaries?
3. **Efficiency**: Are there obvious performance issues — N+1 queries, unnecessary allocations, redundant computations in loops?

Do NOT flag:

- Style preferences that don't affect correctness or readability
- Missing abstractions for hypothetical future needs
- Comments or documentation style

## Phase 3 - Fix

- Apply fixes directly using edit/write tools.
- Each fix must be a concrete improvement, not a lateral move.
- Do not refactor beyond what the analysis found — no speculative restructuring.
- Preserve existing behavior exactly.

## Phase 4 - Verify

- Run the project's typecheck (`pnpm run typecheck` or equivalent) to confirm no regressions.
- If tests exist for the changed files, run them.
- Report what was changed and why.

## Constraints

- Do not add features or new abstractions.
- Do not modify files that were not identified in Phase 1.
- Follow the repository's existing conventions (check AGENTS.md).
