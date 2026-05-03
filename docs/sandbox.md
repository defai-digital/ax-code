# Sandbox Mode

Status: Active
Scope: current-state
Last reviewed: 2026-04-28
Owner: ax-code runtime

AX Code includes a built-in execution sandbox that restricts what the AI agent can do on your system. By default, AX Code starts in **full-access**. Turn the sandbox on when you want workspace-only or read-only boundaries.

## Quick Start

Toggle sandbox from the TUI:

- Type `/sandbox` in the prompt, or
- Press `Ctrl+P` and search "sandbox"

The status bar shows the current state:

- **sandbox off** (red) — no restrictions
- **sandbox on** (green) — agent confined to workspace

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

CLI flag > environment variable > config file > default (full-access)

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

To allow network while keeping write restrictions:

```json
{
  "isolation": {
    "mode": "workspace-write",
    "network": true
  }
}
```

## How Enforcement Works

Sandbox enforcement is application-layer, checked at each tool invocation:

| Tool          | Check                                                           |
| ------------- | --------------------------------------------------------------- |
| `bash`        | Working directory + all resolved paths must be inside workspace |
| `edit`        | Target file must be inside workspace and not protected          |
| `write`       | Target file must be inside workspace and not protected          |
| `apply_patch` | All target files must be inside workspace and not protected     |
| `webfetch`    | Network access must be enabled                                  |
| `websearch`   | Network access must be enabled                                  |
| `codesearch`  | Network access must be enabled                                  |

When a tool violates isolation, it throws an `IsolationDeniedError` with a clear message explaining what was blocked and why.
