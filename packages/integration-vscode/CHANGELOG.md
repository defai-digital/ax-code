# Changelog

## 2.1.2

- **Fix:** cancelling during session setup no longer surfaces a spurious "Unknown error" — the cancel-reason path is honored before and during the message request.
- **Fix:** server stdout/stderr is no longer buffered for the life of the process. After `listening` is matched we stop appending, and pre-match output is capped at 8 KB.
- **Perf:** markdown renders during streaming are throttled to ~16/sec per part, eliminating O(n²) re-parsing on long responses.
- **Fix:** editor command handlers (`askAboutFile`, `fixFile`, `explainSelection`, `reviewSelection`) now surface send failures as VS Code error messages instead of unhandled promise rejections.

## 2.1.1

- **Security:** sanitize markdown HTML before rendering to eliminate XSS via untrusted assistant output (strips `<script>`, event handlers, and unsafe URL schemes).
- **Fix:** validate a persisted session against the server on first use; stale IDs from a previous `ax-code serve` are dropped instead of producing 404s.
- **Fix:** streaming accumulator no longer cleared mid-stream — trailing SSE deltas after `done` now render correctly.
- **Fix:** user scroll-back is preserved during streaming; auto-scroll only when pinned to the bottom.
- **Fix:** dev-mode path detection now requires a `pnpm-workspace.yaml` marker, avoiding misdetection from an installed VSIX.
- **Fix:** Clear no longer shows a duplicate "Cancelled" error when aborting an in-flight request.
- **Fix:** retry up to 3 times on server port collision.

## 2.1.0

- Streaming assistant output via Server-Sent Events — replies render token-by-token instead of waiting for the full turn.
- Markdown rendering with code blocks, lists, links, and blockquotes using theme-aware styling.
- Session persistence: conversation and selected model survive reloading the chat panel.
- New settings: `axCode.binaryPath`, `axCode.serverTimeoutMs`, `axCode.requestTimeoutMs`, `axCode.defaultModel`.
- Tool activity is surfaced inline as it runs.

## 2.0.1

- ESLint cleanup; no user-visible changes.

## 2.0.0

- Initial chat panel with agent support, file/selection commands, and model picker.
