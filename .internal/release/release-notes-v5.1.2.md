# ax-code v5.1.2

Patch release with TUI mouse cleanup on exit, Alibaba Token Plan parameter sanitization and doc/limit corrections, and a more actionable quota-error message.

## Highlights

- **Mouse tracking cleanup on exit** — A new `terminal-cleanup.ts` module writes the full set of mouse-tracking disable sequences and drains the stdout write buffer before the process exits. All exit paths (normal, error boundary, signal) now go through `destroyTuiRenderer`, preventing stray mouse events in the terminal after ax-code closes.
- **Token Plan provider options sanitization** — `ProviderTransform.sanitizeOptions` now strips any conflicting reasoning fields (`enable_thinking`, `reasoning`, `reasoningEffort`, `reasoning_effort`, `thinkingConfig`) from Token Plan requests and rebuilds a valid `thinking` object. This runs in `LLM.stream` so plugin-injected options cannot smuggle unsupported fields through to the Token Plan API.
- **Output cap is now model-specific** — Only `qwen3.6-plus` and `glm-5` are constrained to `ALIBABA_TOKEN_PLAN_OUTPUT_TOKEN_MAX` (8 192); other Token Plan models (`deepseek-v3.2`, `MiniMax-M2.5`) use the global cap. `deepseek-v3.2` output limit bumped to 16 384 in the snapshot.
- **China Token Plan MiniMax-M2.5 gets thinking config** — `isAlibabaTokenPlanThinkingModel` now also returns true for `MiniMax-M2.5` on `alibaba-token-plan-cn`.
- **Token Plan doc URLs corrected** — `alibaba-token-plan` and `alibaba-token-plan-cn` snapshot `doc` fields updated from the Coding Plan URL to `opencode-token-plan`.
- **Clearer quota error message** — Quota-exhaustion error now explains this is a short-window TPS/TPM reservation limit, not total plan usage, and suggests waiting briefly or lowering the configured output limit.

## TUI / Exit & Renderer

- **`terminal-cleanup.ts`** (new, `src/cli/cmd/tui/terminal-cleanup.ts`): exports `TUI_MOUSE_TRACKING_DISABLE_SEQUENCE`, `disableTuiMouseTracking(stream?)`, `flushTuiStdout(stream?)`. Both are no-ops on non-writable/destroyed streams.
- **`renderer.ts`** (`src/cli/cmd/tui/renderer.ts`): `TuiDestroyRenderer` type; `destroyTuiRenderer(renderer, profile?)` consolidates title reset, `renderer.destroy()`, mouse-disable, and `await flushTuiStdout()` in a `finally` block.
- **`context/exit.tsx`**: `clearTuiTerminalTitle` + `renderer.destroy()` replaced with `await destroyTuiRenderer(renderer)`.
- **`app.tsx`**: `ErrorComponent.handleExit` uses `await destroyTuiRenderer(renderer)`.
- **`thread.ts`**: `await flushTuiStdout()` added before `process.exit(0)`.

## Provider / Alibaba Token Plan

- **`ProviderTransform.sanitizeOptions`** (`src/provider/transform.ts`): for Token Plan thinking models, strips `enable_thinking`, `reasoning`, `reasoningEffort`, `reasoning_effort`, `thinkingConfig`; rebuilds `thinking` with `type: "enabled"` and a bounded `budgetTokens`; fractional budgets are floored; invalid/missing budgets fall back to `ALIBABA_TOKEN_PLAN_THINKING_BUDGET_TOKENS`.
- **`ProviderTransform.maxOutputTokens`**: uses `isAlibabaTokenPlanOutputCappedModel` (only `qwen3.6-plus` / `glm-5`) instead of the broad `alibaba-token-plan` prefix check; honors lower model limits; `deepseek-v3.2` and `MiniMax-M2.5` use the global `OUTPUT_TOKEN_MAX`.
- **`isAlibabaTokenPlanThinkingModel`**: case-insensitive ID check; `MiniMax-M2.5` added for `alibaba-token-plan-cn`.
- **`alibabaTokenPlanThinkingBudget`**: computes budget dynamically from `maxOutputTokens(model)` and any caller-supplied value.
- **`LLM.stream`** (`src/session/llm.ts`): `ProviderTransform.sanitizeOptions` applied to `params.options` before `providerOptions` is built.
- **`ProviderError.alibabaTokenPlanQuotaMessage`** (`src/provider/error.ts`): updated message explains short-window reservation semantics.
- **`update-models.ts`** (`script/update-models.ts`): `docOverrides` sets Token Plan URLs to `opencode-token-plan`; `deepseek-v3.2` output limit set to 16 384 across all four Alibaba plan providers.
- **`models-snapshot.json`**: `deepseek-v3.2` output limit 8 192 → 16 384 in `alibaba-coding-plan`, `alibaba-coding-plan-cn`, `alibaba-token-plan`, `alibaba-token-plan-cn`; Token Plan `doc` URLs updated.

## Tests

- `test/cli/tui/renderer.test.ts`: mouse-disable sequence order; `destroyTuiRenderer` call-order (title → destroy → mouse-disable → flush).
- `test/cli/tui/render-anti-patterns.test.ts`: exit-path flush guardrail; updated `clearTuiTerminalTitle` assertion.
- `test/provider/transform.test.ts`: Token Plan output cap is model-specific; lower limit honored; `sanitizeOptions` strips unsupported fields and rebuilds `thinking`; China Token Plan MiniMax-M2.5 thinking config.
- `test/session/llm.test.ts`: plugin-injected unsupported fields are sanitized before the request.
- `test/session/message-v2.test.ts`: updated for new quota-error message text.
- `test/provider/provider.test.ts`: `deepseek-v3.2` output limit and Token Plan doc URLs verified from snapshot.

## Install

- npm compiled package: `npm install -g @defai.digital/ax-code@5.1.2`
- npm source package: `npm install -g @defai.digital/ax-code-source@5.1.2`
- Homebrew compiled formula: `brew upgrade ax-code` or `brew install defai-digital/ax-code/ax-code`
- Homebrew source formula: `brew upgrade ax-code-source` or `brew install defai-digital/ax-code/ax-code-source`

## Release Artifacts

- macOS: `ax-code-darwin-arm64.zip`
- Linux x64: `ax-code-linux-x64-baseline.tar.gz`
- Linux arm64: `ax-code-linux-arm64.tar.gz`
- Windows x64: `ax-code-windows-x64.zip`
- Windows arm64: `ax-code-windows-arm64.zip`
