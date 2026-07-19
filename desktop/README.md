# AX Code Desktop

AX Code Desktop is the desktop UI for [AX Code](https://github.com/defai-digital/ax-code). It gives AX Code users a full workspace interface for chat sessions, file review, diffs, Git operations, terminals, project notes, and multi-agent workflows.

## Repository and Release Policy

AX Code Desktop source code lives in the AX Code monorepo at
[`github.com/defai-digital/ax-code/tree/main/desktop`](https://github.com/defai-digital/ax-code/tree/main/desktop).
The standalone Desktop source repository has been retired and is no longer the
source of truth.

Desktop releases use `desktop-v*` tags and publish artifacts to the main
[`defai-digital/ax-code` Releases page](https://github.com/defai-digital/ax-code/releases).
The Homebrew cask remains in the separate
[`defai-digital/homebrew-ax-code-desktop`](https://github.com/defai-digital/homebrew-ax-code-desktop)
tap because Homebrew taps are distribution indexes, not source-code repositories.

## Install On macOS

The recommended way to install on macOS is via Homebrew:

```bash
brew tap defai-digital/ax-code
brew tap defai-digital/ax-code-desktop
brew install ax-code                  # CLI/runtime
brew install --cask ax-code-desktop   # Desktop app
```

The Desktop cask token is `ax-code-desktop`. It must differ from the `ax-code` CLI formula name: Homebrew
refuses to link a formula while an installed cask shares its token, so the short-lived `ax-code` cask token
left the CLI missing from PATH after formula upgrades. Installs of the old token are migrated to
`ax-code-desktop` automatically on their next `brew upgrade`.

To update:

```bash
brew upgrade ax-code
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

1. Download the appropriate `.exe` installer from the [Releases page](https://github.com/defai-digital/ax-code/releases):
   - Intel/AMD Windows: `AX-Code-<version>-win-x64.exe`
   - Windows on Arm: `AX-Code-<version>-win-arm64.exe`
2. Confirm Windows identifies the publisher as **DEFAI Private Limited**.
3. Run the installer.
4. Start **AX Code** from the Start Menu or Desktop shortcut.

Silent / unattended install (NSIS):

```powershell
.\AX-Code-<version>-win-x64.exe /S
# Optional install directory:
.\AX-Code-<version>-win-x64.exe /S /D=C:\Program Files\AX Code
```

`/D=` must be the last argument when used. Uninstall from **Settings → Apps** or the Start Menu uninstall entry.

For an additional signature check, run the following from PowerShell in the download directory, replacing the example filename with the file you downloaded:

```powershell
$signature = Get-AuthenticodeSignature -LiteralPath ".\AX-Code-<version>-win-x64.exe"
$signature.Status
$signature.SignerCertificate.Subject
```

The status must be `Valid`, and the subject must contain `CN=DEFAI Private Limited`. Do not run the installer if the signature is missing, invalid, or belongs to another publisher.

### Portable ZIP

1. Download the latest Windows `.zip` from Releases.
2. Extract the entire ZIP folder.
3. Run `AX Code.exe` from the extracted folder.

Do not run the executable directly from inside the ZIP viewer — extract first so the app can find its bundled resources.

SmartScreen may still show **Windows protected your PC** for a correctly signed new release while that specific build develops download reputation. Select **More info → Run anyway** only after confirming the download came from the official Releases page and Windows shows **DEFAI Private Limited** as the publisher. If Windows reports **Unknown publisher**, do not run the file.

## Before You Start

AX Code Desktop needs the local AX Code CLI/runtime for coding sessions. The root
README shows the paired install commands for the CLI and Desktop app. Before
starting a session, verify the CLI is available:

```bash
ax-code --version
```

If `ax-code` is not found, install the AX Code CLI from the root README. The
desktop app manages the local UI runtime, but coding sessions still use the AX
Code CLI/server integration.

## Platform Capabilities

AX Code Desktop targets macOS and Windows first, but local model acceleration is intentionally platform-specific:

| Capability                     | macOS Apple Silicon                      | Windows x64 / ARM64 |
| ------------------------------ | ---------------------------------------- | ------------------- |
| Desktop app                    | Supported                                | Supported           |
| AX Code CLI/server integration | Supported                                | Supported           |
| Hosted providers               | Supported                                | Supported           |
| AX Engine local provider       | Supported on eligible Apple Silicon Macs | Not supported       |

AX Engine uses the local MLX/Apple Silicon path. It can be enabled on supported macOS hosts through AX Code provider setup. Windows Desktop users should use hosted providers or OpenAI-compatible provider gateways; remote AX Code servers are intentionally unsupported.

## First Run

On first launch:

1. Confirm AX Code CLI is detected.
2. Add a project folder.
3. Start or select a chat session.
4. Use the Git, Files, Diff, Terminal, and Plan views as needed.

The app runs AX Code sessions on the current machine and can open focused mini-chat windows for active sessions.

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

- Native desktop shell for macOS Apple Silicon and Windows x64 / ARM64.
- Multi-window workflows.
- Deep links and desktop menu actions.
- Local runtime management for the web UI.

## Platform Support

| Platform               | Support       | Install                                                            |
| ---------------------- | ------------- | ------------------------------------------------------------------ |
| macOS Apple Silicon    | Supported     | Homebrew (recommended) or DMG                                      |
| macOS Intel/x64        | Not supported | No artifact is built                                               |
| Windows x64            | Supported     | Installer or portable ZIP; AX Engine local provider is unavailable |
| Windows ARM64          | Supported     | Installer or portable ZIP; AX Engine local provider is unavailable |
| Linux                  | Not supported | No artifact is built                                               |
| Mobile/tablet browsers | Not supported | Blocked to reduce data-leakage risk                                |

## Security Notes

macOS users installing via Homebrew bypass Gatekeeper automatically — no extra steps needed.

For manual downloads, only use the official [Releases page](https://github.com/defai-digital/ax-code/releases). Release assets include detached `.minisig` signatures that can be verified with this pinned public key:

```text
RWSlDu++afxCz01OqhYWhfo8+L8pVbSYXJBEb2zoWBuK0WACIzbGVZRO
```

Windows Desktop releases are Authenticode-signed by **DEFAI Private Limited**, and release CI fails if signing or timestamp verification does not succeed. SmartScreen can still warn for a newly released, low-reputation file; a signed warning should identify the expected publisher, while **Unknown publisher** is a reason to stop. Release notes should state the expected first-run SmartScreen behavior. Detached minisign signatures verify release asset integrity, but they do not replace Windows SmartScreen reputation, Windows Authenticode signing, or macOS Gatekeeper/notarization trust.

AX Code Desktop is intended for trusted office workstations and offline environments. Its UI, managed server, SDK HTTP helpers, and native bridge servers are restricted to loopback addresses. SSH instance access, remote host switching, LAN binding, mDNS discovery, reverse-proxy deployment, and Cloudflare or other public tunnels are unsupported and disabled at runtime.

## Development Web UI

The web package is the local UI substrate used by development and desktop packaging. It is not a supported end-user distribution mode.

From a development checkout:

```bash
pnpm install
pnpm run desktop:build
pnpm --filter ax-code-desktop run start -- --ui-password your-password
```

The web UI prefers `http://localhost:3100` by default. If that port is busy, AX Code Desktop scans upward and uses the next safe free port.

## Development

Run development commands from the AX Code monorepo root.

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

| Package             | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `packages/ui`       | Shared React UI, stores, hooks, and components              |
| `packages/web`      | Local web runtime used by development and desktop packaging |
| `packages/electron` | Desktop shell (Electron)                                    |

## Legacy Compatibility Notes

AX Code Desktop is the user-facing product name. Some internal package names,
storage keys, environment variables, endpoint paths, and config directories
still use `openchamber` so existing installs and migrated data continue to work.

Treat those names as legacy compatibility details, not as the public product
identity for new docs, releases, or UI copy.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.
New source changes should be made in the AX Code monorepo, not in the retired
standalone Desktop source repository.

## License

[Apache License 2.0](./LICENSE). AX Code Desktop is maintained by DEFAI Private Limited.

This project includes software derived from OpenChamber; those portions remain
under the [MIT License](./LICENSE-MIT). Upstream attribution is kept in
[NOTICE](./NOTICE) for provenance and license compliance; public product
branding should use AX Code Desktop.

GitHub may display upstream OpenChamber contributors in repository contributor
widgets. Those accounts are credited for upstream work and are not necessarily
maintainers of, or direct contributors to, AX Code Desktop.
