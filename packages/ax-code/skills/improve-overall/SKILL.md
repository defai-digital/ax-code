---
name: improve-overall
description: Reduce duplication and dead code, improve module and component boundary clarity, and remove overengineering. Conservative by default - prefers small safe moves over sweeping rewrites.
argument-hint: "[file or directory to focus on]"
---

Review and improve the code in $ARGUMENTS. If no argument is given, start from files changed in the current branch (`git diff --name-only main`) and narrow the working set before editing.

## Scope selection

- List the candidate files first and exclude generated files, snapshots, lockfiles, vendored files, build outputs, and unrelated docs.
- Prefer source and test files that are directly connected to the requested improvement.
- If the changed-file set crosses multiple packages or mixes unrelated domains, pick one coherent slice and report the rest as follow-up candidates.
- Do not use this skill for speculative broad cleanup. Every edit should have a local reason: removes proven dead code, reduces real duplication, clarifies a boundary, or removes an abstraction that is actively making the code harder to follow.

## Focus areas (in priority order)

### 1. Dead code

Remove unexported symbols with no callers, unreachable branches, and unused imports.

Before deleting a symbol:

- Use `rg` to search for direct references.
- Check barrel exports, registries, CLI command maps, tool registration, config names, route tables, test fixtures, and dynamic lookups.
- If a symbol may be reached dynamically, leave it in place unless typecheck/tests or repository conventions prove it is unused.

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
- Follow the current repository's instructions from AGENTS.md or equivalent local guidance.

## Verification

- Run the most specific relevant tests for the touched behavior.
- Run the repository's local typecheck or equivalent static validation when the change touches typed code.
- Run broader workspace validation when the change crosses package, workspace, or shared library boundaries.
- If no focused test exists, say that explicitly and explain why typecheck/static inspection is the available verification.
- Read verification output carefully; do not report success if a relevant check failed, timed out, or was skipped.
