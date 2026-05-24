# ax-code v5.5.0 Release Notes

## Highlights

- Added Qwen3.7-Max readiness classification for Alibaba, OpenRouter, Together AI, and gateway routes.
- Added Alibaba plan support for `qwen3.7-max` with 1M context metadata, reasoning, tool calling, and text-only modality.
- Added the first Super-Long supervised long-run slice for Qwen3.7-Max, including TUI toggle wiring, runtime defaults, Autonomous-gated request shaping, provider/model request pacing, prompt caching, thinking-state preservation, context packing, and replay trace events.
- Added the Qwen3.7-Max evaluation harness with fixture smoke mode and strict live promotion-gate behavior.

## Guardrails

- Super-Long defaults on for Qwen3.7-Max and off for other models unless explicitly enabled, but runtime request shaping requires Autonomous-mode guardrails.
- Super-Long runtime is capped at a hard 72 hour ceiling.
- Alibaba Super-Long requests are paced by provider/model to avoid short-window request bursts across sessions.
- OpenRouter Qwen3.7-Max remains out of the curated allowlist until its route-specific cache/tool behavior is explicitly verified.
- Cost budgets, checkpoint artifacts, approval gates, verifier configuration, rollback-evidence enforcement, and rich rate-limit backoff remain follow-up guardrails before the full Phase 7 PRD can close.

## Validation

- Provider readiness, model filtering, request transform, Super-Long policy, LLM request-shape, route, trace, and TUI guard tests pass in the v5.5.0 validation slice.
