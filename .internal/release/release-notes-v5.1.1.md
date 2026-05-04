# ax-code v5.1.1

Patch release hardening the Alibaba Token Plan integration, the autonomous completion gate, CLI provider stream reliability, and queued-message sidebar layout.

## Highlights

- **Alibaba Token Plan Team Edition hardening** — Token-plan requests now use a bounded `thinking` object (`budgetTokens: 8192`) instead of the generic `reasoning_effort` field, matching the service's documented AI-tool configuration. Output tokens are capped at 8 192 to avoid over-allocating quota. Quota-exhaustion errors (`AllocatedQuotaExceeded`) are surfaced as a non-retryable API error with a detailed help link, and retry logic skips the standard 429 back-off for them. Default small-model priority list updated to `deepseek-v3.2`, `qwen3.6-plus`, `glm-5`, `MiniMax-M2.5`.
- **Completion gate resolution via assistant text** — The autonomous completion gate can now be resolved explicitly through assistant text. When a failed subagent is genuinely unrecoverable, the model can write "Completion gate resolution: …" naming the task and the direct evidence used instead, and `AutonomousCompletionGate.evaluate` will clear the gate. The injected retry prompt is updated to hint at this escape hatch.
- **UTF-8 stream safety** — `CliLanguageModel` now uses `StringDecoder` to decode stdout chunks, preventing multi-byte characters (e.g. emoji) split across chunk boundaries from being emitted as replacement characters.
- **Richer CLI timeout/error diagnostics** — On timeout or non-zero exit, buffered stdout and stderr are included in the error message (up to 1 000 chars), making provider failures easier to diagnose.
- **Gemini CLI headless mode** — `--skip-trust` added to the gemini-cli args, suppressing the interactive workspace trust prompt that hangs the process in non-interactive environments.
- **Queued-message delete icon stability** — The `✕` delete control in the sidebar queued-message list is replaced with a `🗑️` emoji in a fixed-width (`QUEUED_DELETE_ICON_WIDTH = 2`) box, preventing layout shift from variable glyph widths.

## Autonomous / Completion Gate

- **`AutonomousCompletionGate`** (`src/control-plane/autonomous-completion-gate.ts`): `Message` gains optional `info.role`; `resolveWithAssistantText` scans assistant messages for explicit resolution phrases; `isExplicitResolution` checks for "completion gate resolution", "not needed", "verified directly", etc.; `referencesResult` matches by task ID, call ID, or description word overlap; `isAssistantMessage` guard.
- **`SessionPrompt`** (`src/session/prompt.ts`): completion gate retry text gains "If the missing subagent result is genuinely unnecessary, include 'Completion gate resolution:' and name the subagent task plus the direct evidence you used instead."

## Provider / Alibaba Token Plan

- **`ProviderTransform`** (`src/provider/transform.ts`): `ALIBABA_TOKEN_PLAN_OUTPUT_TOKEN_MAX = 8192`; `ALIBABA_TOKEN_PLAN_THINKING_BUDGET_TOKENS = 8192`; `isAlibabaTokenPlanThinkingModel` guard for `qwen3.6-plus` / `glm-5`; `maxOutputTokens` capped for token-plan; `options` injects `thinking: { type: "enabled", budgetTokens: 8192 }` for token-plan thinking models and skips `enable_thinking`; `variants` returns empty object for all token-plan models.
- **`ProviderError`** (`src/provider/error.ts`): `isAlibabaTokenPlanQuota` detects `AllocatedQuotaExceeded` / quota-help-link patterns on token-plan URLs; `alibabaTokenPlanQuotaMessage` returns a user-facing explanation with doc link; injected before the generic retryable check so `isRetryable = false`.
- **`Provider.getSmallModel`** (`src/provider/provider.ts`): alibaba priority list updated to `["deepseek-v3.2", "qwen3.6-plus", "glm-5", "MiniMax-M2.5"]`.
- **`SessionRetry`** (`src/session/retry.ts`): `NON_RETRYABLE_PATTERNS` gains `"allocated quota exceeded"`, `"increase your quota limit"`, `"token-limit"`.

## Provider / CLI

- **`CliLanguageModel`** (`src/provider/cli/cli-language-model.ts`): `StringDecoder` added for stdout; `processStdoutText` helper decodes incrementally; `fail(err)` helper calls `endText()` then enqueues error and closes; `formatCliTimeout` includes partial stdout/stderr; `stdoutDecoder.end()` flushed in `flushOutput`; `endText()` replaces inline `text-end` enqueue throughout.
- **`CLI_PROVIDER_DEFINITIONS`** (`src/provider/cli/config.ts`): `gemini-cli` args gain `--skip-trust`.

## TUI / Sidebar

- **`Sidebar`** (`src/cli/cmd/tui/routes/session/sidebar.tsx`): `QUEUED_DELETE_ICON = "🗑️"` and `QUEUED_DELETE_ICON_WIDTH = 2` constants; queued-message delete button wrapped in a fixed-width `<box>` instead of a bare `<text>`.

## Tests

- `test/control-plane/autonomous-completion-gate.test.ts`: explicit resolution allow path; injected user-message does not clear gate.
- `test/provider/provider.test.ts`: `getSmallModel` returns a token-plan model from the updated priority list.
- `test/provider/transform.test.ts`: token-plan variants are empty; coding-plan retains `reasoningEffort` variants; `maxOutputTokens` capped; thinking object present for `qwen3.6-plus` / `glm-5`.
- `test/session/llm.test.ts`: token-plan stream sends `thinking` object, not `reasoningEffort`.
- `test/session/message-v2.test.ts`: quota-exhaustion test for both `alibaba-token-plan` providerID and URL-based detection.
- `test/session/retry.test.ts`: quota-exhaustion is not retried.
- `test/provider/cli/cli-language-model.test.ts`: UTF-8 split-chunk test; `--skip-trust` assertion; `text-end` updated.
- `test/cli/tui/render-anti-patterns.test.ts`: fixed-width delete icon guardrail.

## Install

- npm compiled package: `npm install -g @defai.digital/ax-code@5.1.1`
- npm source package: `npm install -g @defai.digital/ax-code-source@5.1.1`
- Homebrew compiled formula: `brew upgrade ax-code` or `brew install defai-digital/ax-code/ax-code`
- Homebrew source formula: `brew upgrade ax-code-source` or `brew install defai-digital/ax-code/ax-code-source`

## Release Artifacts

- macOS: `ax-code-darwin-arm64.zip`
- Linux x64: `ax-code-linux-x64-baseline.tar.gz`
- Linux arm64: `ax-code-linux-arm64.tar.gz`
- Windows x64: `ax-code-windows-x64.zip`
- Windows arm64: `ax-code-windows-arm64.zip`
