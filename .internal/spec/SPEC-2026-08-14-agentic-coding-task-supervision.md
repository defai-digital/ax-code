# Tech Spec: Agentic Coding Task Supervision

| Field | Value |
|-------|-------|
| Status | Phase 4 implemented |
| Date | 2026-08-14 |
| Related | PRD-2026-08-14; ADR-055 |
| Location | `.internal/spec/SPEC-2026-08-14-agentic-coding-task-supervision.md` |

---

## 1. Overview

Unify live subagents and durable queue work behind one supervision model:

```
task / task_parallel / workflow / scheduled
        │
        ▼
   child Session  ◄── transcript, tools, abort
        │
        ▼
   TaskQueue row  ◄── status, title, agent, delivery (phase 3+)
        │
        ▼
   SSE task.queue.* + session.status
        │
        ▼
   TUI SubagentStatusPanel  /  later: `ax-code task` CLI
```

Phase 1 does not change spawn. It renders what already exists.

---

## 2. Integration points (verified against source)

| Seam | Location | Use |
|------|----------|-----|
| Live spawn | `src/tool/task.ts`, `src/tool/task_parallel.ts` | child `Session.create({ parentID })`; await `SessionPrompt.prompt` |
| Subtask slash/@ | `src/session/prompt-subtask.ts` | same `TaskTool.execute` |
| Durable queue | `src/session/task-queue.ts` | kinds include `subagent`, `automation` |
| Executor | `src/session/task-queue-executor-impl.ts` | `workflowSubagentExecution` for `kind: "subagent"` |
| Workflow enqueue | `src/workflow/scheduler.ts` | already `TaskQueue.enqueue({ kind: "subagent" })` |
| HTTP | `src/server/routes/task-queue.ts` | `taskQueue.list/enqueue/status/cancel/retry` |
| TUI projection | `src/cli/cmd/tui/context/sync-state.ts` `task_queue` | already updated on `task.queue.*` |
| TUI rollup | `.../session/subagent-status-view.ts` | merge tool parts + child sessions + queue items |
| TUI chrome | `.../session/subagent-status-panel.tsx` + `index.tsx` | rail |
| Abort | `sdk.client.session.abort({ sessionID })` | stop one child |
| Completion gate | `src/control-plane/autonomous-completion-gate.ts` | empty / failed / needs-review |

---

## 3. Phase 1 module design

### `subagent-status-view.ts`

Already builds `SubagentStatusView` from:

- `tasks: SubagentRollupTask[]` (from `task` tool parts)
- `childSessions` with `parentID === parentSessionID`
- `session_status` busy/retry

Add `taskQueueItemsToRollupTasks(items)`:

- Keep `kind` in `{ subagent, automation }`
- Map queue `status` → rollup status (`running`/`pending`/`completed`/`error`/`cancelled`)
- Title, agent, `sessionID`, started/lastActivity from queue `time`
- Model: string `modelID` if `model` is `{ modelID }` or a string

`buildSubagentStatusView` already unions tasks by `sessionID` and keeps unbound tasks. Feed queue-derived tasks into the same `tasks` array. Dedup: if a tool part and a queue row share `sessionID`, one item.

### `subagent-status-panel.tsx`

Bounded rail (max 8 rows, 15% terminal height). Header toggles collapse. Row: spinner + agent + title + activity + optional model + elapsed + `[↗]` open + `[×]` stop.

### `session/index.tsx`

- Import panel.
- `kv.signal("subagent_panel_collapsed", false)`.
- `stopping` set of session IDs.
- Merge `sync.data.task_queue` through `taskQueueItemsToRollupTasks` into `buildSubagentStatusView`.
- Replace the 2-row text stub with `<SubagentStatusPanel>`.
- `onOpen` → `navigate({ type: "session", sessionID })`.
- `onStop` → `sdk.client.session.abort({ sessionID })`.

Show the panel on the **parent** of the current tree (`session.parentID ?? session.id`) so a child view still lists siblings.

---

## 4. Phase 2+ contracts (not implemented in this slice)

### `task` parameters

```ts
{
  description: string
  prompt: string
  subagent_type: string
  task_id?: string          // resume
  command?: string
  background?: boolean      // NEW, default false
}
```

### Background execute (sketch)

1. Permission + depth checks (existing).
2. `Session.create` or resume (existing).
3. `TaskQueue.enqueue({ kind: "subagent", sessionID, title, agent, sourceMessageID, payload: { prompt, resume: !!task_id } })`.
4. `TaskQueueExecutor.start(item)` or equivalent fire-and-forget `SessionPrompt.prompt` that still heartbeats the queue row.
5. Return immediately:

```
task_id: <session.id>
state: running
```

6. Do **not** await the child in the tool.

### Completion (phase 3)

On child terminal state:

- `TaskQueue.setStatus(completed|failed)`
- Inject parent continuation with `<task id state>` (OpenCode/Grok shape) so the next parent turn sees it
- Completion gate reads that delivered part the same way it reads a foreground tool part

### Cancel / recovery (phase 4)

- `SessionPrompt.cancel(parent)` walks `parentID` children and aborts busy ones
- `TaskQueue.recoverInterrupted` treats live `kind: "subagent"` with `resumeOnRestart` like workflow children when payload says so
- `maxChildrenPerSession` (default 8) on live background spawns

---

## 5. Testing

| Area | File |
|------|------|
| Rollup + stale + queue merge | `test/cli/tui/subagent-status-view.test.ts` |
| Existing task tool | `test/tool/task*.test.ts` (phase 2+) |
| Queue recover | existing `test/session/task-queue*.test.ts` (phase 4) |
| Completion gate | existing autonomous gate tests (phase 3) |

Phase 1 verify:

```bash
cd packages/ax-code && AX_TEST_FILES=test/cli/tui/subagent-status-view.test.ts pnpm exec vitest run
```

---

## 6. File map

| Path | Change |
|------|--------|
| `.../subagent-status-view.ts` | queue → rollup helper |
| `.../subagent-status-panel.tsx` | new (phase 1) |
| `.../session/index.tsx` | wire panel, merge queue, open/stop |
| `src/tool/task.ts` + `task.txt` | phase 2 |
| `src/session/task-queue-executor-impl.ts` | non-workflow subagent run |
| `src/session/prompt-impl.ts` / completion gate | phase 3 |
| `src/session/prompt.ts` cancel | phase 4 cascade |
| `src/cli/cmd/` task CLI | phase 5 |
