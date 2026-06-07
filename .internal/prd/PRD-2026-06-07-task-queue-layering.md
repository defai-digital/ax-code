# PRD: Task Queue Layering — Separate Durable Orchestration from Interactive Follow-up Queueing

**Date:** 2026-06-07
**Status:** Implemented 2026-06-07 (interactive follow-up queue); steer-now keybindings, `prompt_async` transport
removal, kv persistence, and the durable-tasks panel explicitly deferred (see ADR-028 Follow-ups)
**Scope:** Internal
**Owner:** ax-code maintainers
**Related:** ADR-028, ADR-025 (Workflow Runtime boundary), ADR-022 (Codex-like desktop app), ADR-018 (app/headless SDK boundary),
`.internal/prd/TECH-SPEC-2026-06-07-task-queue-layering.md`
**Archive criteria:** Archive when the interactive follow-up queue ships as a lightweight ephemeral model in the TUI, the
broken messages-based "Queued" display is removed, and the durable `TaskQueue` is documented as a backend-only
orchestration primitive — or when this direction is explicitly rejected with implementation evidence.

---

## Purpose

Decide whether to remove or reduce AX Code's task queue, and define the right shape for "queue work while the agent is
busy." The conclusion is **reduce, not remove**: keep the durable server-owned `TaskQueue` as a backend orchestration
primitive, and replace the heavyweight, currently-broken interactive queue path with a lightweight, ephemeral,
client-side follow-up queue aligned with `ax-code-desktop` and Codex CLI.

## Problem

AX Code conflates two very different concerns under one mechanism:

1. **Interactive follow-up queueing** — a user types another message while the current turn is running and expects it to
   run next. This is a per-session, ephemeral UX concern.
2. **Durable task orchestration** — workflow subagent fan-out, phase parallelism, pacing/budget, scheduled tasks,
   automations, and crash recovery. This is a backend, durable, multi-item concern.

Today both go through the same durable `TaskQueue`:

- The TUI submits **every** interactive prompt through the async route
  (`packages/ax-code/src/cli/cmd/tui/component/prompt/index.tsx` → `prompt_async`/`command_async`/`shell_async`).
- The server handler enqueues a durable queue item and starts the executor
  (`packages/ax-code/src/server/routes/session.ts` `startAsyncSessionHandler` → `TaskQueue.enqueue` +
  `TaskQueueExecutor.start`).
- Items submitted while busy become `waiting_for_idle` queue rows
  (`packages/ax-code/src/session/task-queue-executor.ts` `shouldWaitForIdle`), and the **user message is not persisted
  until the item executes** (creation happens inside `SessionPrompt.prompt` → `createUserMessage`).

The TUI's "Queued" sidebar section is derived from **persisted messages without an assistant parent**
(`packages/ax-code/src/cli/cmd/tui/routes/session/sidebar.tsx`, the `queued` memo). Because truly-queued
(`waiting_for_idle`) items have no persisted message yet, the section cannot show the real backlog. The actual queue
state is synced to the TUI store as `sync.data.task_queue`
(`packages/ax-code/src/runtime/headless/projection.ts`, `sync-store-event.ts`, `sync-state.ts`) but is **never read by
any TUI component**. A recent fix (`1656f0c09`) moved the memo onto messages, which cannot work for the async-queue model
because persisting a message at enqueue time would let the running loop re-scan and process it out of band, double-running
it on drain.

Net effect: the user-facing queue is over-engineered (durable rows, statuses, positions for a transient UX) and visibly
broken, while the parts of `TaskQueue` that matter — workflows, scheduled tasks, automations, recovery — are legitimate
and must be preserved.

## Research Inputs

Reviewed 2026-06-07.

- **Codex CLI** (local TUI): lightweight, in-memory, ephemeral follow-up queue with two explicit modes — **Enter** injects
  into the current turn (steer), **Tab** queues a follow-up (text / slash / `!` shell) for the next turn (FIFO), **Esc**
  interrupts / sends immediately. The queue is not durable (it is cleared on agent switch). Sources:
  - <https://developers.openai.com/codex/cli/features>
  - <https://github.com/openai/codex/pull/18542> (queue slash/shell prompts in the TUI)
  - <https://github.com/openai/codex/issues/13595> (Enter = immediate, Tab = queue)
  - <https://github.com/openai/codex/issues/9096> (queue new instructions instead of interrupting)
- **Codex app / cloud**: the "queue" is multi-task orchestration, not in-session message queueing — multiple
  threads/agents, parallel tasks via worktrees, a **"needs review" queue** of completed results, and scheduled
  automations. Sources:
  - <https://developers.openai.com/codex/cloud>
  - <https://developers.openai.com/codex/app/features>
- **ax-code-desktop** (`/Users/akiralam/code/ax-code-desktop`): already ships a lightweight client-side message queue —
  Zustand store persisted to localStorage (`packages/ui/src/stores/messageQueueStore.ts`), chips UI with per-item
  edit/send/delete (`packages/ui/src/components/chat/QueuedMessageChips.tsx`), and idle auto-send via the **normal**
  `sendMessage()` SDK call on `busy/retry → idle` (`packages/ui/src/hooks/useQueuedMessageAutoSend.ts`). It does **not**
  use `prompt_async` or `/task-queue`.

Local AX Code context:

- ADR-025 makes the Workflow Runtime the durable-orchestration spine; `TaskQueue` is its execution substrate
  (`workflow/scheduler.ts` enqueues children; phase parallelism and pacing live in the executor).
- Scheduled tasks enqueue durable items (`packages/ax-code/src/session/scheduled-task.ts`).
- Crash recovery requeues interrupted items at boot (`packages/ax-code/src/project/bootstrap.ts` →
  `TaskQueue.recoverInterrupted`).
- ADR-022 keeps desktop renderer state reconstructable from backend state; ADR-018 keeps app/TUI on typed SDK/projection
  contracts.

## Goals

1. Resolve the user-reported "task queue is not working" by giving interactive follow-up queueing a single, correct data
   source and a working display.
2. Preserve durable `TaskQueue` for workflow, scheduled-task, automation, and recovery use.
3. Stop routing ordinary interactive turns through a durable queue when a lightweight model is sufficient.
4. Adopt the proven two-mode UX (steer now vs. queue next turn) with per-item edit / delete / send-now.
5. Keep one authoritative queue source per layer; remove the dead `sync.data.task_queue` path or wire it intentionally.
6. Align TUI and desktop behavior so the two clients teach users the same mental model.

## Non-Goals

- Removing or rewriting the Workflow Runtime, scheduled tasks, automations, or crash recovery.
- Building Codex-cloud-style multi-session parallel orchestration or a "needs review" queue inside a single TUI session.
- Introducing remote/transport surfaces (still gated by ADR-023).
- Any new Effect usage (ADR-017).

## Users and Use Cases

- **Interactive user (TUI/desktop):** "While Claude is working, let me line up the next instruction(s), see them, edit or
  cancel them, optionally push one to run now, and have them run in order when the turn finishes." → lightweight ephemeral
  queue.
- **Workflow/automation author:** "Fan out N subagents with phase parallelism, pacing, and budgets; survive a restart." →
  durable `TaskQueue` (unchanged).
- **Scheduler:** "Enqueue a prompt to run later / on a cron." → durable `TaskQueue` (unchanged).

## Proposed Direction

**Two layers, one source of truth each.**

1. **Interactive follow-up queue (reduce):** Make the TUI follow-up queue lightweight, ephemeral, and client-owned, mirror
   the desktop model — buffer pending follow-ups in renderer state, render them from that buffer, and replay them via the
   ordinary synchronous prompt path on `busy/retry → idle`. Remove the messages-based `queued` memo and the per-prompt
   `prompt_async → TaskQueue` routing for plain interactive turns.
2. **Durable orchestration queue (keep):** Reserve `TaskQueue` for workflow children, scheduled tasks, automations, and
   recovery. Its synced `task_queue` projection is either consumed by an explicit (future) "background tasks" panel or
   removed from the interactive store to avoid a dead, misleading field.
3. **Two-mode UX:** "Queue next turn" (FIFO, default while busy) and "Steer now" (inject into the active turn), plus
   per-item edit / delete / send-now, matching Codex CLI and the desktop chips.

The technical design, options, and trade-offs are in the tech spec; the boundary decision is recorded in ADR-028.

## Success Metrics / Done When

- [done] Submitting follow-up messages while busy shows them immediately in the TUI, in order, with edit/delete/send-now,
  and they run FIFO when the session goes idle.
- [done] Deleting a queued follow-up reliably prevents it from running (no resurrection, no double-run).
- [done] Plain interactive turns no longer create durable `waiting_for_idle` rows (follow-ups are buffered client-side;
  idle dispatch claims and runs immediately rather than parking a waiting row).
- [done] `TaskQueue` continues to drive workflow/scheduled/automation/recovery with no regression in their tests.
- [done] No populated queue field goes unread without intent: `sync.data.task_queue` is documented as the durable
  supervision projection (ADR-025), and the interactive "Queued" section reads the client store.

Implementation note (2026-06-07): landed on `feat/tui-follow-up-queue`. See ADR-028 Follow-ups for the file list and the
explicitly-deferred items (steer-now keybindings, `prompt_async` transport removal, kv persistence, durable-tasks panel).

## Risks

- **Behavioral divergence during migration:** while both paths exist, ordering/visibility could differ. Mitigate by
  landing the TUI follow-up queue and removing the async-per-prompt routing in the same change.
- **Loss of durability for follow-ups:** ephemeral follow-ups are lost on crash/restart. This matches Codex CLI and
  desktop and is acceptable for transient input; durable needs stay on `TaskQueue`.
- **Hidden dependencies on `prompt_async`:** other clients (headless runtime, SDK) may rely on the async route; keep the
  route for those callers and only change the interactive TUI submission policy.
