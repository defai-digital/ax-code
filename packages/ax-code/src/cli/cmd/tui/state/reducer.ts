import { Binary } from "@ax-code/util/binary"
import type { Message, Part, PermissionRequest, QuestionRequest, Session, SessionStatus } from "@ax-code/sdk/v2"
import { createAppState, type AppState } from "./app-state"
import type { Action, AppStateBootstrap } from "./actions"

const SESSION_MESSAGE_LIMIT = 100

function upsertById<T extends { id: string }>(list: T[], item: T) {
  const next = list.slice()
  const result = Binary.search(next, item.id, (entry) => entry.id)
  if (result.found) {
    next[result.index] = item
    return next
  }
  next.splice(result.index, 0, item)
  return next
}

function removeById<T extends { id: string }>(list: T[], id: string) {
  const result = Binary.search(list, id, (entry) => entry.id)
  if (!result.found) return list
  const next = list.slice()
  next.splice(result.index, 1)
  return next
}

function mergeBootstrap(state: AppState, data: AppStateBootstrap): AppState {
  return createAppState({
    ...state,
    ...data,
    route: {
      ...state.route,
      ...data.route,
    },
    path: {
      ...state.path,
      ...data.path,
    },
    prompt: {
      ...state.prompt,
      ...data.prompt,
    },
    eventQueue: state.eventQueue,
  })
}

function nextSessionRequests<T extends PermissionRequest | QuestionRequest>(
  records: Record<string, T[]>,
  sessionID: string,
  request: T,
) {
  const current = records[sessionID] ?? []
  return {
    ...records,
    [sessionID]: upsertById(current, request),
  }
}

function nextResolvedRequests<T extends { id: string }>(
  records: Record<string, T[]>,
  sessionID: string,
  requestID: string,
) {
  const current = records[sessionID]
  if (!current) return records
  const next = removeById(current, requestID)
  if (next === current) return records
  if (next.length > 0) {
    return {
      ...records,
      [sessionID]: next,
    }
  }
  const clone = {
    ...records,
  }
  delete clone[sessionID]
  return clone
}

function nextSessionStatus(records: Record<string, SessionStatus>, sessionID: string, status: SessionStatus) {
  if (status.type !== "idle") {
    return {
      ...records,
      [sessionID]: status,
    }
  }
  if (!(sessionID in records)) return records
  const next = {
    ...records,
  }
  delete next[sessionID]
  return next
}

function nextSessionMessages(records: Record<string, Message[]>, message: Message) {
  const current = records[message.sessionID] ?? []
  const next = upsertById(current, message)
  return {
    records: {
      ...records,
      [message.sessionID]: next,
    },
    trimmedMessageID: next.length > SESSION_MESSAGE_LIMIT && current !== next ? next[0]?.id : undefined,
  }
}

function applyMessageLimit(records: Record<string, Message[]>, sessionID: string) {
  const current = records[sessionID]
  if (!current || current.length <= SESSION_MESSAGE_LIMIT) {
    return { records, trimmedMessageID: undefined as string | undefined }
  }
  const trimmedMessageID = current[0]?.id
  return {
    records: {
      ...records,
      [sessionID]: current.slice(1),
    },
    trimmedMessageID,
  }
}

function nextPartRecords(records: Record<string, Part[]>, part: Part) {
  const current = records[part.messageID] ?? []
  return {
    ...records,
    [part.messageID]: upsertById(current, part),
  }
}

export function reduceAppState(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "bootstrap.hydrated":
      return mergeBootstrap(state, action.data)
    case "workspace.list.synced":
      return {
        ...state,
        workspaceList: [...action.workspaceList],
      }
    case "workspace.selected":
      return {
        ...state,
        route: {
          ...state.route,
          workspaceID: action.workspaceID,
        },
      }
    case "route.session.selected":
      return {
        ...state,
        route: {
          ...state.route,
          sessionID: action.sessionID,
        },
      }
    case "path.synced":
      return {
        ...state,
        path: {
          ...action.path,
        },
      }
    case "session.upserted":
      return {
        ...state,
        session: upsertById(state.session, action.session),
      }
    case "session.deleted": {
      const deletedMessageIDs = (state.message[action.sessionID] ?? []).map((message) => message.id)
      const next = {
        ...state,
        session: removeById(state.session, action.sessionID),
        sessionStatus: { ...state.sessionStatus },
        message: { ...state.message },
        permission: { ...state.permission },
        question: { ...state.question },
        part: { ...state.part },
      }
      delete next.sessionStatus[action.sessionID]
      delete next.message[action.sessionID]
      delete next.permission[action.sessionID]
      delete next.question[action.sessionID]
      for (const messageID of deletedMessageIDs) {
        delete next.part[messageID]
      }
      if (state.route.sessionID === action.sessionID) {
        next.route = {
          ...state.route,
          sessionID: undefined,
        }
      }
      return next
    }
    case "session.status.synced":
      return {
        ...state,
        sessionStatus: nextSessionStatus(state.sessionStatus, action.sessionID, action.status),
      }
    case "message.upserted": {
      const sessionMessages = nextSessionMessages(state.message, action.message)
      const limited = applyMessageLimit(sessionMessages.records, action.message.sessionID)
      if (!limited.trimmedMessageID) {
        return {
          ...state,
          message: sessionMessages.records,
        }
      }
      const nextParts = {
        ...state.part,
      }
      delete nextParts[limited.trimmedMessageID]
      return {
        ...state,
        message: limited.records,
        part: nextParts,
      }
    }
    case "message.deleted": {
      const current = state.message[action.sessionID]
      if (!current) return state
      const nextMessages = removeById(current, action.messageID)
      const nextParts = {
        ...state.part,
      }
      delete nextParts[action.messageID]
      return {
        ...state,
        message: {
          ...state.message,
          [action.sessionID]: nextMessages,
        },
        part: nextParts,
      }
    }
    case "part.upserted":
      return {
        ...state,
        part: nextPartRecords(state.part, action.part),
      }
    case "part.delta.received": {
      const current = state.part[action.messageID]
      if (!current) return state
      const result = Binary.search(current, action.partID, (entry) => entry.id)
      if (!result.found) return state
      const nextParts = current.slice()
      const previous = current[result.index] as Part & Record<string, unknown>
      const existing = previous[action.field]
      if (existing !== undefined && typeof existing !== "string") return state
      nextParts[result.index] = {
        ...previous,
        [action.field]: String(existing ?? "") + action.delta,
      } as Part
      return {
        ...state,
        part: {
          ...state.part,
          [action.messageID]: nextParts,
        },
      }
    }
    case "part.deleted": {
      const current = state.part[action.messageID]
      if (!current) return state
      const next = removeById(current, action.partID)
      return {
        ...state,
        part: {
          ...state.part,
          [action.messageID]: next,
        },
      }
    }
    case "permission.asked":
      return {
        ...state,
        permission: nextSessionRequests(state.permission, action.request.sessionID, action.request),
      }
    case "permission.resolved":
      return {
        ...state,
        permission: nextResolvedRequests(state.permission, action.sessionID, action.requestID),
      }
    case "question.asked":
      return {
        ...state,
        question: nextSessionRequests(state.question, action.request.sessionID, action.request),
      }
    case "question.resolved":
      return {
        ...state,
        question: nextResolvedRequests(state.question, action.sessionID, action.requestID),
      }
    case "prompt.appended":
      return {
        ...state,
        prompt: {
          value: state.prompt.value + action.text,
        },
      }
    case "prompt.changed":
      return {
        ...state,
        prompt: {
          value: action.value,
        },
      }
    case "vcs.synced":
      return {
        ...state,
        vcs: action.vcs,
      }
    case "queue.measured":
      return {
        ...state,
        eventQueue: action.metrics,
      }
  }
}
