# Upgrade and recovery

Status: Active
Scope: current-state
Last reviewed: 2026-10-17
Owner: AX Code maintainers

Desktop and CLI installations have independent update channels. Use the channel that owns the installation you want to update; no private GitHub token is required.

## Desktop app

In the app, choose **AX Code → Check for Updates**. On Windows and Linux, this item is in the AX Code menu. Follow the app's prompts, or close AX Code and rerun the [Desktop installer](install-runtime.md#desktop-installation). The installer keeps existing user data and credentials.

The app includes its own pinned runtime. Updating a separate CLI installation does not update that bundled runtime. The remaining CLI commands on this page apply to the standalone CLI/TUI.

## Check and update from the TUI

Type `/update` (alias `/upgrade`) or choose **Check for updates** in the command
palette. The dialog checks the release index, offers the new version, installs it
and tells you when to restart. The TUI also checks in the background about 30
seconds after launch, at most once a day. To check again sooner, run `/update`. Patch releases install automatically for the standalone installer;
minor and major releases and Homebrew installs only show the update dialog. Set
`autoupdate` to `false` or `"notify"` in the config, or `AX_CODE_DISABLE_AUTOUPDATE=1`,
to change that. Only one upgrade runs at a time across ax-code processes.

## Concurrent upgrades

If another upgrade is running, wait for it to finish and retry. An active upgrade
lock does not expire by elapsed time: a slow download or Homebrew installation
must keep exclusive ownership. Locks left by a terminated process on the same
host are recovered automatically.

If the busy message persists after a hostname change or when user state is shared
between hosts, run `ax-code debug paths` and inspect `upgrade.lock` in the reported
state directory. Confirm that no installation is running on the recorded host
before removing that lock. A reused or inaccessible PID also requires inspection;
lock age alone is not evidence that the installer has stopped.

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
curl -fsSL https://download.automatosx.com/ax-code/install | bash
```

On Windows, use PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://download.automatosx.com/ax-code/install.ps1 | iex"
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
