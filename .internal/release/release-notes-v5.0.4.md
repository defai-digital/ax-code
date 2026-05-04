# ax-code v5.0.4

This release fixes auto-index infinite retry, several sidebar display and interaction bugs, a prompt cancel race window, and a session SDK initialization order issue.

## Highlights

- **Auto-index infinite retry fix** — A `triedProjects` set now prevents the sidebar poll loop from re-triggering ripgrep scans on every tick when a project's auto-index completes with zero nodes (no indexable files, all files failed to parse, or lock contention). Previously the in-flight gate was cleared on completion, so an empty result caused a new scan every ~750 ms.
- **Sidebar indexing display** — During the ripgrep file-walk phase the graph indicator now shows "scanning files..." instead of "indexing... (0/0)"; once the walk completes and total is known, it switches to the "indexing... (N/M)" counter.
- **MCP `needs_client_registration` error** — The sidebar now shows the error message for `needs_client_registration` MCP status (same treatment as `failed`), instead of the static "Needs client ID" placeholder that discarded the actual error text.
- **Todo collapse threshold** — The Todo section's collapse toggle threshold now uses the remaining (incomplete) item count instead of the total item count, so a session with one incomplete item out of three is always shown expanded rather than forcing the user to expand it to see their actionable item.
- **Footer LLM stale hint** — Removed the misleading "no model output Xs" stale hint from the LLM wait state; the footer now shows "Still waiting for model · elapsed" without an additional hint that reads as an error when the model is still processing.
- **Prompt cancel race** — `cancelPendingSubmit` now increments `submitRunID` and clears `routeHandoffTimer` before returning, closing a window where a cancelled submission's route handoff could fire after the cancel.
- **Session SDK initialization order** — `sdk` and `toast` are now declared before the `createEffect` that calls `sdk.setWorkspace()`, preventing a potential use-before-declaration on hot reload paths.

## TUI / Sidebar

- **`AutoIndex`** (`src/code-intelligence/auto-index.ts`): added `triedProjects` set; `maybeStart` exits early if the project was already attempted this process lifetime; `triedProjects.add(key)` called alongside `inFlight.add(key)`.
- **`Sidebar`** (`src/cli/cmd/tui/routes/session/sidebar.tsx`):
  - Graph state indicator shows "scanning files..." when `total === 0` during indexing.
  - `needs_client_registration` MCP entry renders `val().error` (same as `failed`) instead of static string.
  - Todo collapse toggle and body-show condition now gate on `todoRemaining()` instead of `todo().length`.
  - "Getting started" dismiss button changed from `onMouseDown` to `onMouseUp`, matching all other action buttons and preventing accidental dismissal on press-and-drag scroll.
  - Removed duplicate local `isFooterSessionStatus` — now imported from `footer-view-model`.
  - Removed dead `diff() || []` fallback (signal always returns an array).
  - Removed dead `branch` memo and its `SessionBranch` import.
  - "steps" rollback button gains `onMouseDown` `stopPropagation`, matching the existing "revert" button pattern.

## TUI / Footer

- **`footerSessionStatusView`** (`src/cli/cmd/tui/routes/session/footer-view-model.ts`): LLM wait state stale hint is now `undefined`; `labelWithHint` conditionally omits the hint when absent, so no trailing " · undefined" or empty hint appears.

## TUI / Prompt

- **`Prompt.cancelPendingSubmit`** (`src/cli/cmd/tui/component/prompt/index.tsx`): increments `submitRunID` and clears `routeHandoffTimer` before the abort sequence.

## TUI / Session route

- **`Session`** (`src/cli/cmd/tui/routes/session/index.tsx`): `toast` and `sdk` declarations moved above the `createEffect(() => sdk.setWorkspace(...))` call.

## Tests

- `test/cli/tui/sync-store-event.test.ts`: added coverage for `maxSessionMessages` part-bucket cleanup (orphaned part entries are removed when trimmed messages are evicted).
- `test/cli/tui/render-anti-patterns.test.ts`: added guardrails for `cancelPendingSubmit` timer cleanup and `sdk` initialization order.
- `test/cli/tui-footer-view-model.test.ts`: updated stale-LLM assertion to expect no "no model output" hint text.

## Install

- npm compiled package: `npm install -g @defai.digital/ax-code@5.0.4`
- npm source package: `npm install -g @defai.digital/ax-code-source@5.0.4`
- Homebrew compiled formula: `brew upgrade ax-code` or `brew install defai-digital/ax-code/ax-code`
- Homebrew source formula: `brew upgrade ax-code-source` or `brew install defai-digital/ax-code/ax-code-source`

## Release Artifacts

- macOS: `ax-code-darwin-arm64.zip`
- Linux x64: `ax-code-linux-x64-baseline.tar.gz`
- Linux arm64: `ax-code-linux-arm64.tar.gz`
- Windows x64: `ax-code-windows-x64.zip`
- Windows arm64: `ax-code-windows-arm64.zip`
