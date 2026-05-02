# ax-code v4.6.5

This release tightens cancellation throughout the programmatic SDK, adds double-escape-to-clear in the prompt, hardens several long-running paths against hangs, and lands a handful of small reliability fixes.

## Highlights

- **Double-escape clears the prompt draft** — pressing Esc once *arms* a clear (within a 3-second window), pressing Esc a second time clears the textarea + parts atomically. Single Esc keeps the existing pass-through behaviour for callers that interpret it (autocomplete dismiss, dialogs).
- **Programmatic SDK cancellation** — `agent.run()` now wires user-provided `AbortSignal` into `withRetry`'s exponential-backoff sleep, server-side `session.abort`, and timeout cleanup, so callers can interrupt mid-retry without leaking timers or leaving the session running.
- **Doctor command hang guard** — `defaultRun` (used by various health probes) now kills the spawned subprocess after 5 seconds, so a stuck child can't block `ax-code doctor`.
- **OTLP traces use SSRF-pinned fetch** — the OpenTelemetry exporter now routes through `Ssrf.pinnedFetch` with `AX_CODE_OTLP_ENDPOINT` labelling, matching the rest of the outbound HTTP surface.

## TUI

- **Prompt double-escape**: `promptEscapeClearIntent` view-model helper plus a `clearPromptDraft` function in `Prompt`. Tracks `lastDraftEscapeAt` so the second Esc within 3s clears the draft and extmarks; arming Esc is `preventDefault`-ed to keep the textarea cursor pinned.
- **Autocomplete key routing**: when the dropdown is visible, the new branch checks `e.defaultPrevented` after dispatching to `autocomplete.onKeyDown` — if the dropdown handled the key (up/down/enter/tab/esc), the prompt skips its own escape/history logic. Prevents Esc from both dismissing the dropdown *and* arming the clear in the same press.

## SDK

- **`withRetry` is abort-aware** (`src/sdk/programmatic.ts`): the helper now accepts an `AbortSignal`, checks it before each attempt and after each error, and uses `signal.addEventListener("abort", …, { once: true })` on the backoff timer so an aborted retry resolves immediately instead of waiting up to 8s.
- **`agent.run()` rewires cancellation**: a single internal `AbortController` is now the source of truth — it forwards user-provided `options.signal`, drives `withRetry`'s abort, fires `sdk.session.abort()` server-side, and gets cleaned up with `removeEventListener` on every settle path (success / timeout / error).

## Reliability

- **Doctor**: `defaultRun()` (`src/cli/cmd/doctor-health.ts`) wraps the spawned process with a 5s timer that calls `proc.kill()` if it overruns; timer is `unref()`-ed and cleared in `finally`.
- **Code intelligence**: reference-query planner (`src/code-intelligence/builder.ts`) caps bookmarks per query at 50 (`MAX_BOOKMARKS_PER_REFERENCE_QUERY`), preventing pathological blow-up on hot symbols (e.g. tens of thousands of references to a popular helper).
- **Provider warmup**: model-loader race fix (`src/provider/provider.ts`) — the in-flight promise is now created via `Promise.resolve().then(...)` and committed to the pending map *before* its body runs, removing the small window where two callers could both start the heavy bundled-SDK load for the same model.
- **LSP**: `spawnJdtls` (`src/lsp/server-defs.ts`) wires `proc.stderr` listeners *before* attaching the data-dir cleanup on `proc.exited`, so an early stderr burst is logged instead of dropped.
- **Control-plane SSE** (`src/control-plane/sse.ts`): added a contract comment clarifying that `parseSSE` owns the body's reader lock for the duration of the call — concurrent invocations on a shared body are a misuse, not supported by serialization tricks.
- **Telemetry**: OTLP trace exporter now uses `Ssrf.pinnedFetch` (`src/telemetry/index.ts`).

## Install

- npm compiled package: `npm install -g @defai.digital/ax-code@4.6.5`
- npm source package: `npm install -g @defai.digital/ax-code-source@4.6.5`
- Homebrew compiled formula: `brew upgrade ax-code` or `brew install defai-digital/ax-code/ax-code`
- Homebrew source formula: `brew upgrade ax-code-source` or `brew install defai-digital/ax-code/ax-code-source`

## Release Artifacts

- macOS: `ax-code-darwin-arm64.zip`
- Linux x64: `ax-code-linux-x64-baseline.tar.gz`
- Linux arm64: `ax-code-linux-arm64.tar.gz`
- Windows x64: `ax-code-windows-x64.zip`
- Windows arm64: `ax-code-windows-arm64.zip`
