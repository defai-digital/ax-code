# ADR-055: Agentic Coding Task Supervision

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-08-14 |
| Deciders | AX Code maintainers |
| Supersedes | — |
| Related | ADR-048 (integrity / parallel explore); ADR-025 / ADR-028 (task-queue vs follow-up queue); ADR-005 (subagent fan-out deny); PRD-2026-08-14 |
| Planning | `.internal/reports/planning/agentic-coding-tasks/` |

---

## Context

Agentic coding CLIs (Codex, Grok Build, OpenCode, Claude Code) now sell **detached work you can watch**: spawn a child, keep using the parent, open or stop the child, get a result without polling.

AX Code already implemented the hard parts of the harness (ADR-048) and a durable server queue for workflow/scheduled work. Live `TaskTool` still **blocks the parent turn** and never writes a queue row. The TUI scrapes `task` tool parts and shows two lines.

OpenClaw is the best **backend** reference (spawn + yield + ledger + delivery). It is the wrong **product** reference (Agent OS, multi-channel). This ADR locks the coding-CLI shape.

---

## Decision

### D1 — Coding CLI, not Agent OS

AX Code remains a local-first coding runtime (TUI, HTTP, Desktop). We will not add OpenClaw-style channel bindings, heartbeat turns, or ACP-as-the-default child runtime.

Workflow stays the multi-step orchestrator. We will not add a Task Flow clone.

### D2 — One ledger: `TaskQueue`

`TaskQueue` is the durable record for **all detached work**: live `task` children, workflow children, scheduled automations.

- Session = conversation / transcript.
- Task queue row = activity (status, title, agent, session link, error, timestamps).
- Tool parts remain a fallback projection for in-flight foreground `task` calls that have not yet been queued.

TUI `sync.data.task_queue` (already populated from `task.queue.*`) becomes a supervision source, not a reserved future field.

Follow-up chat queue stays client-owned (ADR-028). Do not merge those concepts.

### D3 — Same `task` tool; foreground default; explicit `background`

Do not invent `sessions_spawn`. Extend `packages/ax-code/src/tool/task.ts`:

- `background?: boolean`, default `false`.
- `background: true` creates the child session, enqueues `kind: "subagent"`, starts execution, returns immediately with `task_id`.
- Foreground path stays the current await + 10-minute timeout + finalize.

Grok Build defaults `run_in_background: true`. We do **not**, because existing AX callers and completion-gate tests assume a tool result in the same turn.

### D4 — Push completion; forbid poll loops

Background completion is a parent-session event (synthetic continuation or control-plane injection), not a model-driven poll.

`task.txt` must say: do not sleep, do not poll `task_id`, do not duplicate the child's files/topics.

OpenClaw `sessions_yield` is the long-term prompt-loop primitive if we need the parent to *wait without blocking the user*. Phase 3 may inject first (OpenCode/Grok shape) and add yield later if autonomous mode needs it.

### D5 — Execution status ≠ delivery status

A child can `completed` / `failed` while the parent has not yet absorbed the result.

Phase 3+ queue payload (or a sibling field) tracks delivery: `pending` | `delivered` | `blocked`. Empty/failed child output stays incomplete evidence (ADR-048 D2). Do not promote tool logs into the child result.

### D6 — Parallel explore, serial write (unchanged)

ADR-048 D4 still holds. Background does not license concurrent writers in one workspace. `task_parallel` remains the sync fan-out for short read-only digs.

### D7 — Cancel and lifetime

| Event | Child session | Queue row |
|-------|---------------|-----------|
| Parent abort / `/stop` | Cancel descendants (cascade) | `cancelled` |
| Operator stop on one row | `session.abort(child)` | `cancelled` |
| Foreground abort of the tool | Delete child session (today) | n/a |
| Background timeout / provider failure | **Keep** session for `task_id` resume | `failed` + resume hint |
| Restart with live queue row | Reconcile: requeue if safe, else `failed` | never silent-orphan |

### D8 — Ship existing abilities before new orchestration

Phase 1 only wires UI and the existing `task_queue` projection. No new spawn API until the rail works on workflow children and live `task` parts.

### D9 — Hard gates stay

Empty subagent, unfinished todos, unexecutable tool text, write isolation, and verification policy remain in force for background results once they are delivered to the parent.

### D10 — Supervision chrome is first-class, bounded

The session transcript hosts a Grok Build-style rail: bounded height, stale detection, open, stop. It is not a second full dashboard in phase 1. CLI/Desktop consume the same ledger later.

---

## Consequences

- `TaskTool` and `TaskQueueExecutor` must share a child-run path.
- TUI session route must stop scraping as the only source.
- Prompt-loop completion gate must understand a *delivered* background result, not only a same-turn tool part.
- ADR-054 (Ratatui TUI) will reimplement the same rail later; this program ships on OpenTUI now.

---

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Copy OpenClaw `sessions_spawn` + `sessions_yield` as new tools | Second spawn API; models already know `task` |
| In-process BackgroundJob only (OpenCode) | We already have SQLite `TaskQueue`; dropping durability would be a regression |
| Default background=true (Grok Build) | Breaks same-turn completion-gate tests and current callers |
| New Task Flow table | Duplicates `Workflow` |
| Desktop-first Tasks page | CLI/TUI is the daily driver; ledger first |
