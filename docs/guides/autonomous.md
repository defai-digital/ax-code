# Autonomous Mode

Status: Active
Scope: current-state
Last reviewed: 2026-08-11
Owner: ax-code runtime

Autonomous mode lets ax-code complete tasks without waiting for human confirmation at each low-risk step. When enabled, permission prompts are auto-approved unless they are explicitly blocked, and question dialogs are auto-answered with a best-practice heuristic that favors recommended, default, common, simple, and minimal choices while avoiding risky or over-engineered options.

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

| Behavior                                  | Autonomous Off                   | Autonomous On                                                                                                                          |
| ----------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Tool permissions (read, edit, bash, etc.) | Prompts user for approval        | **Hybrid: safe (read/grep/list/…) auto-approved; risky (edit/bash/webfetch/…) falls through to the ruleset so deny rules still apply** |
| Question dialogs                          | Waits for user to pick an option | **Picks the best-practice/default option and records it**                                                                              |
| Planning                                  | Follows normal agent prompt      | **Uses a lightweight PRD/ADR-style decision frame before implementation**                                                              |
| Session loop on rejection                 | Stops and waits                  | **Continues running**                                                                                                                  |
| `isolation_escalation` prompts            | Always prompts                   | **Always prompts** (never auto-approved)                                                                                               |

## How It Works

Autonomous mode operates at three layers:

### Source of Truth

This page summarizes user-facing behavior. When behavior changes, verify the docs against:

- `packages/ax-code/src/session/processor.ts` for permission auto-approve, loop behavior, rejection handling, and autonomous caps.
- `packages/ax-code/src/session/system.ts` and provider prompt files under `packages/ax-code/src/session/prompt/` for autonomous workflow instructions.
- `packages/ax-code/src/question/` and `packages/ax-code/test/question/question.test.ts` for question auto-answer heuristics and escalation behavior.
- `packages/ax-code/src/session/blast-radius.ts` for autonomous step/file-change caps.
- `packages/ax-code/test/session/system.test.ts`, `packages/ax-code/test/session/prompt.test.ts`, and related session tests for prompt and decision-ledger behavior.

Keep safety guarantees here aligned with sandbox documentation; autonomous mode changes approval behavior, not isolation enforcement.

### 1. Permission Auto-Approve (Server-Side)

Autonomous mode uses a **hybrid deny-first policy** (ADR-004 / PRD v4.2.0). When a tool calls `ctx.ask()` for permission, the Permission module classifies the permission:

- **SAFE** permissions (read, glob, grep, list, lsp, code_intelligence, skill, todoread) auto-approve without creating a blocking prompt.
- **RISK** permissions (edit, bash, external_directory, task, webfetch, websearch, codesearch, …) **fall through to the ruleset** — the agent's configured allow/deny rules still apply, and user-defined deny rules are always enforced. (In `full-access` sandbox mode, RISK permissions are auto-approved because the user has already opted out of restrictions.)
- **Unknown** permissions ask by default (`experimental.autonomous_strict_permission: false` preserves the legacy allow behavior).

**Exceptions that are never auto-approved, even in autonomous mode:** `isolation_escalation` (sandbox override requests), `INTERACTIVE_ONLY` permissions, and the `NEVER_AUTONOMOUS_AUTOAPPROVE` set.

**Non-overridable protected paths:** autonomous mode also refuses to write a fixed set of policy/control-plane paths — `ax-code.json`/`ax-code.jsonc`, `.ax-code/**`, `.git/config`, and `.git/refs/**` — so the agent cannot edit its own configuration, raise its own autonomy caps, or plant git hooks. Unlike the configurable blocked-path list, these cannot be removed by project or user config.

### 2. Question Auto-Answer (Server-Side)

When a tool asks the user a question, the Question module picks an answer immediately. It prefers options marked as recommended, default, safe, standard, common, conventional, best practice, simple, or minimal. It avoids options marked experimental, risky, dangerous, destructive, advanced, complex, rewrite, or over-engineered. If no option has a signal, it picks the first option because the question tool instructs agents to put the recommended option first.

### 3. Processor Loop (Session-Level)

If a permission is somehow rejected (e.g., by an explicit deny rule), the processor loop does not stop — it continues to the next step instead of halting the session.

### 4. PRD/ADR-Style Decision Frame

Autonomous mode adds a lightweight workflow reminder to the system prompt. Before implementation, the agent should frame the work with the problem, constraints, decision, tradeoffs, plan, and validation. For substantial multi-file, architectural, or product-visible changes, it may create or update a repository document when that matches the repo's documentation pattern. For trivial changes, it should keep this frame lightweight in the plan to avoid over-engineering.

## Autonomous + Sandbox

Autonomous mode and sandbox mode are **independent**. You can use both simultaneously:

| Combination                  | Behavior                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------- |
| Autonomous ON + Sandbox ON   | Agent runs freely but is confined to workspace. **Recommended default.**          |
| Autonomous ON + Sandbox OFF  | Agent runs freely with full system access. Use for trusted projects.              |
| Autonomous OFF + Sandbox ON  | Agent asks for permission on each action, confined to workspace. Maximum control. |
| Autonomous OFF + Sandbox OFF | Agent asks for permission on each action, full system access.                     |

The default runtime posture is autonomous on plus sandbox on: `workspace-write` with network disabled. Use `/sandbox`, `--sandbox full-access`, `AX_CODE_ISOLATION_MODE`, or project config only when you intentionally need a different boundary.

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

## Workload budgets (step limits)

Autonomous mode does **not** mean unlimited execution. Several independent caps apply. Defaults below are the shipped constants; raise or lower them in `ax-code.json` when a workload needs more room.

Prefer the first-class **`autonomy`** object. Legacy `session.*` and `experimental.autonomous_caps.*` keys still work as aliases (lower precedence).

| Cap                        | Default                                                       | Unit                                                      | Preferred config                                       | Legacy alias                                    |
| -------------------------- | ------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| Per-segment session steps  | 500                                                           | Outer loop iterations per continuation segment            | `autonomy.budget.model_turns.per_segment`              | `session.max_steps`                             |
| Auto-continuations         | 3                                                             | Segments after a step ceiling (ordinary autonomous)       | `autonomy.budget.continuations`                        | `session.max_continuations` (`0` disables)      |
| Cumulative total steps     | 2,000 ordinary · 20,000 goal / Super-Long                     | Sum across continuations                                  | `autonomy.budget.model_turns.total`                    | `session.max_total_steps`                       |
| Per-agent steps            | Unbounded for native agents                                   | Outer iterations for that agent                           | `agent.<name>.steps` (optional)                        | —                                               |
| Todo auto-retries          | 10                                                            | Continuations while todos remain pending                  | `autonomy.budget.todo_retries`                         | `session.max_todo_retries`                      |
| Blast-radius tool calls    | 500 / segment                                                 | Tool invocations in autonomous mode                       | `autonomy.budget.tool_calls.per_segment`               | `experimental.autonomous_caps.steps`            |
| Blast-radius files / lines | 50 files · 5,000 lines                                        | Change footprint (survives continuations)                 | `autonomy.budget.changes.files_total` / `.lines_total` | `experimental.autonomous_caps.files` / `.lines` |
| Lines-exempt paths         | Lockfiles + generated snapshots (`*.snap`, `*-snapshot.json`) | Globs that count toward the file cap but not the line cap | `autonomy.budget.changes.lines_exempt_paths`           | `experimental.autonomous_caps.linesExemptPaths` |
| Per-tool flood caps        | e.g. bash 50, edit 100                                        | Calls per model turn                                      | `autonomy.budget.tool_calls.per_tool`                  | `experimental.autonomous_caps.perTool`          |
| Tool-only streak breaker   | Nudge 15 · final ~30 · stop 35                                | Consecutive tool-only model finishes                      | `autonomy.stall.tool_only_*`                           | —                                               |
| Tool-call burst limiter    | 30 calls / 10s                                                | Rolling window per processor turn                         | `autonomy.budget.tool_calls.rate`                      | —                                               |

### Profiles

Set `autonomy.profile` to seed several fields at once (explicit fields still win):

| Profile    | Intent                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| `standard` | Shipped defaults (500 / 3 continuations / 30·10s burst / tool-only 35)     |
| `quick`    | Short fixes: 80 steps/segment, 1 continuation, tighter tool-only and burst |
| `long`     | Multi-file batches: 10 continuations, 10k total, wider tool-only/burst     |
| `goal`     | Goal-scale headroom without requiring `/goal`                              |
| `custom`   | No profile seeds — only explicit keys and constants                        |

### Inspect with `/limits`

In a session, run **`/limits`** to print the resolved budget stack, effective TUI denominator for the active agent, config sources, and doctor warnings (for example when `agent.steps` is tighter than the session segment). Use `/limits help` for key names.

**What the TUI shows:** during a multi-step run the header chip reports `step current/max` where `max` is the **effective pacing cap** for the active agent — `min(agent.steps, session.max_steps)` when the agent is capped, otherwise the per-segment limit. It is not a total-run counter across auto-continuations.

**Auto-routing:** keyword routing may switch the session to a specialist agent (Debug, Security, DevOps, …). Specialists share the same unbounded-by-default agent step policy as Dev unless you set `agent.<name>.steps`. Disable routing with `"routing": { "disable": true }` if you want the Dev agent only.

**Long runs:** use `/goal` or Super-Long for multi-hour work — they lift ordinary continuation caps and use the larger cumulative ceiling (default 20,000), with verification / pause semantics documented in [Loop Mode](loop-mode.md).

### Example: raise budgets for a large autonomous batch

```json
{
  "autonomous": true,
  "autonomy": {
    "profile": "long",
    "budget": {
      "model_turns": { "per_segment": 500, "total": 20000 },
      "tool_calls": {
        "per_segment": 1000,
        "rate": { "count": 40, "window_seconds": 10 },
        "per_tool": { "bash": 80, "edit": 150 }
      },
      "changes": { "files_total": 100, "lines_total": 10000 }
    },
    "stall": {
      "tool_only_turns": 50,
      "tool_only_nudge": 20
    }
  },
  "agent": {
    "debug": { "steps": 200 }
  }
}
```

## When to Turn Autonomous Off

- **Learning ax-code** — see what the agent does at each step
- **Sensitive operations** — review each file change before it is applied
- **Debugging agent behavior** — understand why the agent makes certain decisions
- **Untrusted code** — review tool calls when working with unfamiliar repositories

## When to Keep Autonomous On

- **Routine tasks** — refactoring, bug fixes, migrations where you trust the agent
- **CI/CD pipelines** — headless execution where the task is already constrained by policy
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
4. **Autonomous choices are recorded** — question tool metadata includes a structured `autonomousDecisions` ledger, and tool output includes the selected answers so the agent can report them later
5. **Avoid over-engineering** — autonomous continuation reminds the agent to prefer the simplest common-practice change and avoid abstractions without 3+ concrete use cases
6. **Session snapshots are recorded** — every tool call is logged for audit/replay
7. **Abort always works** — pressing Esc (interrupt) stops the agent immediately
