# Changelog

## 7.7.2

- **Fix:** sending an image-only prompt (no text) no longer renders an empty user bubble — the echo shows the attachment names.
- **Fix:** editor commands (Explain/Fix/Review) no longer clobber an unsent draft — the prefilled prompt is appended below it.
- **Fix:** input-history restore validates the persisted webview state instead of trusting its shape.
- **Fix:** the no-stream fallback answer bubble now shows the token count and scrolls into view like the streamed path.
- **Change:** user-facing labels use "AX Code" (activity bar container, status bar item) instead of "ax-code".

## 7.7.1

- **New:** code blocks in agent replies have Copy / Insert at cursor / Open in new file actions; assistant messages have a Copy button.
- **New:** paste images (`Ctrl+V`) into the input as prompt attachments; `↑`/`↓` input history; `Cmd/Ctrl+Alt+K` inserts an `@file#L1-2` reference to the current file.
- **Change:** editor commands (Explain/Fix/Review) prefill the input for review instead of auto-sending; the default `Cmd+Shift+A` / `Cmd+Alt+E` / `Cmd+Esc` keybindings were removed (commands remain in the palette and context menu).
- **Fix:** selecting text in a streaming reply no longer gets destroyed by re-renders.
- **Chore:** version realigned with the AX Code product line (jumped from 2.1.x); publisher moved to `AutomatosX` (extension ID `AutomatosX.ax-code-vscode`).
- **Fix:** terminal commands now title the tab "AX Code" (matching the TUI's own title write) instead of falling back to the launcher's process name ("node").
- **Fix:** `ax-code.openTerminal` / `openNewTerminal` honor `axCode.binaryPath`, monorepo dev mode, and PATH enrichment — the terminal launches the same ax-code the chat panel uses instead of a hardcoded `ax-code`.
- **Fix:** `askAboutFile` / `fixFile` include the current line selection (`#L12-34`) in the prompt instead of dropping it.
- **Chore:** working release/publish scripts (version from `package.json`, build before packaging); dropped stale `bun.lock` and SST leftovers; dependencies moved to the pnpm catalog.

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
