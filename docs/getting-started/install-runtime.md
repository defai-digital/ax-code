# Installation and Runtime Channels

Status: Active
Scope: current-state
Last reviewed: 2026-08-10
Owner: ax-code runtime

The root [README](../../README.md) keeps the primary install path. This page is the source of truth for supported CLI installer channels, `ax-code doctor` runtime labels, local launcher behavior, and how those channels relate to Desktop installers.

## Recommended Path

Use a supported packaged installer unless you are developing from a checkout. Prefer Homebrew on macOS and the native PowerShell installer on Windows for the CLI.

```bash
# Homebrew (macOS CLI)
brew install defai-digital/tap/ax-code

# GitHub release installer (Windows PowerShell)
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1 | iex"

# Bash installer (Linux glibc, Ubuntu 24.04+ amd64/arm64)
curl -fsSL https://raw.githubusercontent.com/defai-digital/ax-code/main/install | bash
```

One-line remote execution is a convenience path. The Windows installer verifies the downloaded CLI ZIP with minisign after it starts, but `irm | iex` does not verify `install.ps1` itself before execution.

If `minisign` is not already on PATH, the PowerShell installer **bootstraps a pinned official minisign build** (SHA-256 verified) into a local tools cache and uses it only for release verification. You do not need to install minisign manually for the default install path.

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

Supported user installs should report `Runtime: Node vX.Y.Z (node-bundled)` on macOS Homebrew, Windows, and Linux (glibc).

Desktop is installed through separate platform-specific channels:

- macOS: `brew install --cask defai-digital/tap/ax-code-desktop`
- Windows x64: download and run the latest `AX-Code-<version>-win-x64.exe` from GitHub Releases.
- Windows ARM64: download and run the latest `AX-Code-<version>-win-arm64.exe` from GitHub Releases.
- Linux amd64: download `AX-Code-<version>-linux-amd64.deb` (Ubuntu) or `AX-Code-<version>-linux-x86_64.AppImage` (portable) from a `desktop-v*` GitHub Release.
- Linux arm64: download `AX-Code-<version>-linux-arm64.deb` or `AX-Code-<version>-linux-arm64.AppImage` from a `desktop-v*` GitHub Release.

The Windows PowerShell `install.ps1` and Linux bash `install` scripts install the CLI only; they do not install the Desktop app.

Windows Desktop installers are Authenticode-signed by **DEFAI Private Limited**. SmartScreen may still warn while a new build develops download reputation, but the prompt must identify that expected publisher. Do not run an installer shown as **Unknown publisher**; use `Get-AuthenticodeSignature` as documented in the Desktop README when an explicit signature check is required.

## Channel Matrix

| Channel                              | Install or setup command                                                                                                                            | Expected runtime label | Support status       | Use when                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------- | ------------------------------------------------------------------ |
| Homebrew formula                     | `brew install defai-digital/tap/ax-code`                                                                                                            | `node-bundled`         | Supported            | Normal macOS package-manager install path                          |
| Windows PowerShell release installer | `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1 \| iex"` | `node-bundled`         | Supported on Windows | Windows user-local install path                                    |
| Windows release assets               | Download `ax-code-windows-*.zip` from GitHub releases                                                                                               | `node-bundled`         | Manual               | Manual CLI validation or troubleshooting                           |
| Linux bash release installer         | `curl -fsSL https://raw.githubusercontent.com/defai-digital/ax-code/main/install \| bash`                                                           | `node-bundled`         | Supported on Linux   | Ubuntu 24.04+ (glibc) amd64/arm64 user-local install path          |
| Linux release assets                 | Download `ax-code-linux-*.tar.gz` from GitHub releases                                                                                              | `node-bundled`         | Manual               | Manual CLI validation or troubleshooting                           |
| Local bundled launcher               | `pnpm install && pnpm run setup:cli`                                                                                                                | `node-bundled`         | Contributor          | Contributor parity with the packaged startup path                  |
| Local source launcher                | `pnpm run setup:cli -- --source`                                                                                                                    | `source`               | Contributor          | Contributor-only source debugging                                  |
| Direct checkout run                  | `pnpm cli` or `pnpm dev`                                                                                                                            | `source`               | Contributor          | Short-lived development runs without replacing the global launcher |

`node-bundled` and `source` are runtime modes, not package-manager names. They describe which executable loads the app code:

- `node-bundled`: Node.js loads the bundled release runtime (all supported user install channels).
- `source`: Node loads files directly from a checkout.

`compiled` and `bun-bundled` are retired Bun-era runtime modes, retained only for legacy diagnostics. They are not supported user install channels.

## Platform Policy

- macOS: use Homebrew as the documented user path. Contributor builds use `pnpm run setup:cli`.
- Use fully qualified shared-tap commands such as `brew install defai-digital/tap/ax-code`. Homebrew taps
  `defai-digital/tap` automatically, so the same one-line form works for users and CI.
- Linux CLI: use the bash installer for Ubuntu Desktop/Server **24.04 LTS** and newer on **amd64** and **arm64** (glibc). Release builds produce `ax-code-linux-x64.tar.gz` and `ax-code-linux-arm64.tar.gz` on Ubuntu 24.04 runners so the glibc baseline stays compatible with 24.04+. Musl (Alpine) is not supported by current release archives.
- Linux Desktop: `desktop-v*` releases publish `.deb` and AppImage for **amd64/x86_64** and **arm64** (Ubuntu 24.04 glibc baseline). AppImage is the Linux auto-update channel (`latest-linux.yml` / `latest-linux-arm64.yml`). Install the CLI separately; Desktop sessions still require the local AX Code runtime.
- macOS CLI archives: release builds publish `darwin-arm64` only (Apple Silicon). Intel macOS is not a supported install target for current CLI/Desktop packages.
- Windows CLI: use the native PowerShell installer. It installs the GitHub release asset into a user-local directory and updates the user PATH unless `-NoModifyPath` is provided. It verifies the downloaded ZIP with the pinned public key before extraction and fails closed unless `AX_CODE_SKIP_MINISIGN_VERIFY=1` is set intentionally. If `minisign` is missing, the installer bootstraps a pinned official build into `%LOCALAPPDATA%\ax-code\tools\minisign`. Use `-Uninstall` to remove the user-local install and PATH entry.
- Windows Desktop: use the signed Electron installer from GitHub Releases, named `AX-Code-<version>-win-x64.exe` or `AX-Code-<version>-win-arm64.exe`. The expected Authenticode publisher is `DEFAI Private Limited`. Do not describe `install.ps1` as a Desktop installer. Silent install: `.\AX-Code-<version>-win-x64.exe /S` (NSIS).
- Winget: package manifests are generated with `pnpm exec tsx tools/winget/generate-manifests.ts --version <ver>` and submitted to `microsoft/winget-pkgs` (see `tools/winget/README.md`). Until published upstream, GitHub Releases remain the Windows install source of truth.
- npm: not a supported install or upgrade channel.

One-line remote execution is a convenience path, not the only path. Keep an inspectable (and, on Windows, minisign-verified) installer flow in the docs, use pinned versions in CI, and document platform installers only with install-matrix coverage that verifies `ax-code --version` and verifies `ax-code doctor` reports the expected runtime mode for that platform.

## Enterprise and unattended installs

### Windows Desktop (NSIS)

```powershell
# Silent install (no UI). /D= must be last when used.
.\AX-Code-<version>-win-x64.exe /S
.\AX-Code-<version>-win-x64.exe /S /D=C:\Program Files\AX Code
```

- Confirm Authenticode publisher **DEFAI Private Limited** before deploying broadly.
- Disable in-app auto-update on managed fleets with `AX_CODE_DESKTOP_DISABLE_AUTO_UPDATE=1`.
- Uninstall via **Settings → Apps** or the Start Menu uninstall entry.
- MSI/MSIX is not published yet; use NSIS silent install or the portable ZIP for offline/air-gapped hosts.

### Windows CLI (user-local, no admin)

```powershell
# Pin version in CI/images
$env:AX_CODE_VERSION = "7.4.0"
irm https://github.com/defai-digital/ax-code/releases/download/v$env:AX_CODE_VERSION/install.ps1 -OutFile install.ps1
# Optional: verify install.ps1.minisig first (see SECURITY.md)
.\install.ps1 -Version $env:AX_CODE_VERSION -NoModifyPath
# Then add %USERPROFILE%\.ax-code\bin to the machine/user PATH via your MDM.
```

### macOS (Homebrew / MDM)

Prefer the Homebrew formula and cask on managed Macs so updates track the taps:

```bash
brew install defai-digital/tap/ax-code
brew install --cask defai-digital/tap/ax-code-desktop
```

For MDM-packaged DMG installs, use the notarized `AX-Code-*-mac-arm64.dmg` from GitHub Releases and verify the detached `.minisig` when policy requires supply-chain checks.

### Winget (after community packages are published)

Stable CLI and Desktop releases attach generated winget manifest zips as release assets (`winget-cli-manifests-*.zip`, `winget-desktop-manifests-*.zip`). Maintainers submit those to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs). Until packages appear in the community repo, install from GitHub Releases as above.

## Updating

For supported packaged channels:

```bash
ax-code upgrade
brew upgrade ax-code
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1 | iex"
curl -fsSL https://raw.githubusercontent.com/defai-digital/ax-code/main/install | bash
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
