import type { PermissionRequest, QuestionRequest } from "@ax-code/sdk/v2"
import { Binary } from "@ax-code/util/binary"
import { Permission } from "@/permission"
import type { HeadlessRuntimeEvent, HeadlessRuntimeProbeKey, HeadlessRuntimeStatusEvent } from "./event"

const DEFAULT_MAX_SESSION_MESSAGES = 100
const pendingPartDeltaText = new WeakMap<object, Map<string, Map<string, string>>>()

export interface HeadlessProjectionState<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TRisk = unknown,
  TGoal = unknown,
  TTaskQueueItem extends { id: string } = { id: string },
> {
  stream_health: HeadlessStreamHealth
  permission: Record<string, PermissionRequest[]>
  question: Record<string, QuestionRequest[]>
  todo: Record<string, TTodo[]>
  session_diff: Record<string, TDiff[]>
  session_status: Record<string, TStatus>
  session_error: Record<string, unknown>
  session_risk: Record<string, TRisk>
  session_goal: Record<string, TGoal | null>
  task_queue: TTaskQueueItem[]
  session: TSession[]
  message: Record<string, TMessage[]>
  part: Record<string, TPart[]>
  vcs: { branch: string } | undefined
}

export type HeadlessStreamHealth = "fixture" | "connecting" | "connected" | "unavailable" | "error"

export type HeadlessProjectionEffect =
  | { type: "permission.auto_reply"; requestID: string }
  | { type: "question.auto_reply"; requestID: string; questions: QuestionRequest["questions"] }
  | { type: "runtime.probe"; key: HeadlessRuntimeProbeKey }
  | { type: "bootstrap.reload" }

export type HeadlessProjectionApplyResult = {
  handled: boolean
  effects: HeadlessProjectionEffect[]
}

export function createHeadlessProjectionState<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TRisk = unknown,
  TGoal = unknown,
  TTaskQueueItem extends { id: string } = { id: string },
>(
  input: { streamHealth?: HeadlessStreamHealth } = {},
): HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk, TGoal, TTaskQueueItem> {
  return {
    stream_health: input.streamHealth ?? "connecting",
    permission: {},
    question: {},
    todo: {},
    session_diff: {},
    session_status: {},
    session_error: {},
    session_risk: {},
    session_goal: {},
    task_queue: [],
    session: [],
    message: {},
    part: {},
    vcs: undefined,
  }
}

export function applyHeadlessProjectionEvent<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TRisk = unknown,
  TGoal = unknown,
  TTaskQueueItem extends { id: string } = { id: string },
>(
  state: HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk, TGoal, TTaskQueueItem>,
  event: HeadlessRuntimeEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TGoal, TTaskQueueItem>,
  options: {
    autonomous?: boolean
    maxSessionMessages?: number
  } = {},
): HeadlessProjectionApplyResult {
  const effects: HeadlessProjectionEffect[] = []

  switch (event.type) {
    case "server.connected":
    case "server.heartbeat":
      state.stream_health = "connected"
      return { handled: true, effects }

    case "server.serialization_error":
    case "server.resync_required":
      effects.push({ type: "bootstrap.reload" })
      return { handled: true, effects }

    case "server.instance.disposed":
      state.stream_health = "unavailable"
      effects.push({ type: "bootstrap.reload" })
      return { handled: true, effects }

    case "permission.asked":
      // Interactive-only permissions and permissions that explicitly forbid
      // autonomous approval (such as real-desktop control) need a human
      // decision. Leave them pending so a connected UI or explicit reply can
      // answer; the headless event projection must not bypass Permission.ask.
      if (
        options.autonomous &&
        !Permission.isInteractiveOnly(event.properties.permission) &&
        !Permission.isNeverAutonomousAutoApprove(event.properties.permission)
      ) {
        effects.push({ type: "permission.auto_reply", requestID: event.properties.id })
        return { handled: true, effects }
      }
      appendRequest(state.permission, event.properties)
      return { handled: true, effects }

    case "permission.replied":
      removeRequest(state.permission, event.properties.sessionID, event.properties.requestID)
      return { handled: true, effects }

    case "question.asked":
      if (options.autonomous) {
        effects.push({
          type: "question.auto_reply",
          requestID: event.properties.id,
          questions: event.properties.questions,
        })
        return { handled: true, effects }
      }
      appendRequest(state.question, event.properties)
      return { handled: true, effects }

    case "question.replied":
    case "question.rejected":
      removeRequest(state.question, event.properties.sessionID, event.properties.requestID)
      return { handled: true, effects }

    case "todo.updated":
      state.todo[event.properties.sessionID] = event.properties.todos
      return { handled: true, effects }

    case "session.diff":
      state.session_diff[event.properties.sessionID] = event.properties.diff
      return { handled: true, effects }

    case "session.goal":
      state.session_goal[event.properties.sessionID] = event.properties.goal
      return { handled: true, effects }

    case "session.status":
      state.session_status[event.properties.sessionID] = event.properties.status
      return { handled: true, effects }

    case "session.error":
      if (event.properties.sessionID) {
        state.session_error[event.properties.sessionID] = event.properties.error
      }
      return { handled: true, effects }

    case "task.queue.created":
    case "task.queue.updated":
      upsertByID(state.task_queue, event.properties.item)
      return { handled: true, effects }

    case "task.queue.deleted":
      removeByID(state.task_queue, event.properties.id)
      return { handled: true, effects }

    case "scheduled.task.created":
    case "scheduled.task.updated":
    case "scheduled.task.deleted":
      return { handled: false, effects }

    case "session.created":
    case "session.updated":
      upsertByID(state.session, event.properties.info)
      return { handled: true, effects }

    case "session.deleted":
      deleteSessionState(state, event.properties.info.id)
      return { handled: true, effects }

    case "message.updated":
      upsertMessage(state, event.properties.info, options.maxSessionMessages)
      return { handled: true, effects }

    case "message.removed":
      removeMessage(state, event.properties.sessionID, event.properties.messageID)
      return { handled: true, effects }

    case "message.part.updated":
      upsertPart(state, event.properties.part)
      return { handled: true, effects }

    case "message.part.delta":
      if (event.properties.field === "text") {
        appendPartTextDelta(
          state,
          event.properties.messageID,
          event.properties.partID,
          event.properties.delta,
          event.properties.offset,
        )
      }
      return { handled: true, effects }

    case "message.part.removed":
      removePart(state, event.properties.messageID, event.properties.partID)
      return { handled: true, effects }

    case "vcs.branch.updated":
      state.vcs = { branch: event.properties.branch }
      return { handled: true, effects }

    case "mcp.tools.changed":
      effects.push({ type: "runtime.probe", key: "mcp" })
      return { handled: true, effects }

    case "lsp.updated":
      effects.push({ type: "runtime.probe", key: "lsp" }, { type: "runtime.probe", key: "debug-engine" })
      return { handled: true, effects }

    // Provider discovery completion carries no shared projection state — the
    // TUI refetches its provider list directly off this event. Treat it as a
    // no-op here so non-TUI headless consumers ignore it cleanly.
    case "provider.updated":
      return { handled: false, effects }

    case "code.index.progress":
    case "code.index.state":
      effects.push({ type: "runtime.probe", key: "debug-engine" })
      return { handled: true, effects }

    case "workflow.run.created":
    case "workflow.run.updated":
    case "workflow.run.started":
    case "workflow.run.blocked":
    case "workflow.run.paused":
    case "workflow.run.resumed":
    case "workflow.run.completed":
    case "workflow.run.failed":
    case "workflow.run.cancelled":
    case "workflow.phase.updated":
    case "workflow.phase.started":
    case "workflow.phase.completed":
    case "workflow.phase.failed":
    case "workflow.child.created":
    case "workflow.child.updated":
    case "workflow.child.started":
    case "workflow.child.completed":
    case "workflow.child.failed":
    case "workflow.child.cancelled":
    case "workflow.artifact.written":
    case "workflow.budget.appended":
    case "workflow.budget.warning":
    case "workflow.budget.exceeded":
    case "workflow.verification.attached":
      effects.push({ type: "runtime.probe", key: "workflow" })
      return { handled: true, effects }
  }

  const _exhaustive: never = event
  return { handled: false, effects: _exhaustive }
}

export function runtimeProbeKeysForEvent(event: HeadlessRuntimeStatusEvent): HeadlessRuntimeProbeKey[] {
  switch (event.type) {
    case "mcp.tools.changed":
      return ["mcp"]
    case "lsp.updated":
      return ["lsp", "debug-engine"]
    case "code.index.progress":
    case "code.index.state":
      return ["debug-engine"]
    case "vcs.branch.updated":
      return []
    case "workflow.run.created":
    case "workflow.run.updated":
    case "workflow.run.started":
    case "workflow.run.blocked":
    case "workflow.run.paused":
    case "workflow.run.resumed":
    case "workflow.run.completed":
    case "workflow.run.failed":
    case "workflow.run.cancelled":
    case "workflow.phase.updated":
    case "workflow.phase.started":
    case "workflow.phase.completed":
    case "workflow.phase.failed":
    case "workflow.child.created":
    case "workflow.child.updated":
    case "workflow.child.started":
    case "workflow.child.completed":
    case "workflow.child.failed":
    case "workflow.child.cancelled":
    case "workflow.artifact.written":
    case "workflow.budget.appended":
    case "workflow.budget.warning":
    case "workflow.budget.exceeded":
    case "workflow.verification.attached":
      return ["workflow"]
  }
  return []
}

function appendRequest<TRequest extends { id: string; sessionID: string }>(
  target: Record<string, TRequest[]>,
  request: TRequest,
) {
  const list = target[request.sessionID] ?? []
  upsertByID(list, request)
  target[request.sessionID] = list
}

function removeRequest<TRequest extends { id: string }>(
  target: Record<string, TRequest[]>,
  sessionID: string,
  requestID: string,
) {
  target[sessionID] = (target[sessionID] ?? []).filter((request) => request.id !== requestID)
}

function upsertByID<T extends { id: string }>(list: T[], item: T) {
  const result = Binary.search(list, item.id, (entry) => entry.id)
  if (result.found) {
    mergeSnapshotInPlace(list[result.index], item)
    return
  }
  list.splice(result.index, 0, item)
}

// Merge snapshot fields onto the existing entry instead of replacing it.
// Replacing the object (`list[i] = item`) swaps the Solid store proxy
// identity, which makes identity-keyed consumers (`<For>` rows,
// `sameDisplayPart` caches) destroy and recreate the whole message/part
// component subtree — during streaming that meant a remount + full markdown
// re-lex every part-snapshot window (the "backend is running, screen looks
// frozen" storm). Merging keeps the row mounted and lets fine-grained field
// tracking update only what actually changed.
function mergeSnapshotInPlace<T extends { id: string }>(existing: T, incoming: T) {
  for (const key of Object.keys(incoming) as Array<keyof T>) {
    existing[key] = incoming[key]
  }
}

function deleteSessionState<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TRisk = unknown,
  TGoal = unknown,
  TTaskQueueItem extends { id: string } = { id: string },
>(
  state: HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk, TGoal, TTaskQueueItem>,
  sessionID: string,
) {
  state.session = state.session.filter((session) => session.id !== sessionID)
  state.task_queue = state.task_queue.filter((item) => {
    const scoped = item as TTaskQueueItem & { sessionID?: string }
    return scoped.sessionID !== sessionID
  })
  for (const message of state.message[sessionID] ?? []) {
    delete state.part[message.id]
    clearPendingMessageDeltaText(state, message.id)
  }
  delete state.permission[sessionID]
  delete state.question[sessionID]
  delete state.todo[sessionID]
  delete state.session_diff[sessionID]
  delete state.session_status[sessionID]
  delete state.session_error[sessionID]
  delete state.session_risk[sessionID]
  delete state.session_goal[sessionID]
  delete state.message[sessionID]
}

function upsertMessage<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TRisk = unknown,
  TGoal = unknown,
>(
  state: HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk, TGoal>,
  message: TMessage,
  maxSessionMessages = DEFAULT_MAX_SESSION_MESSAGES,
) {
  const list = state.message[message.sessionID] ?? []
  upsertByID(list, message)
  for (const removed of shiftOverflow(list, maxSessionMessages)) {
    delete state.part[removed.id]
    clearPendingMessageDeltaText(state, removed.id)
  }
  state.message[message.sessionID] = list
}

function removeMessage<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TRisk = unknown,
  TGoal = unknown,
>(
  state: HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk, TGoal>,
  sessionID: string,
  messageID: string,
) {
  removeByID(state.message[sessionID] ?? [], messageID)
  delete state.part[messageID]
  clearPendingMessageDeltaText(state, messageID)
}

function upsertPart<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TRisk,
  TGoal,
>(state: HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk, TGoal>, part: TPart) {
  const list = state.part[part.messageID] ?? []
  const result = Binary.search(list, part.id, (entry) => entry.id)
  if (result.found) mergePartSnapshotInPlace(state, list[result.index], part)
  else list.splice(result.index, 0, part)
  state.part[part.messageID] = list
}

function appendPartTextDelta<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TRisk,
  TGoal,
>(
  state: HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk, TGoal>,
  messageID: string,
  partID: string,
  delta: string,
  offset?: number,
) {
  const list = state.part[messageID] ?? []
  const result = Binary.search(list, partID, (entry) => entry.id)
  if (!result.found) return
  const part = list[result.index] as TPart & { type?: string; text?: string }
  if (part.type !== "text" && part.type !== "reasoning") return
  const current = part.text ?? ""
  // Offset = accumulated text length before this delta. The same text also
  // arrives via full `message.part.updated` snapshots, and the two channels
  // are not ordered against each other (independent 16ms coalescing windows,
  // bootstrap refetches, replay). Reconcile instead of blindly appending:
  // append only the suffix not yet applied; a delta ahead of the accumulated
  // text (gap) is skipped — the next snapshot is authoritative and heals it.
  let next: string
  if (typeof offset === "number") {
    if (offset > current.length) return
    next = current + delta.slice(current.length - offset)
  } else {
    // Legacy producers without an offset: append-only, as before.
    next = current + delta
  }
  if (next === current) return
  part.text = next
  setPendingPartDeltaText(state, messageID, partID, next)
}

function removePart<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TRisk,
  TGoal,
>(
  state: HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk, TGoal>,
  messageID: string,
  partID: string,
) {
  removeByID(state.part[messageID] ?? [], partID)
  clearPendingPartDeltaText(state, messageID, partID)
}

function mergePartSnapshotInPlace<TPart extends { id: string; messageID: string }>(
  state: object,
  existing: TPart,
  incoming: TPart,
) {
  const previous = (existing as { text?: unknown }).text
  const next = (incoming as { text?: unknown }).text
  const pending = getPendingPartDeltaText(state, incoming.messageID, incoming.id)
  const terminal = typeof (incoming as { time?: { end?: unknown } }).time?.end === "number"
  // Only protect text actually extended by a delta and not yet acknowledged
  // by an equal/newer snapshot. Otherwise a legitimate prefix rollback would
  // be indistinguishable from a stale coalesced snapshot and ignored forever.
  // A terminal snapshot is authoritative and may legitimately trim trailing
  // whitespace from the accumulated stream.
  const preservePendingDelta =
    !terminal &&
    typeof pending === "string" &&
    previous === pending &&
    typeof next === "string" &&
    next.length < pending.length &&
    pending.startsWith(next)

  for (const key of Object.keys(incoming) as Array<keyof TPart>) {
    if (key === "text" && preservePendingDelta) continue
    existing[key] = incoming[key]
  }
  if (Object.prototype.hasOwnProperty.call(incoming, "text") && !preservePendingDelta) {
    clearPendingPartDeltaText(state, incoming.messageID, incoming.id)
  }
}

function getPendingPartDeltaText(state: object, messageID: string, partID: string) {
  return pendingPartDeltaText.get(state)?.get(messageID)?.get(partID)
}

function setPendingPartDeltaText(state: object, messageID: string, partID: string, text: string) {
  let messages = pendingPartDeltaText.get(state)
  if (!messages) {
    messages = new Map()
    pendingPartDeltaText.set(state, messages)
  }
  let parts = messages.get(messageID)
  if (!parts) {
    parts = new Map()
    messages.set(messageID, parts)
  }
  parts.set(partID, text)
}

function clearPendingPartDeltaText(state: object, messageID: string, partID: string) {
  const messages = pendingPartDeltaText.get(state)
  const parts = messages?.get(messageID)
  if (!messages || !parts) return
  parts.delete(partID)
  if (parts.size === 0) messages.delete(messageID)
  if (messages.size === 0) pendingPartDeltaText.delete(state)
}

function clearPendingMessageDeltaText(state: object, messageID: string) {
  const messages = pendingPartDeltaText.get(state)
  if (!messages) return
  messages.delete(messageID)
  if (messages.size === 0) pendingPartDeltaText.delete(state)
}

function removeByID<T extends { id: string }>(list: T[], id: string) {
  const result = Binary.search(list, id, (entry) => entry.id)
  if (!result.found) return undefined
  const [removed] = list.splice(result.index, 1)
  return removed
}

function shiftOverflow<T>(list: T[], maxSize: number) {
  const finiteMaxSize = Number.isFinite(maxSize) ? maxSize : DEFAULT_MAX_SESSION_MESSAGES
  const limit = Math.max(0, Math.floor(finiteMaxSize))
  if (list.length <= limit) return []
  return list.splice(0, list.length - limit)
}
