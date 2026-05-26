---
name: improve-overall
description: Reduce duplication and dead code, improve module and component boundary clarity, and remove overengineering. Conservative by default - prefers small safe moves over sweeping rewrites.
argument-hint: [file or directory to focus on]
---

Review and improve the code in $ARGUMENTS. If no argument is given, focus on files changed in the current branch (`git diff --name-only main`).

## Focus areas (in priority order)

### 1. Dead code

Remove unexported symbols with no callers, unreachable branches, and unused imports. Confirm a symbol is unused with a grep before deleting it.

### 2. Duplication

Find near-identical logic appearing in multiple places. Extract a shared helper **only if** the extraction is simpler than the duplication - three similar lines with no planned variation is fine as-is.

### 3. Module boundary leakage

Identify code that is in the wrong layer:
- Domain logic (session, provider, tool, permission, etc.) inside `src/cli/` or `src/server/` -> move to the correct domain folder.
- Storage access outside `src/storage/` -> route through the storage layer.
- Cross-domain direct imports where an interface boundary should exist.

Make the minimal interface change needed to move the code without changing behaviour.

### 4. Overengineering

Simplify:
- Abstractions with a single call site - inline them.
- Configuration flags for hypothetical future behaviour with no current use.
- Premature generalization where a concrete implementation would be shorter and clearer.

### 5. File size (propose only, do not auto-execute)

If a file is over 500 lines and has natural split points, describe how it could be divided and ask before proceeding.

## Rules

- No changes to public API signatures, exported types, or observable behaviour.
- Skip anything that touches more than 3 call sites without a clear mechanical transformation.
- High-risk actions (renaming exports, reshaping interfaces, moving files referenced by CI) must be described and confirmed before execution.
- Follow ax-code architecture rules: no Effect outside `src/effect/`, `src/session/`, `src/file/watcher.ts`; Zod for new validation; `async/await` for async; `Log.create` for structured logging.
- Run `bun run typecheck` after changes to confirm no type errors.
