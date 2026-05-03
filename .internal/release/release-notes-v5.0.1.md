# ax-code v5.0.1

This release improves subagent reliability by automatically recovering from empty responses and providing clearer error attribution when a provider failure ends a subagent session.

## Highlights

- **Subagent finalization recovery** — when a subagent turn ends with no text output and no error, the task tool now sends a one-shot finalization prompt asking the subagent to produce its final result before giving up. This eliminates a class of phantom "empty result" blocks that were caused by subagents completing all tool work but failing to emit a closing summary.
- **Error-aware empty-result messages** — when the empty result is caused by a provider API error, the output now names the error type and message (`Subagent ended with APIError: <message>`) so the parent agent has actionable context instead of the generic "completed without a final response" phrase.
- **Recovered-result review gate** — if a finalized recovery response contains uncertainty language (incomplete, unresolved, insufficient, etc.), `AutonomousCompletionGate` treats it as a soft block (`reason: "empty_subagent_result"`, message: "returned recovered evidence that still needs review") rather than silently accepting it.

## Session / Tool

- **`TaskTool`** (`src/tool/task.ts`):
  - Added `assistantError` / `assistantErrorMessage` helpers to surface provider error details.
  - Added `needsRecoveredResultReview(text)` regex that flags uncertainty phrases in recovered text.
  - When `text.trim().length === 0` and no error is present, a second `SessionPrompt.prompt` call is made with `SUBAGENT_FINALIZE_TIMEOUT_MS` (2 min) and task/todo tools disabled.
  - Metadata now includes `finalizeAttempted`, `recoveredFromEmpty`, `recoveredResultNeedsReview`, `subagentError`, `errorName`, `errorMessage`.
  - Error-path output: `Subagent ended with <name>: <message>.`
  - Recovery-path output: prefixed with a `Note: this result was recovered…` line.
- **`AutonomousCompletionGate`** (`src/control-plane/autonomous-completion-gate.ts`):
  - `EmptyResult` extended with optional `recoveredResultNeedsReview` flag.
  - `evaluate` reads `metadata.recoveredResultNeedsReview === true` alongside `metadata.emptyResult` to trigger the blocked decision.
  - Blocked message varies: "returned recovered evidence that still needs review" vs. "completed without a usable final response".

## Install

- npm compiled package: `npm install -g @defai.digital/ax-code@5.0.1`
- npm source package: `npm install -g @defai.digital/ax-code-source@5.0.1`
- Homebrew compiled formula: `brew upgrade ax-code` or `brew install defai-digital/ax-code/ax-code`
- Homebrew source formula: `brew upgrade ax-code-source` or `brew install defai-digital/ax-code/ax-code-source`

## Release Artifacts

- macOS: `ax-code-darwin-arm64.zip`
- Linux x64: `ax-code-linux-x64-baseline.tar.gz`
- Linux arm64: `ax-code-linux-arm64.tar.gz`
- Windows x64: `ax-code-windows-x64.zip`
- Windows arm64: `ax-code-windows-arm64.zip`
