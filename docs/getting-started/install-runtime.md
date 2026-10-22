# Installation and Runtime Channels

Status: Active
Scope: current-state
Last reviewed: 2026-10-22
Owner: ax-code runtime

Choose the Desktop app for a graphical workspace, or CLI-only for terminal, SSH, and CI workflows. The commands below follow the Desktop and CLI READMEs. Later sections cover CLI runtime labels from `ax-code doctor`, manual verification, upgrades, and contributor launchers.

## Public availability

Public release installers and signed runtime archives are distributed through
`download.ax-code.com`. The same files are also available under `download.automatosx.com/ax-code/`, which the install commands below use. Installation does not require private GitHub credentials.

AX Code and the SDK support **Node.js 26 or later only**. Standalone installers bundle
a verified Node runtime. Source checkouts and Node-based SDK applications must supply
Node.js 26+; package installation rejects older Node versions.

AX Code Standard remains free for personal and commercial use under its existing license.
Development source access is managed separately from public distribution. The
planned proprietary Business components have separate licensing; this does not change
Standard's license. See [Standard and Business](editions.md) for details and the
[website guide](https://ax-code.app/en/download/) for public installation updates.
Public installers and their signed assets must be reachable and verified before the
website advertises a one-line installation command.

## Release availability

Pushing a `vMAJOR.MINOR.PATCH` git tag starts the Release workflow. The
[public release index](https://download.ax-code.com/releases.json) list only shows a
version after that workflow has signed assets and published. Until then, Latest
stays on the previous published tag. After validate succeeds, maintainers can
see a Draft for the new tag; it is not public Latest.

For existing installations, follow [Upgrade and recovery](upgrade.md).

## Desktop installation

The **Desktop app is the recommended setup** for a graphical workspace. It includes a pinned AX Code runtime; you do not need to install the CLI or Node.js separately. Close AX Code before running the installer. macOS and Ubuntu may ask for an administrator password.

### Desktop on macOS

Use macOS 13 or newer on Apple Silicon. Open AX Code from Applications after installation.

```bash
curl -fsSL https://download.automatosx.com/ax-code-desktop/install | bash
```

### Desktop on Windows

Use Windows AMD64 (x64) and PowerShell 5.1 or newer. Confirm the installer publisher is **DEFAI Private Limited**, then open AX Code from the Start Menu.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://download.automatosx.com/ax-code-desktop/install.ps1 | iex"
```

### Desktop on Ubuntu

Use Ubuntu Desktop 24.04 or newer on amd64 or arm64. Open AX Code from the app menu after installation.

```bash
curl -fsSL https://download.automatosx.com/ax-code-desktop/install | bash
```

Add a project folder, configure a model provider in the app, and start or select a session. Review the diff and project checks before committing. See the [Desktop README](https://github.com/defai-digital/ax-code-desktop#install) for manual packages and [Minisign verification](https://github.com/defai-digital/ax-code-desktop/blob/main/desktop/docs/MINISIGN.md).

Desktop and the standalone CLI update independently. Updating the CLI does not replace the app's bundled runtime. See [upgrade and recovery](upgrade.md#desktop-app).

<span id="recommended-path"></span>

## CLI-only installation

The following commands install **CLI-only**, including the terminal UI. This is an independent option for terminal, SSH, or CI work; it is not a prerequisite for Desktop. The standalone installer supplies a verified Node runtime. Use Bash on macOS or Ubuntu and native PowerShell on Windows.

### macOS (Apple Silicon)

```bash
curl -fsSL https://download.automatosx.com/ax-code/install | bash
```

### Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://download.automatosx.com/ax-code/install.ps1 | iex"
```

### Ubuntu 24.04+

Install the system dependencies first, including `libatomic1` for the bundled Node runtime:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl libatomic1
curl -fsSL https://download.automatosx.com/ax-code/install | bash
```

Minimal Ubuntu images may omit `libatomic1`. If installation reports that `libatomic.so.1` is missing, install `libatomic1` with the command above and rerun the installer. The installer verifies that the bundled runtime starts before activating it.

If `download.automatosx.com` does not resolve, check your network and DNS settings. For CLI-only installation, the original host serves the same signed files:

```bash
curl -fsSL https://download.ax-code.com/install | bash
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://download.ax-code.com/install.ps1 | iex"
```

Homebrew remains a supported alternative for the macOS CLI:

```bash
brew tap defai-digital/tap
brew trust defai-digital/tap
brew install defai-digital/tap/ax-code
```

Homebrew requires explicit trust for non-official taps. This whole-tap trust covers all current and future formulae,
casks, and external commands published in `defai-digital/tap`. The shared tap contains both the CLI formula and the
Desktop cask, and Homebrew can load both definitions while resolving an install. Use the release installer instead if
whole-tap trust is not acceptable.

### Move an existing installation from the legacy tap

`defai-digital/ax-code` is now a migration-only tap. AX Code releases update only
`defai-digital/tap`. If you installed from the legacy tap, add the shared tap
before updating so Homebrew can move the installed package's tap ownership:

```bash
brew tap defai-digital/tap
brew trust --formula defai-digital/tap/ax-code
brew update
brew upgrade defai-digital/tap/ax-code
brew info defai-digital/tap/ax-code
```

After confirming the installation uses the shared tap, remove the legacy tap:

```bash
brew untap defai-digital/ax-code
```

If Homebrew still reports the old tap, run
`brew reinstall defai-digital/tap/ax-code` before untapping it. The legacy
repository remains accessible for existing installations to discover migration.

### Verify a version-pinned Unix installer

For an inspected, version-pinned Unix installation, first download the installer and
its signature from the same release. With a trusted `minisign` already available:

```bash
AX_INSTALL_VERSION="<release>"
AX_INSTALL_BASE="https://download.ax-code.com/releases/download/v${AX_INSTALL_VERSION}"
curl -fsSL "$AX_INSTALL_BASE/install" -o ax-code-install
curl -fsSL "$AX_INSTALL_BASE/install.minisig" -o ax-code-install.minisig
minisign -Vm ax-code-install -x ax-code-install.minisig -P 'RWSlDu++afxCz01OqhYWhfo8+L8pVbSYXJBEb2zoWBuK0WACIzbGVZRO'
# Inspect ax-code-install before running it.
bash ax-code-install --version "$AX_INSTALL_VERSION" --no-modify-path
```

The archive's signature does not authenticate the bootstrap script before execution.
A digest downloaded from the same origin detects corruption but is not an independent
publisher identity check. The one-line path relies on the HTTPS distribution endpoint.

One-line remote execution is a convenience path. The Windows installer verifies the downloaded CLI ZIP with minisign after it starts, but `irm | iex` does not verify `install.ps1` itself before execution.

If `minisign` is not already on PATH, the PowerShell installer downloads the pinned minisign 0.12 archive from `download.ax-code.com`, checks its SHA-256, and checks the extracted executable again before caching it. You do not need to install minisign manually for the default install path. A `minisign` binary already on PATH is used as-is.

For security-sensitive environments, download the installer, verify it with minisign, inspect it, and pin the release version used by CI:

```powershell
$AX_CODE_VERSION = "<release>"
$AxCodeMinisignPublicKey = "RWSlDu++afxCz01OqhYWhfo8+L8pVbSYXJBEb2zoWBuK0WACIzbGVZRO"
irm https://download.automatosx.com/ax-code/install.ps1 -OutFile ax-code-install.ps1
irm https://download.automatosx.com/ax-code/install.ps1.minisig -OutFile ax-code-install.ps1.minisig
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

Supported user installs should report `Runtime: Node vX.Y.Z (node-bundled)` on macOS, Windows, and Linux (glibc).

The CLI commands above install the standalone CLI/TUI. For the app and its bundled runtime, use the separate [Desktop installation](#desktop-installation).

## Channel Matrix

| Channel                              | Install or setup command                                                                                                  | Expected runtime label | Support status       | Use when                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------- | ------------------------------------------------------------------ |
| macOS bash release installer         | `curl -fsSL https://download.automatosx.com/ax-code/install \| bash`                                                      | `node-bundled`         | Supported on macOS   | Primary Apple Silicon user-local install path                      |
| Homebrew formula                     | `brew tap defai-digital/tap && brew trust defai-digital/tap && brew install defai-digital/tap/ax-code`                    | `node-bundled`         | Supported            | Alternative macOS package-manager install path                     |
| Windows PowerShell release installer | `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://download.automatosx.com/ax-code/install.ps1 \| iex"` | `node-bundled`         | Supported on Windows | Windows user-local install path                                    |
| Windows release assets               | Download `ax-code-windows-*.zip` from the public release index                                                            | `node-bundled`         | Manual               | Manual CLI validation or troubleshooting                           |
| Linux bash release installer         | `curl -fsSL https://download.automatosx.com/ax-code/install \| bash`                                                      | `node-bundled`         | Supported on Linux   | Ubuntu 24.04+ (glibc) amd64/arm64 user-local install path          |
| Linux release assets                 | Download `ax-code-linux-*.tar.gz` from the public release index                                                           | `node-bundled`         | Manual               | Manual CLI validation or troubleshooting                           |
| Local bundled launcher               | `pnpm install && pnpm run setup:cli`                                                                                      | `node-bundled`         | Contributor          | Contributor parity with the packaged startup path                  |
| Local source launcher                | `pnpm run setup:cli -- --source`                                                                                          | `source`               | Contributor          | Contributor-only source debugging                                  |
| Direct checkout run                  | `pnpm cli` or `pnpm dev`                                                                                                  | `source`               | Contributor          | Short-lived development runs without replacing the global launcher |

`node-bundled` and `source` are runtime modes, not package-manager names. They describe which executable loads the app code:

- `node-bundled`: Node.js loads the bundled release runtime (all supported user install channels).
- `source`: Node loads files directly from a checkout.

`compiled` and `bun-bundled` are retired Bun-era runtime modes, retained only for legacy diagnostics. They are not supported user install channels.

`pnpm dev` and `pnpm cli` compile the workspace SDK (`packages/sdk/js`) to `dist` with the repo TypeScript before launching, so a fresh checkout runs without a manual SDK build. The step invokes `typescript/bin/tsc` through `node` directly, so it does not depend on `node_modules/.bin` being linked. The bundled paths (`pnpm run setup:cli` and `pnpm --dir packages/ax-code run build`) still need `pnpm --dir packages/sdk/js run build` first.

## Platform Policy

- macOS: use the bash release installer as the primary documented CLI path. It installs under `~/.ax-code`, bootstraps pinned Minisign when needed, verifies the release archive, and does not require Homebrew. Local inference is optional; install AX Engine separately when needed. Contributor builds use `pnpm run setup:cli`.
- The supported Homebrew path explicitly taps and trusts `defai-digital/tap` before using fully qualified install
  commands. Whole-tap trust includes all current and future formulae, casks, and external commands in the shared tap;
  use the bash release installer when that trust scope is not acceptable.
- Linux CLI: use the bash installer for Ubuntu Desktop/Server **24.04 LTS** and newer on **amd64** and **arm64** (glibc). Release builds produce `ax-code-linux-x64.tar.gz` and `ax-code-linux-arm64.tar.gz` on Ubuntu 24.04 runners so the glibc baseline stays compatible with 24.04+. Musl (Alpine) is not supported by current release archives.
- macOS CLI archives: release builds publish `darwin-arm64` only (Apple Silicon). Intel macOS is not a supported install target for current CLI/Desktop packages.
- Windows CLI: use the native PowerShell installer on AMD64 (x64) hosts. Starting with v7.24.6, Windows ARM64 is not supported; the installer rejects ARM hosts before downloading or changing an existing installation. Historical ARM64 release archives remain available at their original version URLs. It installs the GitHub release asset into a user-local directory and updates the user PATH unless `-NoModifyPath` is provided. It verifies the downloaded ZIP with the pinned public key before extraction and fails closed unless `AX_CODE_SKIP_MINISIGN_VERIFY=1` is set intentionally. If `minisign` is missing, the installer downloads the pinned minisign 0.12 archive from `download.ax-code.com` into `%LOCALAPPDATA%\ax-code\tools\minisign` and checks the extracted executable before caching it. A `minisign` binary already on PATH is used as-is. Use `-Uninstall` to remove the user-local install and PATH entry.
- Windows Desktop: AMD64 (x64) only. Use the Desktop PowerShell command above, which downloads the signed app installer. The CLI PowerShell command installs the standalone CLI/TUI. For manual installation, use `AX-Code-<version>-win-x64.exe` from [Desktop releases](https://github.com/defai-digital/ax-code-desktop/releases/latest). The expected Authenticode publisher is `DEFAI Private Limited`. Silent install: `.\AX-Code-<version>-win-x64.exe /S` (NSIS).
- Winget: package manifests are generated with `pnpm exec tsx tools/winget/generate-manifests.ts --version <ver>` and submitted to `microsoft/winget-pkgs` (see `tools/winget/README.md`). Until published upstream, GitHub Releases remain the Windows install source of truth.
- npm: not a supported install or upgrade channel.

One-line remote execution is a convenience path, not the only path. Keep an inspectable (and, on Windows, minisign-verified) installer flow in the docs, use pinned versions in CI, and document platform installers only with install-matrix coverage that verifies `ax-code --version` and verifies `ax-code doctor` reports the expected runtime mode for that platform.

## Enterprise and unattended installs

### Windows CLI (user-local, no admin)

```powershell
# Pin version in CI/images
$env:AX_CODE_VERSION = "<release>"
irm https://download.ax-code.com/releases/download/v$env:AX_CODE_VERSION/install.ps1 -OutFile install.ps1
# Optional: verify install.ps1.minisig first (see SECURITY.md)
.\install.ps1 -Version $env:AX_CODE_VERSION -NoModifyPath
# Then add %USERPROFILE%\.ax-code\bin to the machine/user PATH via your MDM.
```

### macOS (user-local / Homebrew / MDM)

Use the release installer for a user-local CLI installation without Homebrew:

```bash
curl -fsSL https://download.automatosx.com/ax-code/install | bash
```

#### Optional local-model runtime (ax-engine)

AX Code does not ship the ax-engine local-model runtime. On an Apple Silicon Mac with at least 32 GB of
unified memory (the smallest managed model, Swift 27B, needs 32 GB; Tiel Coder 35B needs 48 GB), a first interactive install asks once whether to install it (default: no). The installer
never asks in CI, non-interactive shells, upgrades, or when ax-engine is already installed, and it never
downloads model weights. The answer is remembered in `~/.ax-code/state/engine-prompted`.

```bash
# install it without being asked
curl -fsSL https://download.automatosx.com/ax-code/install | bash -s -- --with-engine
# never ask
curl -fsSL https://download.automatosx.com/ax-code/install | bash -s -- --no-engine
# environment form (flags win): AX_CODE_INSTALL_ENGINE=1 or 0
```

The installer runs `ax-code providers ax-engine install`, which verifies the download. A failed engine step
does not fail the AX Code installation. To install it later, run that command, use
`brew install defai-digital/tap/ax-engine`, or download a release from
[github.com/defai-digital/ax-engine](https://github.com/defai-digital/ax-engine/releases).

Managed Macs can use the Homebrew formula so CLI updates track the tap:

```bash
brew tap defai-digital/tap
brew trust defai-digital/tap
brew install defai-digital/tap/ax-code
```

For managed Desktop installs, use the notarized `AX-Code-*-mac-arm64.dmg` from [Desktop releases](https://github.com/defai-digital/ax-code-desktop/releases/latest) and verify the detached `.minisig` before installation.

### Winget availability

Use the public installer unless a verified community CLI package is available.
Do not assume GitHub-hosted manifest bundles are anonymously accessible.

## Updating

Choose the channel that owns the active installation:

| Installed with               | Update                                                               |
| ---------------------------- | -------------------------------------------------------------------- |
| Standalone Unix installer    | `ax-code upgrade`                                                    |
| Homebrew                     | `brew upgrade ax-code` (or `ax-code upgrade` from that installation) |
| Windows PowerShell installer | Re-run the PowerShell installer below                                |
| Contributor checkout         | Rebuild that checkout; source mode does not auto-upgrade             |

Existing legacy-tap users should follow the [shared tap migration](#move-an-existing-installation-from-the-legacy-tap). A second installation can shadow the
first on PATH; use `which -a ax-code`, `ax-code --version`, and `ax-code doctor` before
changing channels. Installing the standalone version does not uninstall Homebrew.
Move between channels only deliberately, and retain your session/configuration data.

Unix self-upgrades fetch the installer from the target release and require its SHA-256
sidecar. A missing installer or digest stops the upgrade; there is no mutable-main
fallback. To install an older archive from a release without installer assets, download
and verify a current released installer, then run it with `--version <older-version>`.

Standalone Unix installs use `~/.ax-code/bin/ax-code` as a stable symlink into a unique
runtime generation under `~/.ax-code/versions/`. The installer verifies the complete
new tree before switching that link. Reinstalling a version creates a fresh generation.
It retains old generations and legacy runtime files so already running agents can
continue loading their own modules. It does not restart running agents. Start a new
client/runtime to use the new version; stop active work explicitly before a runtime
restart. Homebrew files remain managed by Homebrew.

For rollback, use a verified installer with `--version <previous-version>`. The `version`
file in each retained generation identifies its release. Old generations are not pruned
automatically; after stopping all processes using them, you may remove unused generations.
During uninstall, retain sessions/configuration with `--keep-data --keep-config` if needed;
follow the binary-removal guidance and separately remove unused runtime generations only
after their processes stop. Do not delete the entire `.ax-code` folder if you have stored
other configuration or personal files there.

A concurrent Unix installation fails with the `.install-lock` directory location. An
abruptly killed installer may leave that empty directory. Check for active installers
before removing a stale lock and retrying; do not remove it while an install is running.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://download.automatosx.com/ax-code/install.ps1 | iex"
```

On Windows this updates the CLI. To remove the CLI install and its user PATH entry:

```powershell
irm https://download.automatosx.com/ax-code/install.ps1 -OutFile ax-code-install.ps1
.\ax-code-install.ps1 -Uninstall
```

## Contributor Launcher Behavior

This section requires an authorized source checkout. It is not needed for public
installation or upgrades; see [Source access](source-access.md).

`pnpm run setup:cli` is intentionally compiled-path by default. It builds or reuses the local bundled binary under `packages/ax-code/dist/...` and installs a global launcher that points at that binary. This keeps local packaged-runtime checks close to what Homebrew and curl-installer users run.

That launcher usually lands in `~/.local/bin` or `PNPM_HOME`, which is typically earlier on PATH than Homebrew. If Homebrew already provides `ax-code`, `setup:cli` installs the checkout as `ax-code-src` and removes a previously written `ax-code` wrapper so `brew upgrade ax-code` keeps updating the `ax-code` command. Use `pnpm run setup:cli -- --override-homebrew` only when you intentionally want the checkout to take over `ax-code`. `ax-code doctor` still warns about that override as `PATH launchers`.

After source changes that should affect the packaged runtime, refresh the bundled binary before testing the global launcher:

```bash
pnpm --dir packages/ax-code run build -- --single
pnpm run setup:cli -- --rebuild
ax-code-src --version   # or `ax-code` if Homebrew is not installed
```

Use the source launcher only when you intentionally want the checkout command to execute this checkout through Node from source files:

```bash
pnpm run setup:cli -- --source
ax-code-src doctor      # or `ax-code doctor` if Homebrew is not installed
```

The source launcher should report `Runtime: Node vX.Y.Z (source)`.

## Toolchain Requirements

The repository enforces `pnpm@10.33.4` through the root `packageManager` field and `only-allow pnpm`: the `preinstall` hook blocks non-pnpm installs, and root `pre<script>` hooks block `npm run <script>` with the same requirement. Node.js must match the root `package.json` engine (`>=26`), which also provides `--experimental-ffi` for source-mode TUI commands.

Source installs fetch `@defai-digital/ax-tui` from GitHub Packages. Before `pnpm install`, configure your user-level `~/.npmrc` with `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` and set `NODE_AUTH_TOKEN` through your secret manager to a classic GitHub PAT with `read:packages`. The committed `.npmrc` selects the GitHub registry for the `@defai-digital` scope; other dependencies use their normal registry. GitHub Actions uses its job token with `packages: read` in a restricted temporary npm configuration file. Standalone runtime users do not need registry credentials.

Do not use root `pnpm test`; the root script intentionally exits with `do not run tests from root`. For `packages/ax-code`, run tests from `packages/ax-code/`.

Homebrew installations receive update notifications without automatic background upgrades. Finish active agent runs before explicitly upgrading or cleaning old Homebrew kegs.
