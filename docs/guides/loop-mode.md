# Loop Mode & Scheduled Tasks

Status: Active
Scope: current-state
Last reviewed: 2026-07-25
Owner: ax-code runtime

AX Code has three composable automation primitives:

| Primitive       | What it is                                                                                         | Lifetime                          |
| --------------- | -------------------------------------------------------------------------------------------------- | --------------------------------- |
| `/goal`         | A durable objective the session keeps pursuing, with budgets and a verification gate               | Persisted per session             |
| `/loop`         | A heartbeat that re-runs a prompt on a fixed interval while the session is idle                    | This backend process              |
| Scheduled tasks | Durable one-time or recurring runs ("every weekday at 9am…") the agent can set up conversationally | Persisted in the project database |

## /loop — recurring prompts

```
/loop <interval> <prompt>   start (interval like 30s, 5m, 1h)
/loop status                show runs, busy-skips, and the prompt
/loop stop                  stop the loop
```

Examples:

```
/loop 5m check CI for new failures and fix any you find
/loop 30m drain the review queue
```

Rules:

- Interval bounds: 30 seconds to 24 hours. One loop per session — starting a
  new one replaces the old.
- A tick that fires while the session is busy is **skipped and counted**,
  never queued — loops cannot pile up turns.
- Every tick is an ordinary prompt turn: permissions, questions, autonomous
  caps, and completion gates all apply. With autonomous off, a tick simply
  parks at the first permission prompt.
- Hard ceiling of 500 runs per loop, then the loop stops itself with a
  notice.
- Loops live in the backend process only: they do not survive a restart.
  For durable schedules, use scheduled tasks below.

## Pairing /goal with /loop

`/goal` owns the objective ("all tests green, no open review findings");
`/loop` provides the heartbeat that keeps checking. Goal completion remains
verification-gated: the agent cannot mark a goal complete after edits without
a passing verification run.

```
/goal keep main green: fix any CI failure the loop finds
/loop 10m check CI status and act on failures
```

## Goal budgets and ceilings

An active goal lifts the per-run auto-continuation cap (`session.max_continuations`)
— the run keeps going until the goal is complete, blocked, paused, or
budget-limited. What bounds it instead:

- **Token budget** (`/goal --budget N …`): when exhausted, the agent gets one
  wrap-up turn, then the goal becomes `budget_limited`.
- **Cumulative step ceiling**: active-goal runs share the Super-Long backstop
  of `max_steps × 40` total steps (20,000 by default) instead of the ordinary
  autonomous ceiling of `max_steps × (max_continuations + 1)`. Override with
  `session.max_total_steps`.
- Doom-loop detection, blast-radius caps, and the tool-only-turn breaker still
  apply throughout.

As a goal run approaches the step ceiling the agent receives a one-time
convergence warning telling it to verify and complete the goal or leave a
clean hand-off. If the ceiling is reached anyway, the goal is **paused** — not
failed — and can be picked up again with `/goal resume` (raise
`session.max_total_steps` first if it needs more headroom).

## Scheduled tasks — durable, conversational

Ask the agent directly; it uses the `schedule_task`, `list_scheduled_tasks`,
and `manage_scheduled_task` tools:

- "Remind me at 14:30 to check the deployment."
- "Every weekday at 9am, summarize new CI failures."
- "List my scheduled tasks." / "Pause the CI summary task."

Schedules support one-time runs, daily/weekly times, and 5-field cron
expressions, each with an optional IANA timezone. Tasks persist in the
project database and fire while an AX Code backend for the project is
running (60s scheduler sweep, atomic claiming — a task fires once even with
several backends open). Schedule advancement and durable queue insertion share
one database transaction, so a crash cannot advance an occurrence without
leaving work to recover.

Missed occurrences default to `catchUpPolicy: "run_once"`: after downtime,
AX Code coalesces any backlog into one run. Use `"skip"` when stale work should
be advanced without running. A task can also set `maxRunDurationMs` from one
second through 72 hours; a timed-out run is cancelled and recorded as failed.

For operation across process and host restarts, run the backend under a
supervisor. See [Long-Running Operations](long-running-operations.md) for
systemd, launchd, and PM2 examples plus exact recovery semantics.

## Long unattended runs

For multi-hour autonomous sessions, Super-Long mode adds run deadlines (up
to 72h), request pacing, and compaction tuning. It auto-enables for models
whose declared capabilities support long-agent work (1M-context reasoning
models such as Qwen 3.7+ Max/Plus on Alibaba routes and GLM 5.x on z.ai
routes) and can be forced per session, per project, or via
`AX_CODE_SUPER_LONG`. Run engagement is logged (`super-long run engaged`),
and provider pacing only starts after a grace window from run start
(default 2 hours, `super_long.pacing_grace_minutes`) so the productive
early phase of an agentic run keeps full tool-call throughput; the
marathon tail is paced per the model's declared rate-limit tier.
