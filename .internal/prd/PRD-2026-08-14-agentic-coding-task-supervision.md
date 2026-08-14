# PRD: Agentic Coding Task Supervision

| Field | Value |
|-------|-------|
| Status | Active |
| Owner | AX Code runtime + CLI |
| Created | 2026-08-14 |
| Related | ADR-048 (harness integrity); ADR-055 (this program); OpenClaw tasks/subagents; OpenCode task tool; Grok Build `run_in_background`; Codex CLI running-task rail |
| Location | `.internal/prd/PRD-2026-08-14-agentic-coding-task-supervision.md` |
| Planning | `.internal/reports/planning/agentic-coding-tasks/` |

---

## 1. Problem statement

AX Code already has the pieces of an agentic coding CLI:

- Isolated child sessions via `task` / `task_parallel`
- Empty-subagent completion gates and resume via `task_id`
- A durable SQLite `TaskQueue` used by workflow children and scheduled tasks
- Scheduled tasks, workflow runtime, write isolation, verification policy
- Parent/child session navigation in the TUI

Those abilities are not a product. Daily-driver users still see:

1. **Parent turn is blocked** for the entire child lifetime. There is no Grok Build / Codex-style “still running” rail of detached work.
2. **Two backends that do not meet.** Live `task` children are tool parts + sessions. Durable work is `TaskQueue`. The TUI already syncs `task.queue.*` and does not render it.
3. **Supervision is two lines of text.** Open, stop, stale, model, and elapsed exist as a panel draft, not as the session chrome.
4. **Peers productized detach.** OpenClaw `sessions_spawn` is non-blocking and push-completes. Grok Build `task.run_in_background` defaults true. OpenCode has experimental `background=true`. AX Code always waits.

ADR-048 already shipped Plan → Execute → Verify and parallel explore. This program is the missing **task supervision** layer so AX Code reads as an agentic coding tool, not an Agent OS and not a blocked tool spinner.

---

## 2. Goals

### Product goals

| ID | Goal |
|----|------|
| **G1** | **Surface what we have.** Running subagents, workflow children, and queued automations are visible, openable, and stoppable in the TUI. |
| **G2** | **Parent stays usable.** Long child work can detach; the parent can keep talking, planning, or reviewing. |
| **G3** | **One ledger.** Every detached spawn is a `TaskQueue` row. Tool parts are a fallback, not the source of truth. |
| **G4** | **Push, do not poll.** Child completion arrives as a parent event. Models are told not to sleep or poll. |
| **G5** | **Stop means stop.** Parent `/stop` cascades. Operator stop on a row cancels that child. Restart does not leave orphan processors. |
| **G6** | **Coding CLI, not Agent OS.** No chat-channel bindings, heartbeat, ACP-as-default, or a second Task Flow. |

### Engineering goals

| ID | Goal |
|----|------|
| **E1** | Reuse `TaskQueue`, `TaskQueueExecutor`, `session.abort`, and existing SSE events. |
| **E2** | Keep foreground `task` as the default so current callers do not change. |
| **E3** | Keep ADR-048 hard gates (empty subagent, todos, verification, write isolation). |
| **E4** | Unit-test view-model, spawn contract, cancel cascade, and restart recovery. |

---

## 3. Non-goals

- Replacing Node runtime with Grok Build or Codex.
- Copying OpenClaw Discord/Telegram/thread bindings, heartbeat, or ACP spawn as the default child runtime.
- Adding a fourth orchestrator (OpenClaw Task Flow). `Workflow` stays the multi-step engine.
- Making background the default for `task` (Grok Build does; we will not, in v1).
- Desktop Tasks page in phase 1–3 (phase 5).
- Fork-context (`isolated` vs `fork`) in phase 1–2.
- Changing ADR-048 sandwich autonomy or verification policy.

---

## 4. Users & success metrics

| Persona | Need | Metric |
|---------|------|--------|
| Daily CLI user | See and stop children without leaving the parent transcript | Time-to-find a running child; accidental duplicate work |
| Power user | Launch explore/review in background and keep chatting | Parent turns started while a child is running |
| Workflow / scheduled user | Same rail as live subagents | Queue items visible without a separate dashboard |
| Maintainer | One cancel/recovery path | Orphan child processors after restart = 0 in dogfood |

**Acceptance thresholds**

- Phase exit criteria in [`../reports/planning/agentic-coding-tasks/PHASES.md`](../reports/planning/agentic-coding-tasks/PHASES.md).
- A parent session with ≥1 active child shows the supervision panel, not a 2-row text stub.
- After phase 2, `task({ background: true })` returns before the child finishes and writes a `TaskQueue` row.
- After phase 4, aborting the parent cancels descendants; restart reconciles live children.

---

## 5. Requirements

### Functional

1. TUI parent session shows a compact running-task rail (Grok Build / Codex shape): agent, title, activity, elapsed, stale, open, stop.
2. The rail merges live `task` tool parts **and** `TaskQueue` items of kind `subagent` / `automation` for the session tree.
3. Click/open navigates to the child session. Stop calls `session.abort` on that child.
4. `task` gains an explicit `background` parameter. Foreground remains default.
5. Background spawn enqueues `TaskQueue.kind = "subagent"`, starts the child, returns `{ task_id, state: "running" }`.
6. Child completion injects a parent-visible handoff. Completion gate still treats empty/failed results as incomplete evidence.
7. Prompt text forbids poll/sleep/duplicate-work loops.
8. Parent abort cascades to active children. Timeout of a background child **keeps** the session for `task_id` resume.
9. Restart recovery covers live `task` children that have a queue row, not only workflow/scheduled items.
10. Operator CLI `ax-code task list|show|cancel|retry` over existing HTTP `taskQueue.*` routes (phase 5).

### Non-functional

- Panel is bounded (max ~15% of terminal height, 8 rows).
- No extra provider round-trip to *discover* child status; use SSE `session.status` + `task.queue.*`.
- Detached spawn must not create unbounded fan-out (`maxChildrenPerSession`, reuse `task_parallel` write-isolation).

---

## 6. Competitive framing (what to take)

| Source | Take | Leave |
|--------|------|-------|
| **OpenClaw** | Detached spawn, durable ledger, push announce, execution ≠ delivery, cascade stop, restart `lost` | Chat channels, heartbeat, ACP-as-default, Task Flow clone |
| **OpenCode** | Same `task` tool + `background` + `task_id` resume + child session nav | Experimental flag; in-process-only jobs |
| **Grok Build** | Running-task rail; `run_in_background` returns immediately; open/stop; worktree later | Default-true background; Rust TUI rewrite (ADR-054 is a different program) |
| **Codex CLI** | Parent remains usable; running agents are first-class chrome | Cloud task browser as v1 |

---

## 7. Phases (summary)

| Phase | Intent |
|-------|--------|
| 0 | Docs (this PRD, ADR-055, spec, phases) |
| 1 | Ship existing abilities: wire panel, merge TaskQueue projection, open/stop |
| 2 | Non-blocking `task` + enqueue on TaskQueue |
| 3 | Push completion + gate for background results |
| 4 | Cascade cancel, concurrency lane, restart recovery |
| 5 | Operator CLI, then Desktop |

---

## 8. Out of scope leftovers

Unrelated dirty-tree work (Ornith system-message ordering, “Autonomous”→“Auto” labels) is **not** this program and must not land in the same commit.
