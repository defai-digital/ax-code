# Upgrade and recovery

Status: Active
Scope: current-state
Last reviewed: 2026-10-11
Owner: AX Code maintainers

Downloads and updates use the public `download.ax-code.com` origin. No private
GitHub token is required. Use the same installation channel you already use.

## Standalone installer users

Check your installation before upgrading:

```bash
ax-code --version
ax-code doctor
ax-code upgrade check --method curl
ax-code upgrade --method curl
```

Older versions may not have `upgrade check`, or may still request GitHub release
URLs. If an upgrade returns 404 or cannot find a release, run the current public
installer again. You do not need to uninstall AX Code or delete user data:

```bash
curl -fsSL https://download.ax-code.com/install | bash
```

On Windows, use PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://download.ax-code.com/install.ps1 | iex"
```

The installers replace runtime files; do not remove your configuration, credentials,
sessions or project state as an upgrade step. Back up important state before changing
versions. For manual script verification and pinned versions, see
[Installation and Runtime Channels](install-runtime.md#recommended-path).
The one-line commands execute the downloaded installer; runtime archive verification
uses the pinned Minisign key. Minisign remains the release signing mechanism.

## Homebrew users

Use the shared tap. The archived legacy tap contains a Homebrew migration map.
`brew update` applies that migration for existing installations:

```bash
brew tap defai-digital/tap
brew trust defai-digital/tap
brew update
brew upgrade defai-digital/tap/ax-code
```

Whole-tap trust covers all formulae, casks and external commands from this publisher.
See the [legacy tap migration guide](install-runtime.md#move-an-existing-installation-from-the-legacy-tap).
If Homebrew reports that the installed version is already current, no replacement
is needed. Do not mix Homebrew and standalone installations unless you deliberately
manage which launcher appears first on PATH.

## Confirm the active launcher

```bash
ax-code --version
ax-code doctor
which -a ax-code
```

On Windows, use `where.exe ax-code` in place of `which -a`. Restart the shell or run
`hash -r` on Unix if an old launcher is cached. An old executable earlier on PATH
can hide a successful installation. Inspect its location before removing anything.

## Troubleshooting and rollback

Read [release rollback](../release/rollback.md) to select a previously published
version. Public release inventory is available at
[download.ax-code.com/releases.json](https://download.ax-code.com/releases.json).
For installation help, use the [AX Code community](https://discord.gg/gf9UyPxaN2).
Never post credentials, private source, or unredacted session logs in a public channel.
