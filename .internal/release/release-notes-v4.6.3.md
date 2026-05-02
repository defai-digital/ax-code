# ax-code v4.6.3

This release adds a footer step progress bar, cleans up duplicate status indicators in the sidebar, hardens provider warmup against malformed snapshot entries, and improves the slash-command autocomplete styling. Nerd Font glyphs are now available as an opt-in.

## Highlights

- **Footer step progress bar** — a 10-cell `[██░░░░░░░░] 12` bar shows on the left side of the footer while a session is busy. Scaled against a 50-step soft target with a warning state past the soft cap. Pure data-driven, no animation timer, no shimmer cell — the v2 animated-bar pattern that caused TUI hangs is intentionally avoided.
- **Provider warmup hardening** — one malformed entry in the bundled models snapshot can no longer crash provider warmup or empty the `/connect` dialog. Permissive defaults + per-model and per-provider try/catch keep the registry populated even when the snapshot drifts ahead of the schema.
- **Slash-command autocomplete** — selected row now uses a full-width highlight bar that spans the popup, matching the cleaner two-column dropdown style users expect.
- **Sidebar cleanup** — the busy/idle status line under the session ID is removed (the same information is now in the footer progress bar and the prompt-area status indicator), eliminating the three-place duplication.
- **Nerd Font glyphs (opt-in)** — file-type icons appear in the file picker (`@` autocomplete) when enabled. Defaults to OFF; toggle via the System command-dialog entry, the `nerd_font_enabled` kv key, or the `AX_CODE_NERD_FONT=1` env override. Recommended terminal font: Cascadia Code Nerd Font.

## TUI

- **Footer progress bar (new):** visible only while busy with `step` / `maxSteps` set; disappears when idle. Scales against `PROGRESS_SOFT_MAX = 50` so ordinary task density (5–10 task batch) drives a meaningful bar without needing the 500-step ceiling. Flips to warning color when `step` exceeds the soft target. Hidden on terminals narrower than 80 columns.
- **Slash-command autocomplete:** row `<box>` now uses `width="100%" + flexShrink={0}` (not `flexGrow={1}`) so the selected-row background spans the full popup width without stretching each row vertically. The earlier `flexGrow={1}` attempt caused rows to inflate vertically inside the scrollbox column, hiding `/connect` and other entries — that regression is fixed in this release.
- **Sidebar cleanup:** removed `sidebarSessionStatusView`, `titleStatus`, `sidebarStatusColor`, and the 5-second `setInterval` that drove the sidebar status refresh. The sidebar header now shows only title + session ID + share URL.
- **Nerd Font glyph module:** new `src/cli/cmd/tui/ui/glyphs.ts` with file-type glyph table covering 30+ extensions, special filenames (Dockerfile, Makefile, package.json), and a generic-file fallback. Tri-state resolution: env override > kv preference > default `false`.

## Provider Reliability

- **`fromModelsDevModel`** — missing `api.url` no longer throws (matches v4.6.2 permissiveness; many providers like xai, google, openrouter intentionally omit URL because the bundled npm SDK package supplies it). Defaults added for every optional field (`limit.context`, `limit.output`, `name`, `release_date`, capability flags). The whole conversion is wrapped in try/catch so an unforeseen snapshot anomaly produces `undefined` (skipped, logged) rather than a thrown exception.
- **`fromModelsDevProvider`** — wrapped in try/catch; one malformed provider can no longer block sibling providers from loading. Returns `undefined` on failure.
- **Caller-side filtering** — `Provider.list()` and the `/provider` HTTP route both filter out `undefined` results before assigning, so downstream code (dialog, model picker, routing) never observes holes.

## Reliability (Misc)

- `cli-language-model.ts` — SIGKILL fallback timer now cleared on process exit; `proc.kill("SIGKILL")` wrapped in try/catch in case the process is already dead.
- `tool/apply_patch.ts` — `fs.stat` catch narrowed to `ENOENT` so unrelated filesystem errors surface to the caller instead of being treated as "file does not exist".
- `tool/task.ts` — failed subagent cancellation is logged with structured fields instead of swallowed.
- `tool/webfetch.ts` — `reader.cancel()` is now awaited and its rejection guarded.
- `runtime/service-manager.ts` — `track()` no longer recursively re-enters `start()`; `lastError` is cleared when a task transitions back to running.

## Configuration

- New env var `AX_CODE_NERD_FONT` (tri-state: `1`/`true` forces ON, `0`/`false` forces OFF, unset falls through to user preference).
- New kv key `nerd_font_enabled` (default `false`) — toggled from the System command-dialog entry "Enable Nerd Font glyphs".

## Install

- npm compiled package: `npm install -g @defai.digital/ax-code@4.6.3`
- npm source package: `npm install -g @defai.digital/ax-code-source@4.6.3`
- Homebrew compiled formula: `brew upgrade ax-code` or `brew install defai-digital/ax-code/ax-code`
- Homebrew source formula: `brew upgrade ax-code-source` or `brew install defai-digital/ax-code/ax-code-source`

## Release Artifacts

- macOS: `ax-code-darwin-arm64.zip`
- Linux x64: `ax-code-linux-x64-baseline.tar.gz`
- Linux arm64: `ax-code-linux-arm64.tar.gz`
- Windows x64: `ax-code-windows-x64.zip`
- Windows arm64: `ax-code-windows-arm64.zip`
