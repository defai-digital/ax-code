# Implementation Plan: `ax-code run` Structured Output

**Date:** 2026-07-01
**Status:** Complete
**Related:** `PRD-2026-07-01-run-structured-output.md`, `ADR-045-run-structured-output-boundary.md`, `TECH-SPEC-2026-07-01-run-structured-output.md`

## Objective

Close the highest-value automation gap from the Codex CLI comparison by making `ax-code run` produce a durable final answer artifact and optionally validate it as JSON before downstream CI steps consume it.

## Scope

Implement the first CLI-boundary slice only:

- `--output-file` / `-o` writes the final assistant message.
- `--output-last-message` is a compatibility alias.
- `--output-schema` validates strict JSON output against a practical JSON Schema subset.
- Existing stdout and `--format json` event streams remain compatible.

## Execution Steps

1. Document the product, architecture, and technical contract in `ax-internal`.
2. Add a focused `run-output.ts` helper for path resolution, schema loading, JSON parsing, validation, and file writing.
3. Wire new flags into `run.ts` without changing server, SDK, or session persistence contracts.
4. Capture the latest completed assistant text part as a streaming fallback candidate.
5. After session idle, read the stored final assistant text for the assistant message ID observed during this run.
6. Validate schema before writing the output artifact.
7. Add helper unit tests for paths, alias conflicts, JSON parsing, schema success/failure, and write ordering.
8. Add command wiring coverage so future edits do not silently drop the CLI flags or post-loop handler.
9. Run focused Vitest coverage and package typecheck.

## Validation

Completed checks:

```text
pnpm --dir packages/ax-code exec vitest run test/cli/run-output.test.ts test/cli/run-lifecycle.test.ts
pnpm --dir packages/ax-code run typecheck
```

Both checks pass.

## Follow-Up Candidates

- Provider-native structured output for supported models.
- GitHub Action outputs that consume `--output-file`.
- Persisted structured-result metadata for Desktop and SDK consumers.
- Full JSON Schema draft dependency if real-world schemas exceed the supported subset.
