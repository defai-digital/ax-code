# ax-code v5.0.2

Bug fixes and session stability improvements.

## Bug Fixes

- **Shell listener leak** (`session/prompt.ts`): stdout/stderr `data` listeners are now removed in the `close` and `error` handlers, preventing continued writes to shared part state during the abort-timeout window.
- **PATCH /config leaks secrets** (`server/routes/config.ts`): The route now returns `redactConfig(await Config.get())` instead of echoing the raw request body, consistent with `GET /config`.
- **Blast radius undercounting for signal-killed processes** (`tool/bash.ts`): Redirect-file writes are now recorded when a process exits via a signal (`proc.signalCode`) in addition to clean exit (`exitCode === 0`).
- **Silent chmod failure** (`lsp/server-helpers.ts`): `chmod` errors are now logged at `warn` level with binary path and error detail instead of being silently discarded.

## Session Improvements

- **Todo deadline guidance**: Introduced step-buffer heuristic (`todoDeadlineStepBuffer`) and report-todo closure guidance injected as the session approaches its step limit or large-context threshold — directing the model to write or cancel `.internal/bugs` report todos rather than continuing broad exploration.
- **Empty model turn retry**: Added `MAX_EMPTY_MODEL_TURN_RETRIES` guard to prevent silent empty turns from consuming the step budget without progress.
- **Task tool finalization error capture**: `finalizeError` captures exception details when the finalize-prompt times out or throws, surfacing them in task metadata instead of losing them.
- **`Session.updateMessageWithParts`**: New transactional helper writes a message and all its parts in a single DB transaction, reducing write overhead for bulk part updates.
- **`time_updated` on upsert**: `updateMessage` and `updatePart` now set `time_updated` on conflict, fixing stale timestamps for re-written messages.

## Risk Scoring

- `recoveredSubagentResults` signal added to `Risk.Signals`: sessions with recovered subagent results score a confidence penalty (`-0.04` per result, capped at `-0.1`) and are classified as `needs_review` regardless of confidence.

## Install

- npm compiled package: `npm install -g @defai.digital/ax-code@5.0.2`
- npm source package: `npm install -g @defai.digital/ax-code-source@5.0.2`
- Homebrew compiled formula: `brew upgrade ax-code` or `brew install defai-digital/ax-code/ax-code`
- Homebrew source formula: `brew upgrade ax-code-source` or `brew install defai-digital/ax-code/ax-code-source`

## Release Artifacts

- macOS: `ax-code-darwin-arm64.zip`
- Linux x64: `ax-code-linux-x64-baseline.tar.gz`
- Linux arm64: `ax-code-linux-arm64.tar.gz`
- Windows x64: `ax-code-windows-x64.zip`
- Windows arm64: `ax-code-windows-arm64.zip`
