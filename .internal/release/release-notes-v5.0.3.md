# ax-code v5.0.3

This release fixes XAI reasoning-effort API incompatibilities, hardens null-safety in session error handling, improves subagent abort wiring, adds animated liveness indicator support for compiled runtimes, and guards the share bus subscriber against unknown models.

## Highlights

- **XAI reasoning-effort fix** — Grok chat completion endpoints reject the AI SDK's `reasoningEffort` parameter. Auto-generation of `medium`/`high`/`max` variants for XAI models is removed; a new `ProviderTransform.sanitizeOptions` strips `reasoningEffort` and `reasoning_effort` from any XAI request options so explicit policy upgrades (e.g. from ReasoningPolicy) never reach the wire on XAI models.
- **APIError null-safety** — `SessionRetry` and `SessionProcessor` now guard all accesses to `error.data.message` with `typeof … === "string"` checks, preventing crashes when a provider returns an APIError without a message field.
- **Earlier subagent abort wiring** — `cancelSubagent` and its abort listener are registered in `TaskTool` before any await, closing a race window where aborting between config fetch and session creation would leave the in-flight subagent uncancelled.
- **Spawn listener cleanup** — `cross-spawn-spawner` now uses named handler functions and removes them via `.off()` in the Effect finalizer before killing the process.
- **Footer liveness indicator** — extracted `footerLivenessIndicator` / `footerLivenessTextFrame` into a new `liveness-view-model` module; the prompt footer now uses animated rotating ASCII frames (`[|] [/] [-] [\]`) in compiled runtimes where native spinner is unavailable, instead of the static `[⋯]`.
- **Share bus model guard** — the `MessageV2.Event.Updated` subscriber in `share-next` now catches `Provider.ModelNotFoundError` and skips the model sync with a warning log instead of throwing and crashing the bus subscriber.
- **LSP symbol fetch logging** — `documentSymbolsForRangeExpansion` in `session/prompt` adds debug log lines on both the cached and live fetch catch paths, making LSP symbol errors visible in debug-level output.

## Provider / Transform

- **`ProviderTransform.variants`** (`src/provider/transform.ts`): XAI branch now unconditionally returns `{}` instead of generating `medium`/`high`/`max` variants for grok-4/grok-code families.
- **`ProviderTransform.sanitizeOptions`** (new): strips `reasoningEffort` and `reasoning_effort` from options for `@ai-sdk/xai` models; no-op for other providers.
- **`LLM.stream`** (`src/session/llm.ts`): options pipeline now wraps through `ProviderTransform.sanitizeOptions(input.model, pipe(...))`.
- **Model snapshot**: added `openai/gpt-5.5` (GPT-5.5); corrected `glm-5v-turbo` display name to `GLM-5V-Turbo`.

## Session

- **`SessionRetry.shouldRetry`** (`src/session/retry.ts`): `error.data?.message` access guarded with optional chaining and `typeof` check throughout.
- **`SessionProcessor`** (`src/session/processor.ts`): retry-exhausted error construction guards `error.data` existence before spreading.
- **`SessionPrompt.documentSymbolsForRangeExpansion`** (`src/session/prompt.ts`): refactored to named `cached`/`live` variables with explicit `log.debug` catch handlers.

## TUI / Prompt

- **`liveness-view-model.ts`** (new, `src/cli/cmd/tui/component/prompt/liveness-view-model.ts`): exports `FooterLivenessIndicator`, `footerLivenessIndicator()`, `footerLivenessTextFrame()`, `FOOTER_LIVENESS_FRAMES`.
- **`Prompt`** (`src/cli/cmd/tui/component/prompt/index.tsx`): footer busy indicator refactored to use `footerLivenessIndicator` memo; native-spinner branch and text-frame branch are now separate `<Show>` blocks; stale warning `!` rendered as a sibling element.

## Tool / Effect

- **`TaskTool`** (`src/tool/task.ts`): `subagentSessionID` / `cancelSubagent` / abort listener moved above all awaits; `ensureNotAborted()` added after `Agent.get()`.
- **`cross-spawn-spawner`** (`src/effect/cross-spawn-spawner.ts`): named `onError`/`onExit`/`onClose`/`onSpawn` handlers; `.off()` calls in finalizer; process type annotation extended with `off` overloads.

## Share

- **`ShareNext`** (`src/share/share-next.ts`): `MessageV2.Event.Updated` handler catches `Provider.ModelNotFoundError`, logs a warning, and skips the model sync payload instead of propagating the error.

## Install

- npm compiled package: `npm install -g @defai.digital/ax-code@5.0.3`
- npm source package: `npm install -g @defai.digital/ax-code-source@5.0.3`
- Homebrew compiled formula: `brew upgrade ax-code` or `brew install defai-digital/ax-code/ax-code`
- Homebrew source formula: `brew upgrade ax-code-source` or `brew install defai-digital/ax-code/ax-code-source`

## Release Artifacts

- macOS: `ax-code-darwin-arm64.zip`
- Linux x64: `ax-code-linux-x64-baseline.tar.gz`
- Linux arm64: `ax-code-linux-arm64.tar.gz`
- Windows x64: `ax-code-windows-x64.zip`
- Windows arm64: `ax-code-windows-arm64.zip`
