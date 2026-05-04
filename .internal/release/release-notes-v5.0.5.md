# ax-code v5.0.5

This release adds abortable bootstrap phases, hardens auto-index failure reporting, adds an RPC origin guard in the TUI worker, and extracts the sidebar graph status text into a testable view-model.

## Highlights

- **Abortable bootstrap** — The sync bootstrap flow now issues an `AbortController` per run and cancels the previous run when a new one starts. Delayed phases respect the signal via an abort-aware timer, and `SyncProvider` registers `onCleanup(() => bootstrapFlow.stop())` so in-flight bootstrap work stops cleanly on component teardown. This prevents stale bootstrap tasks from racing against a fresh session after navigation.
- **Auto-index all-failed detection** — When every attempted file fails to parse, auto-index now transitions to the `"failed"` state with an explicit error message instead of silently returning to idle, so the sidebar shows the failure rather than the misleading "not indexed" empty state.
- **Lock-held feedback** — When another `ax-code` process already holds the index lock, the sidebar now shows "Indexing is already running in another ax-code process." with the candidate file count, instead of snapping back to the blank idle state with no context.
- **RPC origin guard** — `worker.ts` now validates that every `rpc.fetch` call targets the internal origin before forwarding the request, preventing SSRF-style redirects from routing RPC traffic to external hosts.
- **Sidebar index view-model** — Graph index status text is extracted into `sidebarGraphIndexStatusText` in a new `sidebar-index-view-model.ts` module, adding a new "index complete · no symbols found" state to distinguish a finished-but-empty run from a never-started one.

## TUI / Bootstrap

- **`createSyncBootstrapFlow`** (`src/cli/cmd/tui/context/sync-bootstrap-flow.ts`): tracks `activeRunAbort`; `run()` cancels any in-flight run before starting; `stop()` method added for teardown; `runBootstrapPhaseSequence` receives `runAbort.signal`.
- **`runBootstrapPhaseTasks`** (`src/cli/cmd/tui/context/sync-bootstrap-runner.ts`): checks `signal?.aborted` before the delay and before task execution; `waitBootstrapPhaseDelay` replaces the bare `setTimeout` with an abort-aware promise; `emptyBootstrapPhaseSummary` helper.
- **`runBootstrapPhaseSequence`** (`src/cli/cmd/tui/context/sync-bootstrap-runner.ts`): propagates `signal` to all steps; aborted steps short-circuit immediately.
- **`SyncProvider`** (`src/cli/cmd/tui/context/sync.tsx`): `onCleanup(() => bootstrapFlow.stop())` registered after `createBootstrapController`.

## TUI / Worker

- **`assertRpcFetchUrlAllowed`** (`src/cli/cmd/tui/worker.ts`): new function; validates that `input.url` origin matches `internalBaseUrl()` origin; called at the top of `rpc.fetch`.

## TUI / Sidebar

- **`sidebarGraphIndexStatusText`** (`src/cli/cmd/tui/routes/session/sidebar-index-view-model.ts`): new module; handles `failed`, `indexing` (with/without total), `nodeCount > 0`, `error`, `total > 0 && completed >= total` ("index complete · no symbols found"), and bare idle cases.
- **`Sidebar`** (`src/cli/cmd/tui/routes/session/sidebar.tsx`): graph indicator text delegated to `sidebarGraphIndexStatusText`.

## Code Intelligence

- **`AutoIndex.maybeStart`** (`src/code-intelligence/auto-index.ts`):
  - `candidateFileCount` captured after the ripgrep walk for use in lock-held state.
  - All-failed case: when `result.failed === attempted && attempted > 0`, transitions to `state: "failed"` with an explicit error message.
  - Lock-held case: transitions to `state: "idle"` with `candidateFileCount` and a visible "Indexing is already running in another ax-code process." error hint instead of `error: null`.

## Tests

- `test/cli/tui/sync-bootstrap-runner.test.ts`: added test that delayed tasks do not run after abort.
- `test/cli/tui/session-sidebar-index.test.ts` (new): covers all `sidebarGraphIndexStatusText` branches including the "index complete · no symbols found" state.
- `test/code-intelligence/auto-index.test.ts` (new): covers concurrency, fallback path, all-failed detection, lock-held feedback, and `triedProjects` one-shot gate.

## Install

- npm compiled package: `npm install -g @defai.digital/ax-code@5.0.5`
- npm source package: `npm install -g @defai.digital/ax-code-source@5.0.5`
- Homebrew compiled formula: `brew upgrade ax-code` or `brew install defai-digital/ax-code/ax-code`
- Homebrew source formula: `brew upgrade ax-code-source` or `brew install defai-digital/ax-code/ax-code-source`

## Release Artifacts

- macOS: `ax-code-darwin-arm64.zip`
- Linux x64: `ax-code-linux-x64-baseline.tar.gz`
- Linux arm64: `ax-code-linux-arm64.tar.gz`
- Windows x64: `ax-code-windows-x64.zip`
- Windows arm64: `ax-code-windows-arm64.zip`
