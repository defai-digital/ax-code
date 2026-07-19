# Sandbox Mode

Status: Active
Scope: current-state
Last reviewed: 2026-07-19
Owner: ax-code runtime

AX Code includes a built-in execution sandbox that restricts what the AI agent can do on your system. By default, AX Code starts in **workspace-write** with network disabled. Switch to `full-access` only when you intentionally want to disable sandbox boundaries.

## Quick Start

Toggle sandbox from the TUI:

- Type `/sandbox` in the prompt, or
- Press `Ctrl+P` and search "sandbox"

The status bar shows the current state:

- **sandbox on** (green) — agent confined to workspace
- **sandbox off** (red) — no restrictions

The setting persists across sessions in `ax-code.json`.

## What Changes

| Capability                           | Sandbox Off  | Sandbox On         |
| ------------------------------------ | ------------ | ------------------ |
| File writes inside workspace         | Allowed      | Allowed            |
| File writes outside workspace        | Allowed      | **Blocked**        |
| Writes to `.git/`                    | Allowed      | **Blocked**        |
| Writes to `.ax-code/`                | Allowed      | **Blocked**        |
| Bash commands                        | Unrestricted | **Workspace only** |
| Bash targeting `.git/`, `.ax-code/`  | Allowed      | **Blocked**        |
| Bash targeting outside workspace     | Allowed      | **Blocked**        |
| Network access (webfetch, websearch) | Allowed      | **Blocked**        |
| Bash network clients (curl, wget, …) | Allowed      | **Blocked**        |
| Read operations (read, glob, grep)   | Unrestricted | Unrestricted       |

## Configuration

### Source of Truth

This page summarizes user-facing behavior. When behavior changes, verify the docs against:

- `packages/ax-code/src/isolation/index.ts` for mode resolution, protected paths, network checks, write checks, bash checks, and `IsolationDeniedError`.
- `packages/ax-code/src/config/schema.ts` for config shape, defaults, and descriptions.
- `packages/ax-code/src/server/routes/isolation.ts` for runtime toggle behavior and persistence.
- `packages/ax-code/test/isolation/isolation.test.ts` and `packages/ax-code/test/tool/bash.test.ts` for expected enforcement behavior.

Keep duplicated claims in the root README brief and link back here for details.

### Toggle from the TUI

Use `/sandbox` or the command palette (`Ctrl+P` → "Turn sandbox on/off"). The change takes effect immediately and is saved to your project's `ax-code.json`.

### CLI Flag

```bash
ax-code --sandbox workspace-write   # sandbox on
ax-code --sandbox full-access       # sandbox off
ax-code --sandbox read-only         # strictest: blocks all mutations
```

### Environment Variable

```bash
AX_CODE_ISOLATION_MODE=workspace-write ax-code
```

### Config File

In `ax-code.json`:

```json
{
  "isolation": {
    "mode": "workspace-write",
    "network": false
  }
}
```

### Precedence

CLI flag > environment variable > config file > default (workspace-write)

## Isolation Modes

| Mode              | Description                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `workspace-write` | Writes confined to workspace. Network disabled. Protected paths enforced. Shown as "sandbox on". |
| `full-access`     | No restrictions. Shown as "sandbox off".                                                         |
| `read-only`       | All mutations blocked. No bash. No writes. No network.                                           |

## Protected Paths

In `workspace-write` mode, these paths are always write-protected:

- `.git/` — prevents accidental git state corruption
- `.ax-code/` — prevents config/plugin tampering

Add custom protected paths in config:

```json
{
  "isolation": {
    "mode": "workspace-write",
    "protected": ["secrets", "credentials"]
  }
}
```

## Network Access

Network is disabled by default in `workspace-write` and `read-only` modes. Tools affected:

- `webfetch` — blocked
- `websearch` — blocked
- `codesearch` — blocked
- `bash` — network-only clients (`curl`, `wget`, `nc`/`ncat`/`netcat`, `telnet`, `ftp`, `tftp`, `scp`, `sftp`, `dig`, `nslookup`, `host`) are blocked

> **Limitation:** Network blocking in `bash` is application-layer and covers the dedicated network clients above. It does **not** intercept dual-use tools that also work offline (`git`, `npm`/`pnpm`/`yarn`, `pip`, `go`, language interpreters such as `python`/`node`), because their offline invocations cannot be distinguished statically and blocking them would break common workflows. True, exhaustive network isolation requires OS-level controls, which this sandbox does not provide. When a denied client is hit, the agent prompts for a one-time escalation.

To allow network while keeping write restrictions:

```json
{
  "isolation": {
    "mode": "workspace-write",
    "network": true
  }
}
```

## Isolation backend (app vs OS)

| Backend          | Config / env                                                    | Behavior                                                         |
| ---------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| `app`            | `"backend": "app"`                                              | Portable tool-layer checks only                                  |
| `os`             | `"backend": "os"` / `AX_CODE_ISOLATION_BACKEND=os`              | App checks + kernel sandbox for bash; errors if OS tools missing |
| `auto` (default) | `"backend": "auto"`, unset, or `AX_CODE_ISOLATION_BACKEND=auto` | Prefer OS bash wrap; fall back to app-only                       |

**macOS:** Seatbelt profiles via `sandbox-exec` (write limited to workspace/worktree, network denied when `network: false`).  
**Linux:** bubblewrap (`bwrap`) when installed (`--unshare-net` when network disabled, workspace bind-mounted RW).  
**Windows:** app-layer only today.

```json
{
  "isolation": {
    "mode": "workspace-write",
    "network": false,
    "backend": "auto"
  }
}
```

See [SECURITY.md](../SECURITY.md) for the threat model.

## Repository-controlled permissions and hooks

Project files are untrusted by default. Permission rules in `ax-code.json`, `.ax-code/policy.json`, and project agent or mode definitions may tighten access with `deny`, but repository-controlled `allow`/`ask` grants are ignored. Project commands cannot enable shell expansion. `.ax-code/hooks.json`, `.ax-code/plugin/`, and project-configured plugins are not executed.

Untrusted project config also cannot select a custom shell, executable LSP or formatter, provider package or API endpoint, provider credential environment variables, external skill source, or instruction path outside the worktree. Safe relative instruction paths and non-executable built-in overrides remain available. MCP servers use a separate fingerprinted approval flow described in [MCP Integrations](mcp.md).

After reviewing the repository-controlled configuration, users can opt in outside the repository for the current process:

```bash
AX_CODE_TRUST_PROJECT_CONFIG=1 ax-code
```

The environment-only switch prevents a checkout from declaring itself trusted.

## How Enforcement Works

Sandbox enforcement is **always** application-layer, checked at each tool invocation. When `backend` is `os` or `auto` and the platform supports it, **bash** is additionally wrapped in a kernel sandbox.

| Tool          | Check                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `bash`        | Working directory + all resolved paths must be inside workspace; network-only clients blocked when network is disabled; optional OS wrap |
| `edit`        | Target file must be inside workspace and not protected                                                                                   |
| `write`       | Target file must be inside workspace and not protected                                                                                   |
| `apply_patch` | All target files must be inside workspace and not protected                                                                              |
| `webfetch`    | Network access must be enabled                                                                                                           |
| `websearch`   | Network access must be enabled                                                                                                           |
| `codesearch`  | Network access must be enabled                                                                                                           |

When a tool violates isolation, it throws an `IsolationDeniedError` with a clear message explaining what was blocked and why.
