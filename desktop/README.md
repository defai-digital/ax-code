# AX Code Desktop

AX Code Desktop is the desktop UI for [AX Code](https://github.com/defai-digital/ax-code). It gives AX Code users a full workspace interface for chat sessions, file review, diffs, Git operations, terminals, project notes, and multi-agent workflows.

## Install On macOS

The recommended way to install on macOS is via Homebrew:

```bash
brew install --cask defai-digital/ax-code-desktop/ax-code-desktop
```

To update:

```bash
brew upgrade --cask ax-code-desktop
```

### Manual DMG (alternative)

If you prefer not to use Homebrew, download the latest DMG from the [Releases page](https://github.com/defai-digital/ax-code/releases):

1. Open the `.dmg` file.
2. Drag **AX Code** into **Applications**.
3. Launch **AX Code** from Applications.

If macOS says the app is damaged, run this in Terminal after installing:

```bash
xattr -cr "/Applications/AX Code.app"
```

## Install On Windows

### Installer (recommended)

1. Download the latest `.exe` installer from the [Releases page](https://github.com/defai-digital/ax-code/releases).
2. Run the installer.
3. Start **AX Code** from the Start Menu or Desktop shortcut.

### Portable ZIP

1. Download the latest Windows `.zip` from Releases.
2. Extract the entire ZIP folder.
3. Run `AX Code.exe` from the extracted folder.

Do not run the executable directly from inside the ZIP viewer — extract first so the app can find its bundled resources.

If Windows SmartScreen warns about an unknown publisher, click **More info → Run anyway** only if you downloaded from the official [Releases page](https://github.com/defai-digital/ax-code/releases).

## Before You Start

Install and sign in to the AX Code CLI first:

```bash
ax-code --version
```

If `ax-code` is not found, install AX Code before launching AX Code Desktop. The desktop app manages the local UI runtime but needs the AX Code CLI available for coding sessions.

## Platform Capabilities

AX Code Desktop targets macOS and Windows first, but local model acceleration is intentionally platform-specific:

| Capability | macOS Apple Silicon | Windows x64 |
| --- | --- | --- |
| Desktop app | Supported | Supported |
| AX Code CLI/server integration | Supported | Supported |
| Hosted providers | Supported | Supported |
| AX Engine local provider | Supported on eligible Apple Silicon Macs | Not supported |

AX Engine uses the local MLX/Apple Silicon path. It can be enabled on supported macOS hosts through AX Code provider setup. Windows Desktop users should use hosted providers, OpenAI-compatible gateways, or a remote AX Code server running on a supported Mac when AX Engine is required.

## First Run

On first launch:

1. Confirm AX Code CLI is detected.
2. Add a project folder.
3. Start or select a chat session.
4. Use the Git, Files, Diff, Terminal, and Plan views as needed.

The app can run local AX Code sessions, connect to existing AX Code servers, and open focused mini-chat windows for active sessions.

## Updates

**macOS (Homebrew):**

```bash
brew upgrade --cask ax-code-desktop
```

**Windows / manual installs:** Download the latest installer or archive from the [Releases page](https://github.com/defai-digital/ax-code/releases). When auto-update metadata is available, the app can also check GitHub releases for updates automatically.

## What You Can Do

### Chat and Sessions

- Run AX Code chat sessions in a full workspace UI.
- Branch, fork, undo, and redo conversation turns.
- Queue messages and keep long-running sessions visible.
- Use plan/build workflows and project notes.
- Open mini-chat windows for focused work.

### Git and GitHub

- Stage files, commit, push, pull, merge, and rebase.
- Review diffs with inline or stacked views.
- Manage branches and worktrees.
- Create pull requests with generated descriptions.
- Recover from merge/rebase conflicts with guided UI state.

### Files and Terminal

- Browse and edit workspace files.
- Inspect large diffs without loading the whole workspace at once.
- Run integrated terminal sessions by project directory.
- Keep project actions and dev servers close to the chat context.

### Desktop

- Native desktop shell for macOS Apple Silicon and Windows x64.
- Multi-window workflows.
- Deep links and desktop menu actions.
- Local runtime management for the web UI.

## Platform Support

| Platform | Support | Install |
| --- | --- | --- |
| macOS Apple Silicon | Supported | Homebrew (recommended) or DMG |
| macOS Intel/x64 | Not supported | No artifact is built |
| Windows x64 | Supported | Installer or portable ZIP; AX Engine local provider is unavailable |
| Linux | Not supported | No artifact is built |
| Mobile/tablet browsers | Not supported | Blocked to reduce data-leakage risk |

## Security Notes

macOS users installing via Homebrew bypass Gatekeeper automatically — no extra steps needed.

For manual downloads, only use the official [Releases page](https://github.com/defai-digital/ax-code/releases). Release assets include detached `.minisig` signatures that can be verified with this pinned public key:

```text
RWS+dNbWPLZ6W9TH486c9zdH84NiiuFnm4VpVTRlXoMHClyQx/fY7W2A
```

Windows SmartScreen may warn about unsigned builds; click **More info → Run anyway** if you trust the source.

AX Code Desktop is intended for trusted desktop workstations. Do not expose the development web UI publicly.

## Development Web UI

The web package is the local UI substrate used by development and desktop packaging. It is not a supported end-user distribution mode.

From a development checkout:

```bash
pnpm install
pnpm run desktop:build
pnpm --filter ax-code-desktop run start -- --ui-password your-password
```

The web UI is available at `http://localhost:3000` by default.

## Development

Requirements:

- Node.js 24 or newer (`>=24`)
- pnpm 10.33.4 (`corepack enable`)
- AX Code CLI

Useful commands:

```bash
pnpm install
pnpm run desktop:typecheck
pnpm run desktop:lint
pnpm run desktop:test
pnpm run desktop:build
node desktop/packages/electron/scripts/package.mjs --mac zip --publish=never
```

Package layout:

| Package | Purpose |
| --- | --- |
| `packages/ui` | Shared React UI, stores, hooks, and components |
| `packages/web` | Local web runtime used by development and desktop packaging |
| `packages/electron` | Desktop shell (Electron) |

## Legacy Compatibility Notes

AX Code Desktop is the user-facing product name. Some internal package names,
storage keys, environment variables, endpoint paths, and config directories
still use `openchamber` so existing installs and migrated data continue to work.

Treat those names as legacy compatibility details, not as the public product
identity for new docs, releases, or UI copy.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

MIT. AX Code Desktop is maintained by DEFAI Private Limited.

This project includes software derived from OpenChamber. Upstream attribution is
kept in [NOTICE](./NOTICE) for provenance and license compliance; public product
branding should use AX Code Desktop.

GitHub may display upstream OpenChamber contributors in repository contributor
widgets. Those accounts are credited for upstream work and are not necessarily
maintainers of, or direct contributors to, AX Code Desktop.
