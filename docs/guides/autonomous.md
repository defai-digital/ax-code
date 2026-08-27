# Autonomous Mode

Status: Active
Scope: current-state
Last reviewed: 2026-08-25
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
- **RISK** permissions (edit, bash, external_directory, task, webfetch, websearch, codesearch, …) **fall through to the ruleset** — the agent's configured allow/deny rules still apply, and user-defined deny rules are always enforced. In `full-access` sandbox mode, RISK permissions are auto-approved after deny rules are evaluated.
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

| Combination                  | Behavior                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| Autonomous ON + Sandbox ON   | Agent runs freely but is confined to workspace. **Recommended for untrusted or team repositories.** |
| Autonomous ON + Sandbox OFF  | Agent runs freely with full system access. Use for trusted projects.                                |
| Autonomous OFF + Sandbox ON  | Agent asks for permission on each action, confined to workspace. Maximum control.                   |
| Autonomous OFF + Sandbox OFF | Agent asks for permission on each action, full system access.                                       |

The default runtime posture is autonomous on plus sandbox off: `full-access` with network enabled. This provides the least-friction CLI behavior but no isolation boundary. Use `/sandbox`, `--sandbox workspace-write`, `AX_CODE_ISOLATION_MODE`, or project config to enable restrictions for untrusted or unattended work.

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

## Workload budgets (model turns and tool calls)

Autonomous mode does **not** mean unlimited execution. Several independent caps apply. Defaults below are the shipped constants; raise or lower them in `ax-code.json` when a workload needs more room.

A **model turn** is one outer-loop model request. A **tool call** is one tool invocation inside a model turn. These are separate budgets: a single model turn can issue several tool calls. Legacy config names containing `steps` remain supported, but they do not make the two units interchangeable.

Prefer the first-class **`autonomy`** object. Legacy `session.*` and `experimental.autonomous_caps.*` keys still work as aliases (lower precedence).

| Cap                        | Default                                                       | Unit                                                      | Preferred config                                       | Legacy alias                                    |
| -------------------------- | ------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| Per-segment model turns    | 500                                                           | Model requests per continuation segment                   | `autonomy.budget.model_turns.per_segment`              | `session.max_steps`                             |
| Auto-continuations         | 3                                                             | Segments after a model-turn ceiling (ordinary autonomous) | `autonomy.budget.continuations`                        | `session.max_continuations` (`0` disables)      |
| Cumulative model turns     | 2,000 ordinary · 20,000 goal / Super-Long                     | Model requests summed across continuations                | `autonomy.budget.model_turns.total`                    | `session.max_total_steps`                       |
| Per-agent model turns      | Unbounded for native agents                                   | Model requests while that agent is active                 | `agent.<name>.steps` (optional)                        | —                                               |
| Todo auto-retries          | 10                                                            | Continuations while todos remain pending                  | `autonomy.budget.todo_retries`                         | `session.max_todo_retries`                      |
| Blast-radius tool calls    | 500 / segment                                                 | Tool invocations in autonomous mode                       | `autonomy.budget.tool_calls.per_segment`               | `experimental.autonomous_caps.steps`            |
| Blast-radius files / lines | 50 files · 5,000 lines                                        | Change footprint (survives continuations)                 | `autonomy.budget.changes.files_total` / `.lines_total` | `experimental.autonomous_caps.files` / `.lines` |
| Lines-exempt paths         | Lockfiles + generated snapshots (`*.snap`, `*-snapshot.json`) | Globs that count toward the file cap but not the line cap | `autonomy.budget.changes.lines_exempt_paths`           | `experimental.autonomous_caps.linesExemptPaths` |
| Per-tool flood caps        | e.g. bash 50, edit 100                                        | Calls per model turn                                      | `autonomy.budget.tool_calls.per_tool`                  | `experimental.autonomous_caps.perTool`          |
| Tool-only streak breaker   | Nudge 15 · final ~30 · stop 35                                | Consecutive tool-only model finishes                      | `autonomy.stall.tool_only_*`                           | —                                               |
| Tool-call burst limiter    | 30 calls / 10s                                                | Rolling window per processor turn                         | `autonomy.budget.tool_calls.rate`                      | —                                               |

Binary files (`cp` of an executable, `curl -o` of a zip, and other non-text writes) still count toward the **file** cap, but they charge **zero lines**. The line cap measures textual change. Shell text writes keep the `ceil(size / 80)` estimate so a dense payload cannot evade the budget by having few newlines.

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

**What the TUI shows:** during an autonomous run the header reports `turn current/max · total current/max · cont current/max`. `turn` is the current continuation segment and uses the **effective pacing cap** for the active agent — `min(agent.steps, session.max_steps)` when the agent is capped, otherwise the per-segment limit. `total` survives auto-continuations. `cont` shows `∞` when an active goal or Super-Long mode lifts the ordinary continuation cap.

**Auto-routing:** keyword routing may switch the session to a specialist agent (Debug, Security, DevOps, …). Specialists share the same unbounded-by-default agent model-turn policy as Dev unless you set `agent.<name>.steps`. Disable routing with `"routing": { "disable": true }` if you want the Dev agent only.

**Long runs:** use `/goal` or Super-Long for multi-hour work — they lift ordinary continuation caps and use the larger cumulative ceiling (default 20,000), with verification / pause semantics documented in [Loop Mode](loop-mode.md). `/goal` first writes a reviewable contract (acceptance criteria + verification plan) and fail-closes to paused if that plan cannot be produced.

### When a limit stops a run

Before an ordinary run reaches its cumulative model-turn ceiling, AX Code injects one bounded convergence instruction (at most the final 50 turns, scaled down for small custom budgets). It tells the model to stop broad exploration, finish or safely park in-flight work, run targeted verification, and report unfinished work truthfully. It does not add budget or bypass any cap.

When a terminal budget is reached, `session.error` includes an optional machine-readable `code`, and the replay `session.end` event records the same value as `stopCode`. Existing coarse end reasons remain unchanged for compatibility. Current limit codes are:

- `MODEL_TURN_SEGMENT_LIMIT`
- `MODEL_TURN_TOTAL_LIMIT`
- `AGENT_MODEL_TURN_LIMIT`
- `AGGREGATE_TOOL_CALL_LIMIT`
- `FILE_CHANGE_LIMIT`
- `LINE_CHANGE_LIMIT`

At a segment ceiling, AX Code auto-continues while the configured continuation budget remains. Once that budget is exhausted, the run stops and the message says what happened. Sending a new prompt such as `continue` starts a new user-directed run with new run accounting; it does not retroactively extend the stopped run. Use `/goal` when the objective should remain explicit and resumable until completion, blocking, or a goal/runtime budget boundary. `/goal` does not disable permission, isolation, blast-radius, stall, token, time, or cumulative model-turn safeguards.

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
