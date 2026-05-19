# PRD: Debug Fix Closed Loop v1

## Status

Implemented initial low-risk slice.

## Implementation Notes

- `debug_analyze` now emits a conservative citation-gated hypothesis draft when a resolved frame exists.
- `refactor_apply` now accepts documented `commands` overrides in its public tool schema and forwards them to the safe-refactor pipeline.
- Prompt guidance now distinguishes enabled DRE tools from absent DRE-only tools.
- `debug_repair_from_envelope` can now turn an existing failed VerificationEnvelope into a bounded repair brief without editing files or spawning repair work.
- Guardrail tests cover the hypothesis draft contract, rendered tool output, prompt wording, command override schema, and bounded repair-brief generation from existing envelopes.

## Last Reviewed

2026-05-16

## Owner

AX Code

## Problem

AX Code has strong building blocks for bug finding and fixing: debug cases, evidence, hypotheses, verification envelopes, repair handoff briefs, code intelligence, and shadow-worktree refactor application. The current workflow still has three practical gaps:

- The debug prompt can describe DRE tools as mandatory even when the experimental DRE tool group is not enabled.
- `refactor_apply` documents command overrides, but the public tool schema does not accept or forward them.
- `debug_analyze` returns a real call chain but leaves `rootCauseHypothesis` and `fixSuggestion` empty, so agents must manually bridge from location evidence to a falsifiable hypothesis.

These gaps make the system less reliable as a closed-loop bug-fixing assistant.

## Goals

- Keep the first slice small, reversible, and compatible with existing debug-session artifacts.
- Align tool descriptions with actual runtime tool availability.
- Make safe apply command overrides available through the public `refactor_apply` tool.
- Add a deterministic, citation-gated hypothesis draft to `debug_analyze` without introducing an LLM dependency inside DRE.

## Non-Goals

- Do not implement autonomous multi-step repair execution in this slice.
- Do not make DRE scanners language-semantic for Rust, Python, Ruby, or Go.
- Do not bypass existing permission, verification, or shadow-worktree gates.
- Do not change the persisted debug artifact schemas.

## Design

### 1. Tool Availability Honesty

The system prompt should report whether the experimental DRE tool group is enabled. Static prompt text should instruct agents to use DRE tools only when they are present in the active tool list.

### 2. Safe Apply Command Overrides

`refactor_apply` should accept the documented command overrides:

- `commands.typecheck`
- `commands.lint`
- `commands.test`

Each field follows the existing verification convention:

- omitted: infer default
- `null`: skip that check when the safe-apply policy allows it
- string: run exactly that command

### 3. Citation-Gated Hypothesis Draft

`debug_analyze` should create a deterministic hypothesis draft only from frames that already exist in the returned chain. The draft must pass the existing citation validator before surfacing.

The draft is intentionally conservative:

- It cites existing frame indexes only.
- It does not claim certainty.
- It provides a focused next-step fix direction, not an automatic patch.

## Acceptance Criteria

- Prompt context no longer claims DRE tools are available when the DRE gate is off.
- `refactor_apply` accepts and forwards `commands` to the safe-refactor pipeline.
- `debug_analyze` returns a non-null `rootCauseHypothesis` when at least one resolved frame is available.
- `debug_analyze` keeps `rootCauseHypothesis` null when no cited frame survives validation.
- No existing verification envelope, finding, or debug artifact schema changes are required.

## Follow-Up Opportunities

- Add `debug_repair_from_envelope` as an opt-in bounded repair loop over one structured verification envelope.
- Add TS/JS import-edge ingestion so impact analysis and test selection can rely on file dependency edges.
- Add language-native scanners for high-signal Rust bug patterns.
- Add parsers for Vitest/Jest, pytest, ruff, mypy, and Go test output.
