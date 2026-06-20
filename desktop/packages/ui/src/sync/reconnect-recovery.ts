import type { SessionStatus, Message, Part } from "@ax-code/sdk/v2/client"
import type { Session } from "@ax-code/sdk/v2"
import { getSessionMaterializationStatus } from "./materialization"

type ReconnectMaterializationState = {
  session: Session[]
  session_status?: Record<string, SessionStatus>
  message?: Record<string, Message[]>
  part?: Record<string, Part[]>
}

export type ViewedSessionMaterializationTarget = {
  directory: string
  sessionId: string
}

type ReconnectCandidateOptions = {
  directory?: string
  viewedSession?: ViewedSessionMaterializationTarget | null
}

/**
 * Decide a candidate session's status when reconciling against an authoritative
 * status snapshot (reconnect resync / periodic status poll).
 *
 * The snapshot lists only sessions the server currently considers active, so an
 * absent session normally means "idle". But the async prompt_async endpoint
 * returns before the turn registers as busy: a snapshot taken in that gap would
 * report the just-sent session as absent and flip the optimistic busy back to
 * idle, leaving the turn looking dead (and tripping the no-output watchdog).
 *
 * When the server reports an explicit status, trust it. Otherwise default to
 * idle — except for a freshly accepted prompt with no completed assistant reply
 * yet, where we preserve the existing non-idle status until a real
 * session.idle/error event (or the next snapshot past the grace window) arrives.
 */
export function resolveResyncedSessionStatus(input: {
  serverStatus: SessionStatus | undefined
  existingStatus: SessionStatus | undefined
  promptRecentlyAccepted: boolean
  hasCompletedAssistantReply: boolean
}): SessionStatus {
  const { serverStatus, existingStatus, promptRecentlyAccepted, hasCompletedAssistantReply } = input
  if (serverStatus) return serverStatus
  if (
    promptRecentlyAccepted
    && !hasCompletedAssistantReply
    && existingStatus
    && existingStatus.type !== "idle"
  ) {
    return existingStatus
  }
  return { type: "idle" }
}

/** Whether a session's latest message is a fully-completed assistant reply. */
export function hasCompletedAssistantReply(messages: Message[] | undefined): boolean {
  const lastMessage = messages?.[messages.length - 1]
  return !!lastMessage
    && lastMessage.role === "assistant"
    && typeof (lastMessage as { time?: { completed?: number } }).time?.completed === "number"
}

export function getReconnectCandidateSessionIds(state: ReconnectMaterializationState, options?: ReconnectCandidateOptions) {
  const ids = new Set<string>()

  for (const [sessionId, status] of Object.entries(state.session_status ?? {})) {
    if (status && status.type !== "idle") ids.add(sessionId)
  }

  for (const [sessionId, messages] of Object.entries(state.message ?? {})) {
    const lastMessage = messages[messages.length - 1]
    if (
      lastMessage
      && lastMessage.role === "assistant"
      && typeof (lastMessage as { time?: { completed?: number } }).time?.completed !== "number"
    ) {
      ids.add(sessionId)
    } else if (!getSessionMaterializationStatus({ message: state.message ?? {}, part: state.part ?? {} }, sessionId).renderable) {
      ids.add(sessionId)
    }
  }

  const parentIds = new Set<string>()
  for (const session of state.session) {
    const parentId = (session as Session & { parentID?: string | null }).parentID
    if (parentId) {
      parentIds.add(parentId)
    }
  }
  for (const pid of parentIds) {
    ids.add(pid)
  }

  const viewedSession = options?.viewedSession
  if (viewedSession?.sessionId && viewedSession.directory === options?.directory) {
    const sessionId = viewedSession.sessionId
    const sessionExists = state.session.some((session) => session.id === sessionId)
      || Object.hasOwn(state.session_status ?? {}, sessionId)
      || Object.hasOwn(state.message ?? {}, sessionId)

    if (sessionExists) {
      ids.add(sessionId)
    }
  }

  return Array.from(ids)
}
