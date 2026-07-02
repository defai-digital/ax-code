# Tech Spec: `ax-code run` Structured Output

**Date:** 2026-07-01
**Status:** Implemented
**Related:** `PRD-2026-07-01-run-structured-output.md`, `ADR-045-run-structured-output-boundary.md`

---

## Summary

Add CI-ready final output support to `ax-code run` without changing the session runtime:

- write the final assistant message to a file;
- validate final JSON against a JSON Schema file;
- keep raw JSON event streaming backward-compatible.

## CLI Contract

New flags:

```text
--output-file, -o <path>
  Write the final assistant message to <path>.

--output-last-message <path>
  Compatibility alias for --output-file.

--output-schema <path>
  Validate the final assistant message as JSON against the schema file.
```

Rules:

- `--output-file` and `--output-last-message` are mutually exclusive unless they point at the same path.
- Output paths are resolved against `Filesystem.callerCwd()`.
- Schema paths are resolved against `Filesystem.callerCwd()`.
- The output file is written after the event loop observes the target session returning to idle.
- Schema validation runs before writing the output file, so invalid structured output does not update the artifact.
- If there is no final assistant text, schema validation and output writing fail.

## Implementation Files

```text
packages/ax-code/src/cli/cmd/run.ts
  add flags
  collect final assistant text
  call helper after loop

packages/ax-code/src/cli/cmd/run-output.ts
  path resolution
  output file writer
  schema file loader
  strict final-message JSON parser
  practical JSON Schema validator

packages/ax-code/test/cli/run-output.test.ts
  unit tests for helper behavior

packages/ax-code/test/cli/run-lifecycle.test.ts
  source-level assertions for CLI option wiring
```

## Final Message Collection

`run.ts` already receives `message.part.updated` events. For each completed `text` part from the active session, capture the trimmed text as a streaming fallback candidate.

When the session returns to `idle`, read the stored session messages and select the last non-empty text part from the assistant message ID observed during this run. This mirrors the programmatic SDK strategy and avoids writing stream echoes, transient text edits, or stale assistant output from an earlier resumed session to the artifact. If reading stored messages fails, fall back to the latest streaming candidate so output handling still works in attach/server edge cases.

## JSON Schema Subset

The first implementation supports:

- boolean schemas;
- `type` as string or array;
- `enum`;
- `const`;
- object `required`, `properties`, `additionalProperties`, `minProperties`, `maxProperties`;
- array `items`, `minItems`, `maxItems`;
- string `minLength`, `maxLength`, `pattern`;
- number/integer `minimum`, `maximum`;
- `allOf`, `anyOf`, `oneOf`, `not`.

Unsupported keywords are ignored. This keeps the validator predictable and dependency-free while covering common CI schemas.

## Failure Behavior

Failure messages:

- missing final message: `No final assistant message was produced`
- invalid JSON: `Final assistant message is not valid JSON: ...`
- invalid schema file: `Failed to parse output schema ...`
- schema mismatch: `Output schema validation failed: ...`
- output write failure: surfaced with the filesystem error message

All failures set `process.exitCode = 1` and are printed through the existing UI error path.

## Tests

Unit tests:

- parses and validates a successful object schema.
- rejects missing required fields.
- rejects additional properties when `additionalProperties: false`.
- rejects invalid JSON final text.
- writes final output and creates parent directories.
- resolves paths from caller cwd.

Source-level CLI test:

- verifies the three flags are registered.
- verifies `handleRunStructuredOutput` is called after `loopPromise`.

## Future Work

- Provider-native structured output for models that support it.
- Persist structured output metadata in session state.
- GitHub Action output wiring.
- Full JSON Schema draft support if real user schemas need it.
