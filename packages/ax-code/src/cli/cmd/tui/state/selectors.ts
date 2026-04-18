import type { Message, Part, Session } from "@ax-code/sdk/v2"
import type { AppState } from "./app-state"

export type TranscriptEntry = {
  message: Message
  parts: Part[]
}

export function currentWorkspaceID(state: AppState) {
  return state.route.workspaceID ?? (state.path.directory || undefined)
}

export function currentWorkspaceView(state: AppState) {
  const workspaceID = currentWorkspaceID(state)
  return {
    workspaceID,
    directory: state.path.directory,
    worktree: state.path.worktree,
    config: state.path.config,
    state: state.path.state,
  }
}

export function sessionsForWorkspace(state: AppState, workspaceID = currentWorkspaceID(state)): Session[] {
  if (!workspaceID) return state.session
  return state.session.filter((session) => session.directory === workspaceID)
}

export function activeSessionID(state: AppState) {
  if (state.route.sessionID && state.session.some((session) => session.id === state.route.sessionID)) {
    return state.route.sessionID
  }
  return sessionsForWorkspace(state).at(-1)?.id
}

export function transcriptForSession(state: AppState, sessionID = activeSessionID(state)): TranscriptEntry[] {
  if (!sessionID) return []
  const messages = state.message[sessionID] ?? []
  return messages.map((message) => ({
    message,
    parts: state.part[message.id] ?? [],
  }))
}

export function pendingPermission(state: AppState, sessionID = activeSessionID(state)) {
  if (!sessionID) return undefined
  return state.permission[sessionID]?.[0]
}

export function pendingQuestion(state: AppState, sessionID = activeSessionID(state)) {
  if (!sessionID) return undefined
  return state.question[sessionID]?.[0]
}

export function promptValue(state: AppState) {
  return state.prompt.value
}

export function hasBlockingRequest(state: AppState, sessionID = activeSessionID(state)) {
  return Boolean(pendingPermission(state, sessionID) || pendingQuestion(state, sessionID))
}

export function sessionStatusFor(state: AppState, sessionID = activeSessionID(state)) {
  if (!sessionID) return { type: "idle" as const }
  return state.sessionStatus[sessionID] ?? { type: "idle" as const }
}
