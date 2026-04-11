# Sandbox Mode

AX Code includes a built-in execution sandbox that restricts what the AI agent can do on your system. By default, the sandbox is **off** (`full-access`) — the agent has unrestricted tool access until you turn sandboxing on. Enable `workspace-write` when you want the agent confined to your workspace.

## Quick Start

Toggle sandbox from the TUI:

- Type `/sandbox` in the prompt, or
- Press `Ctrl+P` and search "sandbox"

The status bar shows the current state:

- **sandbox off** (red) — no restrictions
- **sandbox on** (green) — agent confined to workspace

The setting persists across sessions in `ax-code.json`.

## What Changes

| Capability | Sandbox Off | Sandbox On |
|---|---|---|
| File writes inside workspace | Allowed | Allowed |
| File writes outside workspace | Allowed | **Blocked** |
| Writes to `.git/` | Allowed | **Blocked** |
| Writes to `.ax-code/` | Allowed | **Blocked** |
| Bash commands | Unrestricted | **Workspace only** |
| Bash targeting `.git/`, `.ax-code/` | Allowed | **Blocked** |
| Bash targeting outside workspace | Allowed | **Blocked** |
| Network access (webfetch, websearch) | Allowed | **Blocked** |
| Read operations (read, glob, grep) | Unrestricted | Unrestricted |

## Configuration

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

| Mode | Description |
|---|---|
| `full-access` | No restrictions. **Default.** Shown as "sandbox off". |
| `workspace-write` | Writes confined to workspace. Network disabled by default. Protected paths enforced. Shown as "sandbox on". |
| `read-only` | All mutations blocked. No bash. No writes. No network. |

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

| Tool | Check |
|---|---|
| `bash` | Working directory + all resolved paths must be inside workspace |
| `edit` | Target file must be inside workspace and not protected |
| `write` | Target file must be inside workspace and not protected |
| `apply_patch` | All target files must be inside workspace and not protected |
| `webfetch` | Network access must be enabled |
| `websearch` | Network access must be enabled |
| `codesearch` | Network access must be enabled |

When a tool violates isolation, it throws an `IsolationDeniedError` with a clear message explaining what was blocked and why.
