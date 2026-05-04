# ax-code v5.1.0

This release overhauls the provider/model filter logic, adds offline provider endpoint editing in the UI, introduces vision-capable model labels, cleans up slash command registration, hardens the event stream shutdown sequence, and fixes several auto-index and file-path handling issues.

## Highlights

- **Provider model filter overhaul** — Model filtering for xAI (Grok), ZhipuAI (GLM), OpenAI (GPT), and Google (Gemini) now uses a multi-probe approach that matches against model ID, display name, and family field simultaneously. Grok filter updated to allow Grok 4.1+ and the explicit `grok-code-fast-1` coding model; Grok 4.0 and all unversioned aliases drop. GPT-5.5 is explicitly excluded across all probes. GLM-5V vision models now correctly drop. `Provider.invalidate()` clears the model cache so re-auth picks up the updated filter.
- **Offline provider endpoint editing** — Ollama, LM Studio, and ax-serving now have a full endpoint editor in the provider dialog: when not connected, prompts for host/port; when connected, offers "Select a model" or "Change endpoint". The URL is normalised (protocol added if missing, trailing slashes stripped, `/v1` appended if absent) and saved to config. `resolveLocalProviderEndpoint` replaces the ad-hoc host string throughout `loaders.ts` so endpoint config is honoured for both reachability probes and model discovery.
- **Vision-capable model labels** — Models with `capabilities.input.image = true` now display a 👀 marker in the model picker and in the prompt footer's active-model chip. `modelDisplayInfo` in `model-vision-label.ts` drives both sites; fuzzy search uses the plain label without the marker.
- **Slash command cleanup** — `slash: { name, aliases }` metadata is removed from commands that were registered as both dialog options and server-side slash commands, preventing duplicates in the `/` autocomplete list. A server-command allowlist (`init`, `review`, `impact`) keeps the genuinely useful server-sourced slash commands while suppressing the rest.
- **Event stream clean shutdown** — The worker now awaits `eventStream.done` during shutdown before tearing down the instance, ensuring in-flight RPC calls drain cleanly. The `uncaughtException` handler skips the exit timer when a shutdown is already in progress.
- **Pasted file path decoding** — Drag-and-drop paths arriving as pasted text are now decoded through `parsePastedFilePath`, which strips wrapping quotes and unescapes shell backslash sequences (spaces, iCloud `com\~apple\~CloudDocs`, parentheses, etc.). Windows UNC and drive-letter paths are left untouched.
- **Auto-index cursor check** — `maybeStart` now reads `CodeGraphQuery.getCursor` before triggering a scan; if a prior index run completed with zero nodes (cursor present, node/edge count zero), the process-wide `triedProjects` gate is skipped and the sidebar shows "index complete · no code symbols found" instead of re-running the scan on every restart.
- **Transcript export path guard** — `resolveTranscriptExportPath` validates that the export filename stays within the current workspace, blocking absolute paths and `../` traversals.
- **Alibaba provider consolidation** — `alibaba` and `alibaba-cn` (standard API) are removed from the model snapshot and provider routes; `alibaba-token-plan` / `alibaba-token-plan-cn` (token-billing plans) are added with their own API endpoints and env keys. `zai` (standard API) is removed; `zai-coding-plan` remains.
- **CLI provider model default** — `buildCliCommand` no longer appends `--model <id>` when the model ID matches the provider ID (e.g. `claude-code` model on `claude-code` provider), letting the CLI use its own configured default. `DEFAULTS` in `resolve.ts` updated to match provider IDs.

## Provider / Model

- **`ModelsDev.supported` / `Provider.supported`** (`src/provider/models.ts`, `src/provider/provider.ts`): `modelProbes` generates lower, normalised, and dash-stripped variants of ID, name, and family; filter functions receive `probes[]` instead of a single string; `grok41OrAllowedCodingModel` replaces `grok4`; `glm5` now explicitly drops GLM-5V vision models; GPT-5.5 blocked globally.
- **`Provider.invalidate`** (`src/provider/provider.ts`): `currentState.models.clear()` added so cached models are evicted on re-auth.
- **`resolveLocalProviderEndpoint`** (`src/provider/loaders.ts`): new helper normalises configured/env/default URL into `{ discoveryHost, inferenceBaseURL, local }`; used by `ollamaCompatibleLoader` and `openAICompatibleLoader` for both probing and discovery; `CustomDiscoverModels` signature updated to receive `Provider.Info`.
- **`update-models.ts`** (`script/update-models.ts`): `alibaba` / `alibaba-cn` / `zai` removed from snapshot; `alibaba-token-plan` / `alibaba-token-plan-cn` added with API and env overrides; Grok filter updated to 4.1+; Gemini filter to 3+; GPT-5.5 excluded.
- **`DEFAULT_LOGIN_PROVIDER_IDS`** (`src/cli/cmd/providers.ts`): `zai` removed; `alibaba-token-plan`, `alibaba-token-plan-cn` added.
- **`NATIVE_PROVIDERS`** (`src/server/routes/provider.ts`): `alibaba` / `alibaba-cn` / `zai` removed; `alibaba-token-plan` / `alibaba-token-plan-cn` added.

## TUI / Provider dialog

- **`dialog-provider.tsx`**: `alibaba` un-hidden (removed from `HIDDEN_PROVIDERS`); `offlineProviderHint` simplified; new `normalizeOfflineProviderBaseURL` and `offlineProviderPreset` helpers; offline providers get a full endpoint-edit flow (prompt → normalise → save to config → bootstrap); `resolveCliModel` call removed from CLI provider flow; CLI "use" action closes dialog instead of navigating to model picker; `lmstudio` default host changed to `127.0.0.1`.
- **`dialog-model.tsx`**: `FREE_PROVIDERS` set and `isFreeProvider` removed; "Free" footer tag dropped; `modelDisplayInfo` drives title and search text; fuzzy search key changed from `title` to `searchText`; sort-by-free removed.

## TUI / Model display

- **`model-vision-label.ts`** (new, `src/cli/cmd/tui/component/model-vision-label.ts`): exports `MODEL_VISION_MARKER`, `supportsVision`, `modelVisionLabel`, `modelDisplayInfo`.
- **`local.tsx`**: `modelDisplayInfo` used to build `model` label and new `vision` flag in the active model descriptor.

## TUI / Prompt

- **`prompt-filepath.ts`** (new, `src/cli/cmd/tui/component/prompt/prompt-filepath.ts`): exports `parsePastedFilePath`; strips wrapping quotes; passes Windows paths through unchanged; unescape general backslash sequences.
- **`Prompt`** (`src/cli/cmd/tui/component/prompt/index.tsx`): pasted file path decoded via `parsePastedFilePath`.
- **`Autocomplete`** (`src/cli/cmd/tui/component/prompt/autocomplete.tsx`): server-sourced `command` slash entries filtered to `defaultCommandSlashAllowlist` (`init`, `review`, `impact`).

## TUI / Session & commands

- **`display-commands.ts`**: `slash` metadata removed from all session/display commands; `resolveTranscriptExportPath` validates export filename is relative and within workspace.
- **`app.tsx`**: `slash` metadata removed from app-level commands (workspaces, MCPs, status, themes, smart-llm, autonomous, sandbox).
- **`session/index.tsx`**: `slash` metadata removed from DRE debugging commands and unshare.

## TUI / Worker & stream

- **`resilient-stream.ts`**: `StreamSubscription` gains optional `unsubscribe`; subscription stored before iteration; `finally` block calls `unsubscribe()` on reconnect/shutdown.
- **`worker.ts`**: `eventStream.done` tracks the running stream promise; `shutdown` awaits `eventStream.done` before instance teardown; `uncaughtException` skips exit timer during active shutdown.
- **`sync-lifecycle.ts`**: redundant `onCleanup(startupCoordinator.stop)` removed (now handled by `sync.tsx`'s `onCleanup(bootstrapFlow.stop)`).

## Code Intelligence

- **`AutoIndex.maybeStart`** (`src/code-intelligence/auto-index.ts`): checks `CodeGraphQuery.getCursor` after the `triedProjects` gate; if cursor present with zero nodes/edges, records the prior empty result in state (`finishedAt = cursor.time_updated`) and returns without scanning.

## Sidebar

- **`sidebarGraphIndexStatusText`** (`src/cli/cmd/tui/routes/session/sidebar-index-view-model.ts`): `lastIndexedAt` field added to `SidebarGraphIndexStatus`; "index complete · no symbols found" updated to "index complete · no code symbols found in this scope" and also triggered when `lastIndexedAt` is set.
- **`Sidebar`** (`src/cli/cmd/tui/routes/session/sidebar.tsx`): "Getting started" copy updated to remove the "free" qualifier.

## Tests

- `test/cli/tui/session-sidebar-index.test.ts`: updated for new copy and `lastIndexedAt` branch.
- `test/code-intelligence/auto-index.test.ts`: added coverage for empty-cursor skip path.
- `test/provider/provider.test.ts`, `test/provider/cli/cli-language-model.test.ts`, `test/provider/cli/resolve.test.ts`, `test/provider/transform.test.ts`: updated for provider filter and CLI model changes.
- `test/cli/tui/prompt-filepath.test.ts` (new): covers `parsePastedFilePath` for quoted, escaped, Windows, and iCloud paths.

## Install

- npm compiled package: `npm install -g @defai.digital/ax-code@5.1.0`
- npm source package: `npm install -g @defai.digital/ax-code-source@5.1.0`
- Homebrew compiled formula: `brew upgrade ax-code` or `brew install defai-digital/ax-code/ax-code`
- Homebrew source formula: `brew upgrade ax-code-source` or `brew install defai-digital/ax-code/ax-code-source`

## Release Artifacts

- macOS: `ax-code-darwin-arm64.zip`
- Linux x64: `ax-code-linux-x64-baseline.tar.gz`
- Linux arm64: `ax-code-linux-arm64.tar.gz`
- Windows x64: `ax-code-windows-x64.zip`
- Windows arm64: `ax-code-windows-arm64.zip`
