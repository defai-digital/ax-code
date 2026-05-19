# PRD: Token Efficiency and Context Budgeting

**Date:** 2026-05-16
**Status:** Draft; Phase 1-4 initial slices implemented
**Scope:** Internal
**Owner:** AX Code runtime
**Related:** `packages/ax-code/src/session/compaction.ts`, `packages/ax-code/src/session/index.ts`, `packages/ax-code/src/session/processor.ts`, `packages/ax-code/src/session/message-v2.ts`, `packages/ax-code/src/provider/cli/cli-language-model.ts`, `packages/ax-code/src/provider/cli/prompt.ts`

This is an internal planning artifact under `.internal/`, which is gitignored by default. Force-add only when the maintainer explicitly wants this PRD versioned.

## Implementation Notes

- Phase 1 initial slice implemented conservative token totals, reasoning-aware compaction budget totals, and estimated AI SDK v3 usage for CLI providers.
- Phase 2 initial slice implemented prompt-size preflight for normal prompt-loop provider calls. Clearly over-budget requests schedule automatic compaction before the normal provider call, while synthetic continuation messages created by compaction skip immediate preflight to avoid recursive compaction loops.
- Phase 3 initial slice implemented sent-payload-aware tool pruning estimates and bounded title-generation context for large first-turn messages.
- Phase 4 initial slice implemented usage-source classification (`exact`, `estimated`, `missing`), structured usage normalization logs, compaction trigger-reason logs, and non-content observability tests.
- No PRD phases remain open after the initial implementation slices. Future work should be tracked as tuning follow-ups rather than unfinished scope in this PRD.

## Purpose

Improve AX Code's token efficiency and context-window reliability without changing the core session architecture.

The first implementation slice should fix known accounting blind spots that can prevent automatic compaction from running. Follow-up slices should reduce avoidable token spend from large tool results, title generation, and predictable context overflow retries.

## Problem

AX Code already has several useful token-management mechanisms:

- provider usage is normalized into `Assistant.tokens`;
- automatic compaction fires near the model context or input limit;
- tool-result pruning clears older completed tool outputs;
- OpenRouter usage reporting is explicitly requested;
- Alibaba-backed providers use a lower output cap to reduce short-window token reservation pressure.

The current implementation still has practical blind spots:

1. CLI providers return empty usage, so `claude-code`, `gemini-cli`, and `codex-cli` sessions do not feed real token counts into compaction.
2. Reasoning tokens can be excluded from overflow accounting when a provider omits `totalTokens`.
3. Prompt size is not preflighted before sending the request, so predictable overflows still spend one provider call before compaction begins.
4. Tool-result pruning estimates only the tool output string, while model messages also include tool input, JSON wrapping, and sometimes attachments.
5. Title generation can resend a large first-turn context to a small model.

These gaps make long sessions less reliable and can waste tokens on preventable oversized requests.

## Goals

- Make token accounting conservative and useful even when exact provider usage is unavailable.
- Ensure automatic compaction works for CLI-backed providers.
- Count reasoning tokens in overflow decisions.
- Add a low-cost prompt-size preflight before expensive provider calls.
- Improve tool-result pruning so it better matches what is actually sent to the model.
- Bound title-generation context to avoid duplicating large first-turn payloads.
- Keep all changes compatible with existing session records and provider integrations.

## Non-Goals

- Do not replace provider-reported usage when it is available and trustworthy.
- Do not introduce a heavyweight tokenizer dependency in the first slice.
- Do not change persisted message or part schemas unless a later phase proves it is necessary.
- Do not change public SDK usage fields in this PRD.
- Do not redesign compaction prompts or summary quality.
- Do not make token estimates visible as exact billing data.

## Success Metrics

- CLI provider sessions have non-zero estimated input/output usage for non-empty prompts and responses.
- Automatic compaction can trigger for CLI provider sessions before repeated oversized calls.
- Reasoning-heavy responses cannot avoid overflow checks solely because `totalTokens` is missing.
- A large prompt that is clearly over the usable model budget schedules compaction before the provider request.
- Existing API-provider token accounting tests remain green.
- New tests cover the fallback/estimated paths distinctly from exact provider usage.

## User Stories

### Long-running CLI provider user

As a user running AX Code through Claude Code, Gemini CLI, or Codex CLI provider mode, I want long sessions to compact automatically instead of growing until the external CLI rejects or truncates context.

### Autonomous mode user

As an autonomous-mode user, I want report-style or debugging sessions to converge before context becomes too large, and I want token-pressure decisions to work even when the provider does not return perfect usage metadata.

### Local provider user

As a user of OpenAI-compatible local providers, I want AX Code to avoid obviously oversized calls and compact first when the prompt is already above the model's usable budget.

### Maintainer

As a maintainer, I want a small, testable token-budget contract that can improve over time without coupling the session loop to provider-specific tokenizer packages.

## Requirements

### R0: Token Budget Logic Must Have One Runtime Contract

Budget decisions must not duplicate token-total math across the session loop, compaction, provider adapters, and tests.

The implementation should expose one small runtime contract for:

- component token total;
- effective budget total, defined as the larger of reported total and component total;
- model budget, including `limit.input || limit.context` and configured reserved headroom;
- overflow decision.

`SessionCompaction.isOverflow()`, prompt preflight, and focused tests should all rely on this same contract. `Session.getUsage()` may keep doing provider-specific normalization, but it should not be the only place where budget totals are made safe.

### R1: Usage Normalization Must Have a Conservative Total

`Session.getUsage()` should produce a conservative total when `totalTokens` is missing or lower than the component sum.

Minimum component sum:

- input tokens;
- output tokens;
- reasoning tokens;
- cache read tokens;
- cache write tokens.

Provider-reported `totalTokens` may still be stored when present, but overflow decisions should use the larger of reported total and component total.

### R2: CLI Providers Must Emit Estimated Usage

`CliLanguageModel` should estimate prompt and response tokens when the external CLI does not provide structured usage.

Initial estimation contract:

- use the existing lightweight estimate strategy, equivalent to `Token.estimate(text)`;
- estimate input from `promptToText(options.prompt)`;
- estimate output from parsed response text or streamed emitted text;
- populate the AI SDK v3 shape: `inputTokens.total`, `inputTokens.noCache`, `outputTokens.total`, and `outputTokens.text`;
- mark this path as estimated in code comments/tests, but do not expose it as exact billing.

This should replace the current all-empty `EMPTY_USAGE` behavior for successful CLI calls.

### R3: Compaction Overflow Must Include Reasoning Tokens

`SessionCompaction.isOverflow()` should include reasoning tokens in its fallback count when `tokens.total` is unavailable.

The check should be robust to partially populated token objects and should not regress cache-aware behavior.

### R4: Prompt Preflight Should Catch Obvious Over-Budget Requests

Before calling `processor.process()`, the session prompt loop should estimate the model request size from:

- system prompt strings;
- converted model messages;
- optional final-step reminder;
- a small fixed overhead for roles/tool wrappers.

If the estimate exceeds the same usable budget used by `SessionCompaction.isOverflow()`, the loop should schedule compaction before calling the provider.

The preflight is intentionally conservative:

- exact tokenizer parity is not required;
- underestimation should be avoided more than overestimation;
- false positives should be bounded by only firing near the usable cap.

Preflight must not recursively schedule compaction for compaction-mode summary requests. If a compaction request is still too large, the existing compaction failure path should surface that bounded error instead of creating another compaction marker.

### R5: Tool Pruning Should Estimate Sent Representation

Tool-result pruning should account for more than `part.state.output`.

The first slice may include:

- serialized tool input length;
- output text length;
- attachment placeholders or metadata length;
- JSON/tool-result wrapper overhead.

It does not need to re-run full `convertToModelMessages()` during pruning, but the estimate should approximate the payload AX Code actually sends.

### R6: Title Generation Must Be Bounded

Title generation should not send the full first-turn context when that context is large.

Initial behavior:

- text-only first-turn context can be truncated to a bounded character/token estimate;
- file and media parts should be summarized as filenames/placeholders;
- subtask-only first turns may keep the existing prompt-only behavior;
- title generation failure must remain non-blocking.

## Phases

### Phase 1: Accounting Correctness

Fix the bugs that can prevent compaction from firing:

- add the shared token-budget helper/contract;
- add conservative total/component accounting in `Session.getUsage()` or a small shared helper;
- include reasoning tokens in `SessionCompaction.isOverflow()`;
- replace CLI provider empty usage with lightweight estimated usage;
- add tests in `test/session/compaction.test.ts` and `test/provider/cli/cli-language-model.test.ts`.

Acceptance:

- CLI `doGenerate` and `doStream` tests assert non-zero usage for non-empty prompt/output.
- CLI tests assert the AI SDK v3 usage fields that the adapter emits.
- `Session.getUsage()` test covers `reasoningTokens` with missing `totalTokens`.
- `isOverflow()` test covers reasoning-only overflow when `total` is absent.
- Existing cache read/write tests remain green.

### Phase 2: Prompt Preflight

Add a cheap preflight before provider calls:

- expose a helper that computes the usable token budget from model/config;
- estimate system + message request size before `processor.process()`;
- create a compaction task instead of calling the provider when clearly over budget;
- record a log field explaining that compaction was preflight-triggered.

Acceptance:

- A prompt-flow test proves over-budget estimated input schedules compaction before `LLM.stream()` is called.
- A below-budget prompt still calls `LLM.stream()`.
- Compaction-mode summary generation does not recursively schedule another compaction task.
- `compaction.auto: false` preserves current behavior and does not schedule compaction.

### Phase 3: Better Pruning and Title Bounds

Reduce avoidable context growth:

- update pruning estimate to include tool input/wrapper/attachment placeholder costs;
- add title-generation truncation for large first-turn context;
- add tests for large tool input/output and large first-turn title context.

Acceptance:

- Prune test demonstrates that large tool input contributes to the prune threshold.
- Title test demonstrates that a large first user message is truncated before title model invocation.
- Existing title-generation fallback behavior remains non-blocking.

### Phase 4: Observability and Tuning

Improve maintainer visibility:

- log whether usage was exact, estimated, or missing;
- log compaction trigger reason: provider usage, context overflow error, prompt preflight, or manual compact;
- optionally add debug trace fields for estimated request tokens and usable budget.

Acceptance:

- Debug logs identify the trigger path without exposing prompt contents.
- Tests or snapshots cover the structured log/event fields where practical.

## Implementation Notes

### Shared Budget Helper

Extract a small helper from `SessionCompaction.isOverflow()`:

```ts
type TokenBudget = {
  cap: number
  reserved: number
  usable: number
}
```

This keeps preflight and post-response compaction aligned without duplicating the `limit.input || context` and reserved-fraction logic.

The helper should also expose an effective total function so callers do not disagree about whether reasoning/cache tokens are counted.

### Estimated Usage Semantics

Estimated CLI usage is a control signal, not billing truth. The implementation should avoid naming it as exact usage in user-facing billing contexts.

If a future CLI provider emits exact usage, exact data should win.

### Provider Compatibility

The first slice should not add provider-specific tokenizers. A lightweight estimate is sufficient because the goal is to avoid pathological no-accounting behavior, not to match vendor billing exactly.

## Risks

- **False-positive compaction:** coarse estimates may compact earlier than strictly necessary. Mitigation: use the existing 90% usable-budget threshold and avoid preflight for very small prompts.
- **False-negative estimates:** character-based estimation can undercount some languages or model tokenizers. Mitigation: keep provider-reported usage as authoritative when available and use estimates mainly for missing-usage paths.
- **Billing confusion:** estimated usage could be mistaken for exact provider billing. Mitigation: keep exact-vs-estimated distinction internal and documented in tests/comments.
- **Prompt preflight complexity:** estimating model-message overhead can drift from AI SDK internals. Mitigation: start with a conservative helper and test behavior at the decision boundary, not exact token counts.

## Open Questions

- Should estimated CLI usage be stored exactly in `Assistant.tokens`, or should a future metadata field distinguish estimated usage?
- Should prompt preflight run for every provider, or only providers with known context limits and unreliable overflow errors?
- Should title generation be skipped entirely for first-turn contexts above a high threshold instead of truncated?
- Should tool-result pruning preserve a richer placeholder such as output byte count and original title?

## Initial Validation Commands

Run from `packages/ax-code`:

```sh
bun test test/session/compaction.test.ts
bun test test/provider/cli/cli-language-model.test.ts
bun test test/session/prompt-flow.test.ts
bun run typecheck
```

For repo-level contract checks after wider provider changes:

```sh
pnpm typecheck
```
