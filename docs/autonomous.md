# Autonomous Mode

Autonomous mode lets ax-code complete tasks without waiting for human confirmation at each step. When enabled, permission prompts and question dialogs are auto-approved, so the agent runs continuously until the task is done.

By default, autonomous mode is **on**. If you've previously toggled it off, that preference is saved and restored on next launch.

## Quick Start

Toggle from the TUI:

- Type `/autonomous` in the prompt, or
- Press `Ctrl+P` and search "autonomous", or
- Click the **autonomous on/off** indicator in the status bar

The status bar shows the current state:

- **autonomous on** (yellow background, bold red text) — agent runs without pausing
- **autonomous off** (green text) — agent pauses for permission/question prompts

The setting persists across sessions in `ax-code.json`.

## What Changes

| Behavior | Autonomous Off | Autonomous On |
|---|---|---|
| Tool permissions (read, edit, bash, etc.) | Prompts user for approval | **Auto-approved** |
| Question dialogs (plan selection, etc.) | Waits for user to pick an option | **Picks first option** |
| Session loop on rejection | Stops and waits | **Continues running** |
| `isolation_escalation` prompts | Always prompts | **Always prompts** (never auto-approved) |

## How It Works

Autonomous mode operates at three layers:

### 1. Permission Auto-Approve (Server-Side)

When a tool calls `ctx.ask()` for permission, the Permission module checks `AX_CODE_AUTONOMOUS`. If enabled, it returns immediately without creating a blocking prompt — the tool proceeds without waiting.

**Exception:** `isolation_escalation` permissions (sandbox override requests) are never auto-approved. These always require human confirmation, even in autonomous mode.

### 2. Question Auto-Answer (Server-Side)

When a tool asks the user a question (e.g., plan selection, confirmation), the Question module picks the first available option and returns immediately.

### 3. Processor Loop (Session-Level)

If a permission is somehow rejected (e.g., by an explicit deny rule), the processor loop does not stop — it continues to the next step instead of halting the session.

## Autonomous + Sandbox

Autonomous mode and sandbox mode are **independent**. You can use both simultaneously:

| Combination | Behavior |
|---|---|
| Autonomous ON + Sandbox ON | Agent runs freely but is confined to workspace. **Recommended default.** |
| Autonomous ON + Sandbox OFF | Agent runs freely with full system access. Use for trusted projects. |
| Autonomous OFF + Sandbox ON | Agent asks for permission on each action, confined to workspace. Maximum control. |
| Autonomous OFF + Sandbox OFF | Agent asks for permission on each action, full system access. |

The recommended setup is **both on** — the agent works efficiently without interruptions, while sandbox ensures it can't accidentally modify files outside your project or access the network.

## Configuration

### Config File

In `ax-code.json`:

```json
{
  "autonomous": true
}
```

Set to `false` to disable:

```json
{
  "autonomous": false
}
```

### Environment Variable

```bash
AX_CODE_AUTONOMOUS=true ax-code    # force autonomous on
AX_CODE_AUTONOMOUS=false ax-code   # force autonomous off
```

### Precedence

Environment variable > config file > default (on)

## When to Turn Autonomous Off

- **Learning ax-code** — see what the agent does at each step
- **Sensitive operations** — review each file change before it's applied
- **Debugging agent behavior** — understand why the agent makes certain decisions
- **Untrusted code** — review tool calls when working with unfamiliar repositories

## When to Keep Autonomous On

- **Routine tasks** — refactoring, bug fixes, migrations where you trust the agent
- **CI/CD pipelines** — headless execution where no human is available
- **SDK usage** — programmatic agent execution via `createAgent()`
- **Large tasks** — multi-file changes where stopping at each permission would take hours

## Headless / CI Usage

In headless mode (`ax-code run`, `ax-code serve`, SDK), autonomous mode is essential — there's no TUI to display prompts. The server-side auto-approve ensures the agent runs to completion without hanging on unanswered prompts.

```bash
# Headless one-shot with autonomous on (default)
ax-code run "Fix all TypeScript errors in src/"

# Explicit override
AX_CODE_AUTONOMOUS=true ax-code run "Migrate API routes"
```

## Safety Guarantees

Even with autonomous mode on:

1. **Sandbox still enforces boundaries** — writes outside workspace are blocked regardless of autonomous mode
2. **Isolation escalation always prompts** — the agent cannot silently override sandbox restrictions
3. **Deny rules are enforced** — explicit `"deny"` permission rules still block tool calls
4. **Session snapshots are recorded** — every tool call is logged for audit/replay
5. **Abort always works** — pressing Esc (interrupt) stops the agent immediately
