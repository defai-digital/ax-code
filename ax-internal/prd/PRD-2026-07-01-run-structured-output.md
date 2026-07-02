# PRD: Structured Output for `ax-code run`

**Date:** 2026-07-01
**Status:** Implemented
**Scope:** Internal
**Owner:** ax-code maintainers
**Related:** `ADR-045-run-structured-output-boundary.md`, `TECH-SPEC-2026-07-01-run-structured-output.md`
**Archive criteria:** `ax-code run` supports a CI-ready final-message output file and JSON Schema validation contract, with tests covering the CLI helper behavior and the command wiring.

---

## Purpose

Make `ax-code run` easier to consume from CI jobs, bots, release scripts, and internal automation by giving callers a stable final-output contract.

The existing `--format json` mode streams raw runtime events. That is useful for diagnostics and custom clients, but most scripts need one durable final answer that can be written to a file and optionally validated as JSON before downstream steps consume it.

## Problem

Automation users currently have to parse terminal text or raw event streams to find the final assistant answer. That creates brittle scripts:

- Terminal formatting and tool progress can mix with answer text in default output.
- Raw JSON events are lower-level than CI scripts usually want.
- There is no built-in way to assert that the final answer is machine-readable JSON with required fields.
- GitHub Actions and shell pipelines cannot reliably fail early when the agent returns prose where structured data was expected.

Codex CLI has made structured noninteractive output a high-value workflow. AX Code should close the highest-impact part of that gap without changing the headless server protocol.

## Goals

1. Add an `ax-code run` flag that writes the final assistant message to a caller-selected file.
2. Add an `ax-code run` flag that validates the final assistant message against a JSON Schema file.
3. Keep existing `--format json` event output backward-compatible.
4. Fail the process with a clear error when the final answer is missing, not valid JSON, or schema-invalid.
5. Keep the implementation local to CLI output handling for this slice.

## Non-Goals

- Do not add a new server route or session schema field.
- Do not change existing `--format json` event line shapes.
- Do not introduce a new runtime dependency just for schema validation.
- Do not implement ephemeral sessions in this slice.
- Do not redesign the GitHub Action in this slice.
- Do not require models to use provider-native structured output yet.

## Users

### CI workflow author

Wants `ax-code run` to produce a JSON file that later steps can inspect with `jq`, upload as an artifact, or use to decide whether to fail a job.

### Release automation maintainer

Wants a stable final report file with required fields such as `summary`, `risk`, and `checks`.

### Bot/integration developer

Wants raw event streaming for progress, but also wants a final answer artifact without reconstructing the final text from events.

## Product Requirements

### R1: Final message output file

`ax-code run` must accept a file path flag that writes the final assistant message after the run reaches idle.

Required behavior:

- Create parent directories as needed.
- Write exactly the final assistant text, without terminal formatting.
- Preserve the existing stdout behavior.
- Resolve relative output paths from the caller's original working directory, not from a remote `--dir` value.

### R2: Output schema validation

`ax-code run` must accept a JSON Schema file path. When provided:

- The final assistant message must be valid JSON.
- The parsed JSON must satisfy the schema.
- Validation failure sets a non-zero exit code and prints a concise diagnostic.
- Validation success must not alter stdout unless the caller also requested default output.

### R3: JSON event compatibility

Existing `--format json` output must remain a JSON Lines event stream. New final-output features may add optional events, but must not rename or reshape existing event types.

### R4: Testable helper boundary

Schema parsing, final-message extraction helpers, and output-file writing should live outside the main CLI handler so tests can cover behavior without spawning a real LLM run.

## Success Criteria

- A script can run `ax-code run --output-file report.md "summarize this repo"` and read `report.md`.
- A script can run `ax-code run --output-schema schema.json --output-file report.json "emit JSON"` and fail if the agent returns invalid JSON.
- Existing tests for `run --format json`, file attachment, and lifecycle source checks remain valid.
- The implementation does not require a dependency install.

## Risks

### Model returns prose around JSON

Mitigation: keep the first implementation strict. The user can instruct the model to return JSON only. Provider-native structured output can be a later improvement.

### JSON Schema support is incomplete

Mitigation: support the practical subset used in CI contracts: object, array, primitive types, required properties, additional properties, enum/const, composition, and common length/range constraints. Document unsupported keywords as a future extension.

### Output file path surprises with `--dir`

Mitigation: resolve output artifacts from the caller working directory, because output artifacts are local CLI artifacts, not project input files.

## Follow-Ups

- Add provider-native structured-output prompting when the selected model supports it.
- Add `--ephemeral` session behavior for non-persistent automation runs.
- Extend the GitHub Action with `prompt-file`, `output-file`, `codex-args`-style extra flags, and safer defaults.
- Publish a short automation guide with schema examples.
