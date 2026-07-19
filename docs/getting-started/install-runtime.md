# Installation and Runtime Channels

Status: Active
Scope: current-state
Last reviewed: 2026-07-19
Owner: ax-code runtime

The root [README](../../README.md) keeps the primary install path. This page is the source of truth for supported CLI installer channels, `ax-code doctor` runtime labels, local launcher behavior, and how those channels relate to Desktop installers.

## Recommended Path

Use a supported packaged installer unless you are developing from a checkout. Prefer Homebrew on macOS, the Bash release installer on Linux, and the native PowerShell installer on Windows for the CLI.

```bash
# Homebrew (macOS CLI)
brew tap defai-digital/ax-code
brew install ax-code

# Bash release installer (Linux CLI)
curl -fsSL https://github.com/defai-digital/ax-code/releases/latest/download/install | bash

# GitHub release installer (Windows PowerShell)
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1 | iex"
```

One-line remote execution is a convenience path. The Windows installer verifies the downloaded CLI ZIP with minisign after it starts, but `irm | iex` does not verify `install.ps1` itself before execution.

If `minisign` is not already on PATH, the PowerShell and Bash installers **bootstrap a pinned official minisign build** (SHA-256 verified) into a local tools cache and use it only for release verification. You do not need to install minisign manually for the default install path.

For security-sensitive environments, download the installer, verify it with minisign, inspect it, and pin the release version used by CI:

```powershell
$AX_CODE_VERSION = "<release>"
$AxCodeMinisignPublicKey = "RWSlDu++afxCz01OqhYWhfo8+L8pVbSYXJBEb2zoWBuK0WACIzbGVZRO"
irm https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1 -OutFile ax-code-install.ps1
irm https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1.minisig -OutFile ax-code-install.ps1.minisig
# Optional: use a preinstalled minisign, or let install.ps1 bootstrap one when verifying the archive.
minisign -Vm ax-code-install.ps1 -x ax-code-install.ps1.minisig -P $AxCodeMinisignPublicKey
Get-Content .\ax-code-install.ps1
.\ax-code-install.ps1 -Version $AX_CODE_VERSION -NoModifyPath
```

Set `AX_CODE_SKIP_MINISIGN_VERIFY=1` only when you intentionally accept an unverifiable release download.

Verify the installed runtime:

```bash
ax-code doctor
```

Supported user installs should report `Runtime: Node vX.Y.Z (node-bundled)` on both macOS Homebrew and Windows.

Desktop is installed through separate platform-specific channels:

- macOS: `brew install --cask defai-digital/ax-code-desktop/ax-code`
- Windows x64: download and run the latest `AX-Code-<version>-win-x64.exe` from GitHub Releases.
- Windows ARM64: download and run the latest `AX-Code-<version>-win-arm64.exe` from GitHub Releases.

The Windows PowerShell `install.ps1` script installs the CLI only; it does not install the Desktop app.

Windows Desktop installers are Authenticode-signed by **DEFAI Private Limited**. SmartScreen may still warn while a new build develops download reputation, but the prompt must identify that expected publisher. Do not run an installer shown as **Unknown publisher**; use `Get-AuthenticodeSignature` as documented in the Desktop README when an explicit signature check is required.

## Channel Matrix

| Channel                              | Install or setup command                                                                                                                            | Expected runtime label | Support status       | Use when                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------- | ------------------------------------------------------------------ |
| Homebrew formula                     | `brew tap defai-digital/ax-code && brew install ax-code`                                                                                            | `node-bundled`         | Supported            | Normal macOS package-manager install path                          |
| Linux Bash release installer         | `curl -fsSL https://github.com/defai-digital/ax-code/releases/latest/download/install \| bash`                                                      | `node-bundled`         | Supported on Linux   | Linux x64/arm64 user and CI CLI install path                       |
| Windows PowerShell release installer | `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1 \| iex"` | `node-bundled`         | Supported on Windows | Windows user-local install path                                    |
| Windows release assets               | Download `ax-code-windows-*.zip` from GitHub releases                                                                                               | `node-bundled`         | Manual               | Manual CLI validation or troubleshooting                           |
| Local bundled launcher               | `pnpm install && pnpm run setup:cli`                                                                                                                | `node-bundled`         | Contributor          | Contributor parity with the packaged startup path                  |
| Local source launcher                | `pnpm run setup:cli -- --source`                                                                                                                    | `source`               | Contributor          | Contributor-only source debugging                                  |
| Direct checkout run                  | `pnpm cli` or `pnpm dev`                                                                                                                            | `source`               | Contributor          | Short-lived development runs without replacing the global launcher |

`node-bundled` and `source` are runtime modes, not package-manager names. They describe which executable loads the app code:

- `node-bundled`: Node.js loads the bundled release runtime (all supported user install channels).
- `source`: Node loads files directly from a checkout.

`compiled` and `bun-bundled` are retired Bun-era runtime modes, retained only for legacy diagnostics. They are not supported user install channels.

## Platform Policy

- macOS: use Homebrew as the documented user path. Contributor builds use `pnpm run setup:cli`.
- Fully qualified Homebrew commands such as `brew install defai-digital/ax-code/ax-code` are supported one-line
  equivalents and are useful for CI, but user-facing docs should prefer the clearer `brew tap ...` plus
  `brew install ax-code` form.
- Linux: use the Bash release installer (`install` script from GitHub Releases). It supports `linux-x64` and `linux-arm64` (including musl/baseline variants when detected). Requires `curl` and `tar`. Bootstraps pinned minisign when needed for signature verification.
- macOS CLI archives: release builds publish `darwin-arm64` only (Apple Silicon). Intel macOS is not a supported install target for current CLI/Desktop packages.
- Windows CLI: use the native PowerShell installer. It installs the GitHub release asset into a user-local directory and updates the user PATH unless `-NoModifyPath` is provided. Verifies the downloaded ZIP with the pinned public key before extraction (same fail-closed policy as the Bash installer, including `AX_CODE_SKIP_MINISIGN_VERIFY=1`). If `minisign` is missing, the installer bootstraps a pinned official build into `%LOCALAPPDATA%\ax-code\tools\minisign`. Use `-Uninstall` to remove the user-local install and PATH entry. The Bash installer is not the canonical Windows user experience.
- Windows Desktop: use the signed Electron installer from GitHub Releases, named `AX-Code-<version>-win-x64.exe` or `AX-Code-<version>-win-arm64.exe`. The expected Authenticode publisher is `DEFAI Private Limited`. Do not describe `install.ps1` as a Desktop installer. Silent install: `.\AX-Code-<version>-win-x64.exe /S` (NSIS).
- Winget: package manifests are generated with `pnpm exec tsx tools/winget/generate-manifests.ts --version <ver>` and submitted to `microsoft/winget-pkgs` (see `tools/winget/README.md`). Until published upstream, GitHub Releases remain the Windows install source of truth.
- npm: not a supported install or upgrade channel.

One-line remote execution is a convenience path, not the only path. Keep an inspectable (and, on Windows, minisign-verified) installer flow in the docs, use pinned versions in CI, and document platform installers only with install-matrix coverage that verifies `ax-code --version` and verifies `ax-code doctor` reports the expected runtime mode for that platform.

## Updating

For supported packaged channels:

```bash
ax-code upgrade
brew upgrade ax-code
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1 | iex"
```

On Windows this updates the CLI. To remove the CLI install and its user PATH entry:

```powershell
irm https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1 -OutFile ax-code-install.ps1
.\ax-code-install.ps1 -Uninstall
```

Desktop updates through the app auto-updater or by running the latest Windows Desktop `.exe` installer from GitHub Releases.

## Contributor Launcher Behavior

`pnpm run setup:cli` is intentionally compiled-path by default. It builds or reuses the local bundled binary under `packages/ax-code/dist/...` and installs a global launcher that points at that binary. This keeps local packaged-runtime checks close to what Homebrew and curl-installer users run.

After source changes that should affect the packaged runtime, refresh the bundled binary before testing the global launcher:

```bash
pnpm --dir packages/ax-code run build -- --single
pnpm run setup:cli -- --rebuild
ax-code doctor
```

Use the source launcher only when you intentionally want the global `ax-code` command to execute this checkout through Node from source files:

```bash
pnpm run setup:cli -- --source
ax-code doctor
```

The source launcher should report `Runtime: Node vX.Y.Z (source)`.

## Toolchain Requirements

The repository enforces `pnpm@10.33.4` through the root `packageManager` field and `only-allow pnpm`. Node.js must match the root `package.json` engine (`>=24`, `>=26` for source-mode TUI commands that use `--experimental-ffi`).

Do not use root `pnpm test`; the root script intentionally exits with `do not run tests from root`. For `packages/ax-code`, run tests from `packages/ax-code/`.
