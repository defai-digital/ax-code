# Installation and Runtime Channels

Status: Active
Scope: current-state
Last reviewed: 2026-05-26
Owner: ax-code runtime

The root [README](../README.md) keeps the shortest install path. This page is the source of truth for supported installer channels, `ax-code doctor` runtime labels, and local launcher behavior.

## Recommended Path

Use a supported compiled installer unless you are developing from a checkout. Prefer Homebrew on macOS and the native PowerShell installer on Windows.

```bash
# Homebrew (macOS)
brew install defai-digital/ax-code/ax-code

# GitHub release installer (Windows PowerShell)
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/defai-digital/ax-code/main/install.ps1 | iex"
```

For security-sensitive environments, inspect the installer before execution and pin the release version used by CI:

```powershell
$AX_CODE_VERSION = "<release>"
irm https://raw.githubusercontent.com/defai-digital/ax-code/main/install.ps1 -OutFile ax-code-install.ps1
Get-Content .\ax-code-install.ps1
.\ax-code-install.ps1 -Version $AX_CODE_VERSION -NoModifyPath
```

Verify the installed runtime:

```bash
ax-code doctor
```

Supported user installs should report `Runtime: Bun X.Y.Z (compiled)`.

## Channel Matrix

| Channel                              | Install or setup command                                                                                                                       | Expected runtime label | Support status       | Use when                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------- | ------------------------------------------------------------------ |
| Homebrew                             | `brew install defai-digital/ax-code/ax-code`                                                                                                   | `compiled`             | Supported            | Normal macOS package-manager install path                          |
| Windows PowerShell release installer | `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/defai-digital/ax-code/main/install.ps1 \| iex"` | `compiled`             | Supported on Windows | Windows user-local install path                                    |
| Windows release assets               | Download `ax-code-windows-*.zip` from GitHub releases                                                                                          | `compiled`             | Manual               | Manual validation or troubleshooting                               |
| Local bundled launcher               | `pnpm install && pnpm run setup:cli`                                                                                                           | `compiled`             | Contributor          | Contributor parity with the packaged startup path                  |
| Local source launcher                | `pnpm run setup:cli -- --source`                                                                                                               | `source`               | Contributor          | Contributor-only source debugging                                  |
| Direct checkout run                  | `pnpm cli` or `pnpm dev`                                                                                                                       | `source`               | Contributor          | Short-lived development runs without replacing the global launcher |

`compiled` and `source` are runtime modes, not package-manager names. They describe which executable loads the app code:

- `compiled`: a Bun single-file binary loads the runtime.
- `source`: Bun loads files directly from a checkout.

`bun-bundled` is retained only for legacy source-bundle diagnostics. It is not a supported user install channel.

## Platform Policy

- macOS: use Homebrew as the documented user path. Contributor builds use `pnpm run setup:cli`.
- Windows: use the native PowerShell installer. It installs the GitHub release asset into a user-local directory and updates the user PATH unless `-NoModifyPath` is provided. The Bash installer is not the canonical Windows user experience.
- npm: not a supported install or upgrade channel.

One-line remote execution is a convenience path, not the only path. Keep an inspectable installer flow in the docs, use pinned versions in CI, and document platform installers only with install-matrix coverage that verifies `ax-code --version`, verifies `ax-code doctor` reports `compiled`, and exercises the backend stdio health check.

## Updating

For supported compiled channels:

```bash
ax-code upgrade
brew upgrade ax-code
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/defai-digital/ax-code/main/install.ps1 | iex"
```

## Contributor Launcher Behavior

`pnpm run setup:cli` is intentionally compiled-path by default. It builds or reuses the local bundled binary under `packages/ax-code/dist/...` and installs a global launcher that points at that binary. This keeps local packaged-runtime checks close to what Homebrew and curl-installer users run.

After source changes that should affect the packaged runtime, refresh the bundled binary before testing the global launcher:

```bash
pnpm --dir packages/ax-code run build -- --single
pnpm run setup:cli -- --rebuild
ax-code doctor
```

Use the source launcher only when you intentionally want the global `ax-code` command to execute this checkout through Bun source files:

```bash
pnpm run setup:cli -- --source
ax-code doctor
```

The source launcher should report `Runtime: Bun X.Y.Z (source)`.

## Toolchain Requirements

The repository enforces `pnpm@10.33.4` through the root `packageManager` field and `only-allow pnpm`. Bun must match the root `package.json` engine (`^1.3.14` at this review).

Do not use root `pnpm test`; the root script intentionally exits with `do not run tests from root`. For `packages/ax-code`, run tests from `packages/ax-code/`.
