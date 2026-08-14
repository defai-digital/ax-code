# Implementation phases: Agentic Coding Task Supervision

Companion to the [PRD](../../../prd/PRD-2026-08-14-agentic-coding-task-supervision.md),
[ADR-055](../../../adr/ADR-055-agentic-coding-task-supervision.md), and
[spec](../../../spec/SPEC-2026-08-14-agentic-coding-task-supervision.md).

Legend: **TODO** · **IN PROGRESS** · **DONE**

---

## Phase 0 — Documentation

**Status:** DONE (2026-08-14)

### Deliverables

- [x] PRD
- [x] ADR-055
- [x] SPEC
- [x] `README.md` / `PHASES.md` / `STATUS.md`
- [x] Index rows in `.internal/prd`, `.internal/adr`, `.internal/spec`

---

## Phase 1 — Ship existing abilities (P0)

**Status:** DONE (2026-08-14)

### Work

1. [x] `subagent-status-view.ts` rollup (stale, activity, elapsed)
2. [x] `subagent-status-panel.tsx` (open / stop / collapse / bounded)
3. [x] Wire panel in `session/index.tsx`; remove 2-row text stub
4. [x] Merge `sync.data.task_queue` (`subagent` / `automation`) into the rollup
5. [x] Open → child session; stop → `session.abort`
6. [x] Unit tests for queue merge + existing rollup cases

### Exit criteria

- Parent session with active children shows the rail, not two text lines.
- Workflow / scheduled queue children appear even without a `task` tool part.
- Open and stop work on rows that have a `sessionID`.
- `subagent-status-view` tests green.

### PR sketch

`feat(tui): running-subagent rail over sessions and TaskQueue`

---

## Phase 2 — Non-blocking `task` (P0)

**Status:** DONE (2026-08-14)

Depends on Phase 1 (rail must exist before detach is useful).

### Work

1. [x] `background?: boolean` on `task.ts` (default false)
2. [x] Enqueue `TaskQueue.kind = "subagent"` and start without awaiting
3. [x] Return `{ task_id, state: "running" }` immediately
4. [x] `task.txt`: do not poll / sleep / duplicate
5. [x] Executor path for non-workflow subagent rows
6. [x] Tests: background returns before child completes; queue row exists

### Exit criteria

- Foreground `task` behavior unchanged.
- Background spawn returns in-process without waiting on the child LLM.
- A queue row exists and the rail shows the child as running.

---

## Phase 3 — Push completion (P0)

**Status:** DONE (2026-08-14)

Depends on Phase 2.

### Work

1. [x] On child terminal state, inject parent handoff (`<task id state>`)
2. [x] Delivery field on the queue row (`pending` / `delivered` / `blocked`)
3. [x] Completion gate treats delivered empty/failed background results as today
4. [x] Do not promote tool logs into child result text

### Exit criteria

- Parent sees the result without polling.
- Autonomous mode cannot complete on an empty background child.

---

## Phase 4 — Cancel, concurrency, restart (P0/P1)

**Status:** TODO

Depends on Phase 2 (needs queue-backed children).

### Work

1. [ ] Parent abort cascades to busy descendants
2. [ ] `maxChildrenPerSession` (default 8) for background spawns
3. [ ] `recoverInterrupted` covers live `kind: "subagent"`
4. [ ] Timeout/failure keeps session for `task_id` resume

### Exit criteria

- `/stop` on parent leaves no busy children.
- Restart does not leave an orphan processor for a queued child.

---

## Phase 5 — Operator CLI, then Desktop (P1/P2)

**Status:** TODO

Depends on Phase 2.

### Work

1. [ ] `ax-code task list|show|cancel|retry` over `taskQueue.*`
2. [ ] Desktop Tasks page (later) on the same ledger

### Exit criteria

- CLI can list/cancel a background child without opening the TUI.
