# AX Code for VS Code

The [AX Code](https://github.com/defai-digital/ax-code) coding agent inside your editor — it reads your actual workspace, explains and reviews code, and hands you changes you can insert or apply with one click. Not a chatbot: an agent wired into your editing workflow.

## Install

Grab it from the VS Code Marketplace: [AX Code (AutomatosX)](https://marketplace.visualstudio.com/items?itemName=AutomatosX.ax-code-vscode) — or from the command line:

```bash
code --install-extension AutomatosX.ax-code-vscode
```

## Features

- **Agent panel in the sidebar** with streaming, markdown-rendered answers and inline tool activity.
- **Code blocks that act**: every block has Copy / Insert at cursor / Open in new file — no manual select-copy-paste.
- **Editor commands** for the current file or selection (right-click):
  - `ax-code: Explain This File`
  - `ax-code: Fix This File`
  - `ax-code: Explain Selection`
  - `ax-code: Review Selection`
    Commands prefill the input so you review the prompt before it goes out — nothing auto-sends.
- **`@` file references**: `Cmd/Ctrl+Alt+K` inserts the current file (with selection range, e.g. `@src/app.ts#L12-34`) into the input.
- **Paste images** (`Ctrl+V` screenshots) straight into the input as prompt attachments.
- **Input history**: `↑`/`↓` recalls previous prompts.
- **Model picker** over any provider configured via `ax-code providers login`.
- **Persistent sessions** across panel reloads.
- **Terminal launcher** for the full TUI experience.

## Settings

| Setting                   | Default  | Description                                                              |
| ------------------------- | -------- | ------------------------------------------------------------------------ |
| `axCode.binaryPath`       | `""`     | Path to the `ax-code` binary. Empty auto-detects (monorepo dev or PATH). |
| `axCode.serverTimeoutMs`  | `90000`  | How long to wait for `ax-code serve` to start.                           |
| `axCode.requestTimeoutMs` | `600000` | Per-message timeout (default 10 minutes).                                |
| `axCode.defaultModel`     | `""`     | `providerID/modelID` used until overridden via the picker.               |

## Prerequisites

Install the [AX Code CLI](https://github.com/defai-digital/ax-code) and at least one provider:

```bash
ax-code providers login
```

## Development

1. `code packages/integration-vscode` — open this package directly (not the repo root).
2. `pnpm install`
3. `pnpm run watch:esbuild` — bundle `dist/extension.js` (rebuilds on change; requires the workspace SDK to be built: `pnpm --dir ../sdk/js run build`).
4. Press `F5` to launch a debug VS Code window with the extension loaded.
5. Reload the debug window (`Cmd+Shift+P` → `Developer: Reload Window`) after code changes.

## Issues

https://github.com/defai-digital/ax-code/issues
