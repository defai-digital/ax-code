import type { PermissionRequest, QuestionRequest } from "../v2/index.js"
import type { HeadlessRuntimeEvent, HeadlessRuntimeStatusEvent } from "./event.js"

export interface HeadlessProjectionState<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TRisk = unknown,
  TGoal = unknown,
> {
  permission: Record<string, PermissionRequest[]>
  question: Record<string, QuestionRequest[]>
  todo: Record<string, TTodo[]>
  session_diff: Record<string, TDiff[]>
  session_status: Record<string, TStatus>
  session_error: Record<string, unknown>
  session_risk: Record<string, TRisk>
  session_goal: Record<string, TGoal | null>
  session: TSession[]
  message: Record<string, TMessage[]>
  part: Record<string, TPart[]>
  vcs: { branch: string } | undefined
}

export type HeadlessProjectionEffect =
  | { type: "permission.auto_reply"; requestID: string }
  | { type: "question.auto_reply"; requestID: string; questions: QuestionRequest["questions"] }
  | { type: "runtime.probe"; key: "mcp" | "lsp" | "debug-engine" }
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
>(): HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk, TGoal> {
  return {
    permission: {},
    question: {},
    todo: {},
    session_diff: {},
    session_status: {},
    session_error: {},
    session_risk: {},
    session_goal: {},
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
>(
  state: HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk, TGoal>,
  event: HeadlessRuntimeEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TGoal>,
  options: {
    autonomous?: boolean
    maxSessionMessages?: number
  } = {},
): HeadlessProjectionApplyResult {
  const effects: HeadlessProjectionEffect[] = []

  switch (event.type) {
    case "server.connected":
    case "server.heartbeat":
      return { handled: true, effects }

    case "server.instance.disposed":
      effects.push({ type: "bootstrap.reload" })
      return { handled: true, effects }

    case "permission.asked":
      if (options.autonomous) {
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
      upsertPart(state.part, event.properties.part)
      return { handled: true, effects }

    case "message.part.delta":
      if (event.properties.field === "text") {
        appendPartTextDelta(state.part, event.properties.messageID, event.properties.partID, event.properties.delta)
      }
      return { handled: true, effects }

    case "message.part.removed":
      removePart(state.part, event.properties.messageID, event.properties.partID)
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

    case "code.index.progress":
    case "code.index.state":
      effects.push({ type: "runtime.probe", key: "debug-engine" })
      return { handled: true, effects }
  }

  const _exhaustive: never = event
  return { handled: false, effects: _exhaustive }
}

export function runtimeProbeKeysForEvent(event: HeadlessRuntimeStatusEvent): Array<"mcp" | "lsp" | "debug-engine"> {
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
  const result = binarySearch(list, item.id, (entry) => entry.id)
  if (result.found) {
    list[result.index] = item
    return
  }
  list.splice(result.index, 0, item)
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
>(state: HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk, TGoal>, sessionID: string) {
  state.session = state.session.filter((session) => session.id !== sessionID)
  for (const message of state.message[sessionID] ?? []) {
    delete state.part[message.id]
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
  maxSessionMessages = 100,
) {
  const list = state.message[message.sessionID] ?? []
  upsertByID(list, message)
  for (const removed of shiftOverflow(list, maxSessionMessages)) {
    delete state.part[removed.id]
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
}

function upsertPart<TPart extends { id: string; messageID: string }>(parts: Record<string, TPart[]>, part: TPart) {
  const list = parts[part.messageID] ?? []
  upsertByID(list, part)
  parts[part.messageID] = list
}

function appendPartTextDelta<TPart extends { id: string; messageID: string }>(
  parts: Record<string, TPart[]>,
  messageID: string,
  partID: string,
  delta: string,
) {
  const list = parts[messageID] ?? []
  const result = binarySearch(list, partID, (entry) => entry.id)
  if (!result.found) return
  const part = list[result.index] as TPart & { type?: string; text?: string }
  if (part.type !== "text" && part.type !== "reasoning") return
  part.text = (part.text ?? "") + delta
}

function removePart<TPart extends { id: string; messageID: string }>(
  parts: Record<string, TPart[]>,
  messageID: string,
  partID: string,
) {
  removeByID(parts[messageID] ?? [], partID)
}

function removeByID<T extends { id: string }>(list: T[], id: string) {
  const result = binarySearch(list, id, (entry) => entry.id)
  if (!result.found) return undefined
  const [removed] = list.splice(result.index, 1)
  return removed
}

function shiftOverflow<T>(list: T[], maxSize: number) {
  const limit = Math.max(0, Math.floor(maxSize))
  if (list.length <= limit) return []
  return list.splice(0, list.length - limit)
}

function binarySearch<T>(array: T[], id: string, compare: (item: T) => string): { found: boolean; index: number } {
  let left = 0
  let right = array.length - 1
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const midId = compare(array[mid])
    if (midId === id) return { found: true, index: mid }
    if (midId < id) left = mid + 1
    else right = mid - 1
  }
  return { found: false, index: left }
}
