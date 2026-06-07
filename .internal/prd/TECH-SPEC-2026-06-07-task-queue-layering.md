# Tech Spec: Task Queue Layering

**Date:** 2026-06-07
**Status:** Implemented 2026-06-07 (Option A) - interactive follow-up queue landed; deferred items recorded in
ADR-028 Follow-ups
**Scope:** Internal technical design
**Related:** `.internal/prd/PRD-2026-06-07-task-queue-layering.md`, ADR-028, ADR-025, ADR-022, ADR-018, ADR-017

---

## Summary

Split AX Code's single durable task queue into two clearly-bounded layers:

1. an **ephemeral interactive follow-up queue** owned by the client (TUI), mirroring the shipped `ax-code-desktop` model
   and Codex CLI; and
2. the existing **durable `TaskQueue`** reserved for workflow children, scheduled tasks, automations, and crash recovery.

The interactive queue stops flowing through `prompt_async → TaskQueue` and stops being derived from persisted messages.
This both fixes the broken "Queued" display and removes durable rows from a transient UX concern. The durable queue and
its subsystems are unchanged.

## Current AX Code Substrate

Interactive submission and display:

- `packages/ax-code/src/cli/cmd/tui/component/prompt/index.tsx` — every interactive submit calls `submitAsyncRoute` with
  `prompt_async` / `command_async` / `shell_async`; `settlePromptLocally` clears input but does **not** insert an
  optimistic message.
- `packages/ax-code/src/server/routes/session.ts` — `startAsyncSessionHandler` enqueues a `TaskQueue` item and calls
  `TaskQueueExecutor.start`, returning `202` before the turn runs.
- `packages/ax-code/src/cli/cmd/tui/routes/session/sidebar.tsx` — the `queued` memo lists user messages with no assistant
  `parentID`. This is the wrong source: `waiting_for_idle` items have no message yet.
- `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx` — `UserMessage` marks a "queued" badge using
  `pending` (`messages().findLast(assistant && !time.completed)?.id`) and `message.id > pending`.
- `packages/ax-code/src/runtime/headless/projection.ts`, `context/sync-store-event.ts`, `context/sync-state.ts` —
  `task.queue.created/updated/deleted` events maintain `sync.data.task_queue`, which **no TUI component reads**.

Durable queue and its consumers (keep):

- `packages/ax-code/src/session/task-queue.ts` — durable rows: `status` (`queued`, `waiting_for_idle`, `running`,
  `blocked_permission`, `blocked_question`, `paused`, `failed`, `completed`, `cancelled`), `position`, `priority`,
  payload; `enqueue`, `claimForExecution`, `recoverInterrupted`, `reorder`, `sendNow`, etc.
- `packages/ax-code/src/session/task-queue-executor.ts` — `start`, `drainNextForSession`, `shouldWaitForIdle`,
  workflow phase parallelism (`shouldWaitForWorkflowPhaseSlot`), pacing (`workflowPacingWaitMs`), and detached execution.
- `packages/ax-code/src/workflow/scheduler.ts` — enqueues workflow children.
- `packages/ax-code/src/session/scheduled-task.ts` — enqueues scheduled prompts.
- `packages/ax-code/src/project/bootstrap.ts` — `TaskQueue.recoverInterrupted` at boot.
- `packages/ax-code/src/server/routes/task-queue.ts` — full management API (list/get/status/pause/resume/cancel/retry/
  send-now/reorder/delete).

Reference implementation already shipped in desktop:

- `ax-code-desktop/packages/ui/src/stores/messageQueueStore.ts` (Zustand, per-session, localStorage, `queueModeEnabled`).
- `ax-code-desktop/packages/ui/src/components/chat/QueuedMessageChips.tsx` (edit / send / delete chips).
- `ax-code-desktop/packages/ui/src/hooks/useQueuedMessageAutoSend.ts` (`busy/retry → idle` FIFO auto-send via normal
  `sendMessage`, captured send config, in-flight + recent-abort guards).

## Design Principles

1. **One source of truth per layer.** Interactive queue reads its own client buffer; durable queue reads `task_queue`.
2. **Ephemeral by default for interactive input.** Follow-ups are transient; durability stays on `TaskQueue`.
3. **No out-of-band processing.** Never persist a queued user message while a turn is running (the loop would re-scan and
   double-run it on drain). Replay through the normal prompt path only when idle.
4. **Contract reuse.** Interactive replay uses the existing synchronous `/prompt` path; durable needs use existing
   `/task-queue` and `prompt_async` routes (kept for non-interactive callers).
5. **No new Effect** (ADR-017); async/await + Zod + `Result`/`try-catch` at boundaries.
6. **Cross-client parity.** TUI follow-up semantics match desktop so users learn one model.

## Options Considered

### Option A — Lightweight client-side interactive queue (recommended)

Mirror desktop in the TUI. Buffer follow-ups in renderer state (a session-scoped signal/store), render the "Queued"
section from that buffer, and replay FIFO via the synchronous prompt path on `busy/retry → idle`. Plain interactive turns
call `/prompt` directly (or `prompt_async` only for the *first* dispatch), never creating `waiting_for_idle` rows for
manually-typed follow-ups.

- **Pros:** matches shipped desktop + Codex CLI; removes the broken memo and dead `task_queue` read; minimal backend
  change; no double-run risk; cheap edit/delete/send-now.
- **Cons:** follow-ups are not durable across restart; introduces a small TUI state machine (must reuse desktop's
  in-flight/recent-abort guards to avoid known Codex-style "stuck/duplicate send" bugs).

### Option B — Make the TUI read the durable queue

Keep `prompt_async → TaskQueue`, but render the "Queued" section from `sync.data.task_queue`
(`status ∈ {queued, waiting_for_idle}`, session-scoped, ordered by `position`), wire delete to
`POST /task-queue/:id/cancel`, send-now to `/task-queue/:id/send-now`, reorder to `/task-queue/:id/reorder`, and load the
initial list on session open.

- **Pros:** durable follow-ups; reuses the full management API; single backend queue.
- **Cons:** heavyweight for transient input; diverges from desktop; requires snippet rendering from item payload, bootstrap
  fetch, and careful lifecycle wiring (delete must cancel the row, not just remove a message); keeps every keystroke-turn
  on durable rows.

### Option C — Remove interactive queueing entirely

Drop the "Queued" UI; messages typed while busy are rejected or steer the current turn only.

- **Rejected:** regresses a real, expected UX that both Codex and desktop support.

**Decision (see ADR-028):** Option A for interactive follow-ups; retain `TaskQueue` for durable orchestration. Option B's
machinery is preserved for a future explicit "background/durable tasks" panel, not the interactive follow-up section.

## Detailed Design (Option A)

### Client state

- A session-scoped follow-up buffer in TUI state (parallel to desktop's `messageQueueStore`): ordered list of
  `{ id, parts, agent, model, variant, createdAt }`. Ephemeral (in-memory; optional kv persistence later).
- A `queueModeEnabled`-equivalent and a "steer vs queue" submit decision in the prompt component.

### Submit flow

1. On submit while `sessionPhase !== 'idle'` and queue-mode/queue-key active → push to the buffer (do **not** hit the
   server).
2. On submit while idle → dispatch immediately via `/prompt`.
3. **Steer now** (Codex `Enter`-equivalent) → dispatch immediately (server appends to the active turn via the existing
   loop re-scan; no buffer entry).
4. **Queue next turn** (Codex `Tab`-equivalent) → push to buffer.

### Drain flow

- Subscribe to session status; on `busy/retry → idle`, pop the head of the buffer and dispatch via `/prompt` using the
  captured send config. Reuse desktop guards: per-session in-flight set, recent-abort window, idle re-check before send,
  remove-on-success. This directly mirrors `useQueuedMessageAutoSend.ts`.

### Display

- Replace the `queued` memo in `sidebar.tsx` with a read of the client buffer (snippet from buffered parts; count;
  expand/collapse unchanged).
- `dropQueued(id)` removes the buffer entry (no server call). Add send-now (dispatch immediately + remove) and edit
  (pop back to input).
- Reconcile the in-conversation "queued" badge in `index.tsx`/`view-model.ts` with the same buffer concept, or scope it to
  the brief pre-assistant window only.

### Backend changes

- Interactive TUI no longer routes plain follow-ups through `prompt_async`. The async route and `/task-queue` API remain
  for headless runtime, SDK, workflow, scheduled, and automation callers.
- Either delete `task_queue` from the interactive sync store/projection consumption or keep it strictly for a future
  durable-tasks panel; do not leave it populated-but-unread.

## Migration / Rollout

1. Land the TUI follow-up buffer + drain + display, and switch interactive submission off `prompt_async`, in one change to
   avoid mixed-source ordering.
2. Keep `TaskQueue`, executor, `/task-queue` routes, scheduler, scheduled-task, and recovery untouched.
3. Remove or quarantine the dead `task_queue` interactive read.
4. Revert/remove the messages-based `queued` memo from `1656f0c09`.

## Test Plan

- Unit: follow-up buffer ops (add/remove/pop/clear/order); steer-vs-queue decision; drain dispatch decision
  (`busy/retry → idle`, idle re-check, recent-abort, in-flight) — port the desktop `useQueuedMessageAutoSend.test.ts`
  cases.
- Integration: submit-while-busy shows buffered item; FIFO drain on idle; delete prevents run; send-now runs immediately;
  no `waiting_for_idle` rows created for interactive follow-ups.
- Regression: existing `task-queue.test.ts`, `task-queue-routes.test.ts`, workflow phase/pacing, scheduled-task, and
  `recoverInterrupted` tests stay green.
- Guard: assert no TUI component reads an unpopulated queue field and no populated field is unread without intent.

## Open Questions

- Should interactive follow-ups gain optional kv persistence (survive TUI restart) like desktop's localStorage, or stay
  fully ephemeral like Codex CLI? Default: ephemeral, with kv as a later opt-in.
- Do we expose a separate "background/durable tasks" panel sourced from `task_queue` now, or defer until workflow
  supervision UI lands (ADR-025)? Default: defer; remove the dead read meanwhile.
- Keybindings for steer-vs-queue in the TUI (Codex uses Enter/Tab/Esc); reconcile with existing AX Code TUI bindings.
