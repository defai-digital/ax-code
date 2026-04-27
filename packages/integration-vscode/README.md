# AX Code for VS Code

Chat with the [AX Code](https://github.com/defai-digital/ax-code) agent directly from VS Code — streaming responses, markdown rendering, workspace-aware context, and a model picker.

## Features

- **Sidebar chat panel** with streaming assistant output and markdown-rendered code blocks.
- **Editor commands** for the current file or selection:
  - `ax-code: Explain This File`
  - `ax-code: Fix This File`
  - `ax-code: Explain Selection`
  - `ax-code: Review Selection`
- **Model picker** over any provider configured via `ax-code providers login`.
- **Persistent sessions** across panel reloads.
- **Terminal launcher** for the full TUI experience (`Cmd/Ctrl+Esc`).

## Keybindings

| Action                | macOS         | Windows / Linux |
| --------------------- | ------------- | --------------- |
| Open chat             | `Cmd+Shift+A` | `Ctrl+Shift+A`  |
| Explain selection     | `Cmd+Alt+E`   | `Ctrl+Alt+E`    |
| Open AX Code terminal | `Cmd+Esc`     | `Ctrl+Esc`      |

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
3. Press `F5` to launch a debug VS Code window with the extension loaded.
4. Reload the debug window (`Cmd+Shift+P` → `Developer: Reload Window`) after code changes.

## Issues

https://github.com/defai-digital/ax-code/issues
