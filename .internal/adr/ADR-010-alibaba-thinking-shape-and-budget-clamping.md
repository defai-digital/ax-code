# ADR-010: Alibaba Thinking Shape and Budget Clamping

## Status

Accepted

## Date

2026-05-17

## Deciders

To be filled by team

## Related

- `packages/ax-code/src/provider/transform.ts` — `isAlibabaThinkingModel`, `alibabaThinkingBudget`, `options`, `sanitizeOptions`
- `packages/ax-code/src/flag/flag.ts` — `AX_CODE_ALIBABA_OUTPUT_TOKEN_MAX`
- `packages/ax-code/src/provider/models-snapshot.json` — `alibaba-token-plan`, `alibaba-token-plan-cn`, `alibaba-coding-plan`, `alibaba-coding-plan-cn`
- Alibaba: Connect OpenCode to Model Studio Coding Plan
- Alibaba: Set Up Qwen Code with Token Plan (Team Edition)
- Alibaba: Coding Plan FAQ
- Alibaba: Using deep thinking models

## Context

Alibaba Model Studio exposes two billing surfaces — Token Plan (Team Edition pay-as-you-go) and Coding Plan (monthly subscription) — and two endpoint shapes:

1. OpenAI-compat: `https://*.maas.aliyuncs.com/compatible-mode/v1` (Token Plan) and `https://coding*.dashscope.aliyuncs.com/v1` (Coding Plan). Thinking is enabled by `enable_thinking: true` and optionally bounded by `thinking_budget: <int>`.
2. Anthropic-compat: `https://coding*.dashscope.aliyuncs.com/apps/anthropic/v1` (Coding Plan only). Thinking is enabled by an Anthropic-shaped block `{ "thinking": { "type": "enabled", "budgetTokens": <int> } }`.

All four Alibaba providers configured in `models-snapshot.json` target the OpenAI-compat endpoint with `npm: "@ai-sdk/openai-compatible"`. The Anthropic-compat endpoint is not configured by this product.

A prior implementation sent the Anthropic-shaped `thinking` block to Token Plan's OpenAI-compat endpoint. The author's comment claimed Token Plan documented this shape, but Alibaba's published Qwen Code example for Token Plan uses `enable_thinking: true` on the OpenAI-compat endpoint. The Anthropic shape was a misread of Coding Plan documentation. Whether Token Plan silently ignored the unknown `thinking` field or accepted it through an undocumented compat path is not verified; either way, the documented shape is `enable_thinking` + `thinking_budget`.

A separate concern is short-window quota protection. Alibaba reserves `prompt + max_tokens` against a sliding short-window quota before generation. To keep parallel agents and long-context requests inside the default quota, `maxOutputTokens` for any Alibaba-backed model is clamped to `AX_CODE_ALIBABA_OUTPUT_TOKEN_MAX` (default 4096). This clamp also bounds the effective thinking budget, since `thinking_budget` cannot exceed the output ceiling.

Per-model thinking ceilings in Alibaba's docs vary (8192 in the OpenCode example, up to 32768 for GLM, up to 81920 for qwen3.5-plus and qwen3-max-2026-01-23). The product previously exposed an `AX_CODE_ALIBABA_THINKING_BUDGET_TOKENS` flag to raise the cap. It was removed because the output cap (4096) dominates by default and a second flag was inert unless paired with the first.

## Decision

1. Treat the OpenAI-compat endpoint as the only Alibaba endpoint this product supports. Send `enable_thinking: true` and `thinking_budget: <int>` for reasoning models on both Token Plan and Coding Plan. Do not send the Anthropic-shaped `thinking` block on any Alibaba provider.
2. Drive thinking enablement from `model.capabilities.reasoning` plus the `@ai-sdk/openai-compatible` npm marker, not from a hand-kept model id whitelist.
3. Clamp `thinking_budget` through a single helper, `alibabaThinkingBudget`, which returns `min(requested, maxOutputTokens, 8192)`. The 8192 ceiling matches Alibaba's published OpenCode example and is the upper bound the product asserts regardless of per-model documentation.
4. Apply the same clamp to user-supplied options in `sanitizeOptions` so that config overrides cannot exceed the documented ceiling.
5. Do not introduce a second flag for the thinking ceiling. Users who need a higher budget should raise `AX_CODE_ALIBABA_OUTPUT_TOKEN_MAX` first; if a real demand for an independent thinking knob emerges, revisit.

## Policy

- New reasoning-capable Alibaba models added via `models-snapshot.json` automatically receive thinking on both Token Plan and Coding Plan as long as `reasoning: true` is set and the provider stays on `@ai-sdk/openai-compatible`.
- A new Alibaba endpoint that targets `/apps/anthropic/v1` would need its own provider entry with `npm: "@ai-sdk/anthropic"`. The current `isAlibabaThinkingModel` check explicitly excludes that case so it can be handled with the Anthropic `thinking` block separately, without breaking the OpenAI-compat path.
- The 4096 output cap is a deliberate quota safety net, not an SLA target. Lowering it via `AX_CODE_ALIBABA_OUTPUT_TOKEN_MAX` is supported. Raising it is the only way to widen the effective thinking budget; doing so puts more weight on the user's account quota.
- The thinking shape and clamp invariants are covered by unit tests in `test/provider/transform.test.ts`. End-to-end verification against a real Alibaba endpoint is owned by the team member with active credentials and is not part of CI.

## Consequences

Positive:

- Token Plan thinking now uses the documented param shape. Requests that were previously sending an ignored field will start producing reasoning output once an end-to-end run confirms server acceptance.
- Both plans share one code path. Future changes to Alibaba thinking semantics need to be made in one place.
- New reasoning models picked up by the models.dev snapshot get thinking automatically; the model-id whitelist drift problem is gone.
- User config that injects an unbounded `thinking_budget` is clamped on both plans.

Negative or risky:

- Behavior change on Token Plan. If any deployment was implicitly relying on Token Plan ignoring the prior Anthropic `thinking` block (i.e., not actually using reasoning), they will start receiving reasoning output and the associated cost.
- The 8192 ceiling underuses model capacity for GLM (32768) and qwen3.5-plus / qwen3-max-2026-01-23 (81920). This is acceptable while the 4096 output cap dominates, and revisitable if usage demands it.
- The end-to-end shape correctness for Token Plan is only validated by Alibaba's published example. A wire-level probe against a real Token Plan key is the recommended follow-up before declaring this fully verified.

## Open Questions

- Should the product expose an Anthropic-shape Alibaba provider entry pointing at `/apps/anthropic/v1` for users on the Coding Plan who prefer that contract? Tracked as future work; not in scope here.
- If a real need arises to bound thinking without bounding output, reintroduce a dedicated thinking ceiling flag — but pair it with a documented account profile, not as a generic knob.
