# ADR-045: Keep `ax-code run` Structured Output at the CLI Boundary

## Status

Accepted

## Date

2026-07-01

## Deciders

ax-code maintainers

## Related

- `PRD-2026-07-01-run-structured-output.md`
- `TECH-SPEC-2026-07-01-run-structured-output.md`
- `packages/ax-code/src/cli/cmd/run.ts`

## Context

`ax-code run` is the main noninteractive local automation entry point. It already supports:

- default formatted terminal output;
- `--format json` raw JSON event lines;
- resume/fork behavior;
- file attachments;
- local server bootstrap and attach mode.

The missing high-value workflow is a stable final-output artifact for scripts. Raw event streams are useful for rich clients, but CI pipelines usually need one final answer file and a deterministic failure when the answer does not match a machine-readable contract.

There are three possible implementation locations:

1. Provider-native structured output in the LLM request.
2. Session/server schema changes that persist a structured result.
3. CLI-boundary validation of the final assistant message.

The first two are more powerful but also touch provider transforms, session persistence, SDK contracts, OpenAPI snapshots, and replay semantics. This feature should land as a narrow, low-risk automation improvement first.

## Decision

For the first slice, AX Code will implement structured output at the `ax-code run` CLI boundary:

- `--output-file` / `-o` writes the final assistant message to a file.
- `--output-last-message` is accepted as a compatibility alias for users familiar with Codex-style wording.
- `--output-schema` reads a JSON Schema file and validates the final assistant message after the run completes.
- Validation is strict: the final assistant text must parse as JSON; prose-wrapped JSON is rejected.
- The existing `--format json` stream remains a raw event stream and is not reshaped.

The helper code is separated from `run.ts` so it can be unit-tested without a live model.

## Consequences

### Positive

- CI users get an immediately useful final artifact.
- Schema failure can fail a job without writing custom parser code.
- No server, SDK, migration, or OpenAPI churn is required.
- Existing raw event consumers keep working.

### Negative / Costs

- The model is not forced by provider-native structured-output APIs yet, so users must prompt for JSON.
- JSON Schema coverage is intentionally practical, not a full draft implementation.
- Validation happens after the model response is produced; it does not guide model decoding in this slice.

## Alternatives Considered

### Provider-native structured output first

Deferred. It is the right long-term quality improvement, but it requires model/provider capability detection and request-shape differences. That is too broad for the first CLI automation slice.

### Persist structured results in session state

Deferred. Useful later for Desktop/SDK automation history, but not required for shell scripts that only need the final artifact.

### Add a full JSON Schema dependency

Rejected for this slice. The repo already has enough dependency weight, and a focused validator can cover the supported contract. If user schemas outgrow this subset, adding a direct dependency can be revisited with clear evidence.

### Make `--format json` print only the final message

Rejected. Existing users may rely on JSONL progress events. A separate final-output flag avoids breaking event-stream consumers.

## Acceptance Criteria

- `ax-code run --output-file out.txt "..."` writes the final assistant message.
- `ax-code run --output-last-message out.txt "..."` writes the same artifact.
- `ax-code run --output-schema schema.json "..."` exits non-zero when the final message is missing, invalid JSON, or schema-invalid.
- Relative output paths resolve from the original caller directory.
- Tests cover schema success/failure helpers, parse failures, file writing, and CLI option wiring.
