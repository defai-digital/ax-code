# ADR-028: Separate interactive follow-up queueing from the durable task queue

## Status

Accepted - interactive follow-up queue implemented 2026-06-07 (ephemeral client-owned buffer with
queue/drain/display/delete/send-now/edit). Deferred: steer-now keybindings, removing `prompt_async` as the
interactive transport, optional kv persistence, and the durable-tasks supervision panel (see Consequences).

## Date

2026-06-07

## Deciders

ax-code maintainers

## Related

- `.internal/prd/PRD-2026-06-07-task-queue-layering.md`
- `.internal/prd/TECH-SPEC-2026-06-07-task-queue-layering.md`
- `.internal/adr/ADR-025-workflow-runtime-boundary.md`
- `.internal/adr/ADR-022-codex-like-desktop-app-from-openchamber-baseline.md`
- `.internal/adr/ADR-018-app-headless-sdk-boundary.md`
- `.internal/adr/ADR-017-effect-framework-freeze.md`

## Context

AX Code uses a single durable `TaskQueue` (`packages/ax-code/src/session/task-queue.ts`) for two unrelated concerns:

1. **Interactive follow-up queueing** — the user types another message while a turn is running and expects it to run next.
2. **Durable orchestration** — workflow subagent fan-out, phase parallelism, pacing/budget, scheduled tasks, automations,
   and crash recovery.

The TUI routes **every** interactive prompt through `prompt_async` → `TaskQueue.enqueue` → `TaskQueueExecutor.start`
(`cli/cmd/tui/component/prompt/index.tsx`, `server/routes/session.ts`). Follow-ups submitted while busy become durable
`waiting_for_idle` rows, and the user message is **not persisted until the item executes** (creation lives inside
`SessionPrompt.prompt` → `createUserMessage`). Meanwhile the TUI "Queued" sidebar derives from persisted messages with no
assistant `parentID` (`cli/cmd/tui/routes/session/sidebar.tsx`), so it cannot show the real backlog. The genuine queue
state is synced to `sync.data.task_queue` (`runtime/headless/projection.ts`) but is **never read by any TUI component**.
Commit `1656f0c09` moved the memo onto messages, which cannot work for the async model: persisting a message at enqueue
time would let the running loop re-scan and process it out of band, double-running it on drain.

External and internal references reviewed 2026-06-07:

- **Codex CLI** keeps interactive follow-up queueing lightweight and ephemeral, with two explicit modes — Enter (steer the
  current turn), Tab (queue the next turn, FIFO), Esc (interrupt / send now). It is not durable.
  (<https://developers.openai.com/codex/cli/features>, <https://github.com/openai/codex/pull/18542>,
  <https://github.com/openai/codex/issues/13595>, <https://github.com/openai/codex/issues/9096>)
- **Codex app / cloud** treats "queue" as multi-task orchestration (parallel sessions/worktrees, a "needs review" queue of
  completed work, scheduled automations) — the analog of AX Code's Workflow Runtime and scheduled tasks, not in-session
  message queueing. (<https://developers.openai.com/codex/cloud>, <https://developers.openai.com/codex/app/features>)
- **ax-code-desktop** already ships the lightweight model: a client-side Zustand queue persisted to localStorage
  (`messageQueueStore.ts`), chips UI with edit/send/delete (`QueuedMessageChips.tsx`), and `busy/retry → idle` FIFO
  auto-send via the **normal** `sendMessage` SDK call (`useQueuedMessageAutoSend.ts`). It does not use `prompt_async` or
  `/task-queue`.

The durable parts of `TaskQueue` are load-bearing for ADR-025 (Workflow Runtime), scheduled tasks
(`session/scheduled-task.ts`), and crash recovery (`project/bootstrap.ts` → `TaskQueue.recoverInterrupted`), so removing
the queue wholesale is not viable.

## Decision

AX Code will treat task queueing as **two bounded layers with one source of truth each**, and will **reduce, not remove**,
the queue:

1. **Interactive follow-up queue = ephemeral, client-owned.** The TUI follow-up queue is a lightweight, in-memory,
   per-session client buffer, mirroring `ax-code-desktop` and Codex CLI. The "Queued" display reads this buffer. Buffered
   follow-ups are replayed FIFO via the **synchronous** prompt path on `busy/retry → idle`, reusing the desktop drain
   guards (in-flight set, recent-abort window, idle re-check, remove-on-success). Plain interactive turns are **not**
   routed through a durable queue and never create `waiting_for_idle` rows.

2. **Durable orchestration queue = backend-only.** `TaskQueue`, its executor, the `/task-queue` management API, the
   workflow scheduler, scheduled tasks, and `recoverInterrupted` are retained unchanged as the durable substrate for
   Workflow Runtime (ADR-025), scheduling, and recovery. The `prompt_async`/`command_async`/`shell_async` routes remain
   for non-interactive callers (headless runtime, SDK, workflow, scheduled, automation).

3. **No out-of-band processing.** A queued user message is never persisted while a turn is running. Interactive replay
   happens only when idle, through the normal prompt path.

4. **Two-mode interactive UX.** Provide "queue next turn" (FIFO, default while busy) and "steer now" (inject into the
   active turn), plus per-item edit / delete / send-now — matching Codex CLI and the desktop chips.

5. **No dead or misleading queue state.** Either consume `sync.data.task_queue` through an explicit (future) durable-tasks
   panel or remove it from interactive consumption; do not leave it populated-but-unread. Remove the messages-based
   `queued` memo introduced by `1656f0c09`.

This decision constrains where each queue may be used; the implementation design lives in the tech spec.

## Consequences

### Positive

- Fixes the user-reported "task queue is not working": follow-ups become visible, ordered, editable, and reliably
  deletable, with no resurrection or double-run.
- Removes durable rows and async routing from a transient UX concern, simplifying the interactive path.
- Aligns TUI and desktop behavior, and with the proven Codex CLI model, so users learn one mental model.
- Preserves the Workflow Runtime / scheduling / recovery substrate without change.
- Eliminates a dead, misleading store field and a memo that cannot work for the async model.

### Negative / Costs

- Interactive follow-ups become non-durable (lost on TUI restart), matching Codex CLI and desktop. Durable needs must use
  `TaskQueue` explicitly.
- Introduces a small TUI follow-up state machine; it must reuse desktop's guards to avoid Codex-style "stuck/duplicate
  send" edge cases.
- Two queueing concepts coexist; docs and code must keep the boundary explicit to avoid re-conflation.

### Follow-ups

Landed 2026-06-07 (commit on `feat/tui-follow-up-queue`):

- `follow-up-queue.ts` (pure reducers + status decisions) and `follow-up-queue-store.ts` (reactive singleton, dispatch
  with in-flight guard, recent-abort suppression, edit channel).
- Prompt: buffer plain prompts while busy, drain FIFO on busy/retry -> idle, suppress drain right after a manual
  interrupt; gated by the `prompt_queue_mode` kv flag (default on).
- Sidebar: "Queued" derives from the client store; per-item delete, send-now, and edit (pop-to-input). The
  messages-based memo is removed.
- The durable `task_queue` projection is explicitly documented as retained for the future supervision panel, not the
  interactive queue (resolves "no populated field unread without intent").
- Unit tests for the pure module + store; the render guardrail covers the new controls.

Review hardening pass (2026-06-07, code-review high):

- **Edit could be silently dropped** — several `Prompt` instances are mounted at once (session, permission, home), all consuming the global edit-request signal. The consuming effect now clears the request only in the instance it targets, so a non-matching instance can't swallow the edited text (the item was already removed from the queue, so this was real data loss).
- **Background sessions didn't auto-replay** — the drain now watches every session's status (`reconcileFollowUpDrain` over a snapshot of `session_status`), not just the on-screen session, so a queue replays when its session finishes even while another session is in view. This matches the desktop global auto-send hook. A shared previous-status baseline dedupes across the multiple mounted Prompt instances.
- **Double-dispatch window closed** — `dispatchFollowUp` now removes the item from the queue while the in-flight guard is still held, eliminating the gap between in-flight release and removal in which the same head could be dispatched twice.
- **Slash detection de-duplicated** — the busy-submit interception reuses the already-computed `slashName` instead of a third copy of the slash-command lookup.

Consciously accepted (not changed): the module-level singleton store (mirrors the desktop Zustand singleton; a context provider would be heavier with no behavior gain), the ad-hoc `followup-<ts>-<n>` id scheme (ephemeral client ids; `Identifier.ascending` needs a registered prefix), and the `queuedSnippet`/`followUpText` split (queue items don't carry synthetic/ignored text parts, so they don't diverge in practice).

Explicitly deferred (not required by the success metrics; recorded so the boundary stays honest):

- **Steer-now keybindings** (Enter = inject into current turn vs. Tab = queue next turn). The tech spec lists TUI
  keybinding reconciliation as an open question; send-now already covers "run this one now."
- **Removing `prompt_async` as the interactive transport.** Idle submits still dispatch via `prompt_async`, which claims
  and runs immediately (no `waiting_for_idle` row), so the measurable metric holds without a risky transport rewrite.
- **Optional kv persistence** of the follow-up buffer (currently ephemeral, matching Codex CLI) and the **durable-tasks
  supervision panel** sourced from `task_queue` (defer to workflow supervision UI under ADR-025).
