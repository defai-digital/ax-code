import type { PermissionRequest, QuestionRequest } from "@ax-code/sdk/v2"

export const HEADLESS_RUNTIME_SCHEMA_VERSION = 1

export type HeadlessMessageEvent<
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
> =
  | { type: "message.updated"; properties: { info: TMessage } }
  | { type: "message.removed"; properties: { sessionID: string; messageID: string } }
  | { type: "message.part.updated"; properties: { part: TPart } }
  | { type: "message.part.delta"; properties: { messageID: string; partID: string; field: string; delta: string } }
  | { type: "message.part.removed"; properties: { messageID: string; partID: string } }

export type HeadlessRequestEvent =
  | { type: "permission.asked"; properties: PermissionRequest }
  | { type: "permission.replied"; properties: { sessionID: string; requestID: string } }
  | { type: "question.asked"; properties: QuestionRequest }
  | { type: "question.replied"; properties: { sessionID: string; requestID: string } }
  | { type: "question.rejected"; properties: { sessionID: string; requestID: string } }

export type HeadlessRuntimeProbeKey = "mcp" | "lsp" | "debug-engine" | "workflow"

export type HeadlessRuntimeStatusEvent =
  | { type: "mcp.tools.changed" }
  | { type: "lsp.updated" }
  | { type: "code.index.progress" }
  | { type: "code.index.state" }
  | { type: "vcs.branch.updated"; properties: { branch: string } }
  | { type: "workflow.run.created"; properties: Record<string, unknown> }
  | { type: "workflow.run.updated"; properties: Record<string, unknown> }
  | { type: "workflow.phase.updated"; properties: Record<string, unknown> }
  | { type: "workflow.child.created"; properties: Record<string, unknown> }
  | { type: "workflow.child.updated"; properties: Record<string, unknown> }
  | { type: "workflow.artifact.written"; properties: Record<string, unknown> }
  | { type: "workflow.budget.appended"; properties: Record<string, unknown> }
  | { type: "workflow.verification.attached"; properties: Record<string, unknown> }

export type HeadlessSessionEvent<TSession extends { id: string }, TTodo, TDiff, TStatus, TGoal = unknown> =
  | { type: "todo.updated"; properties: { sessionID: string; todos: TTodo[] } }
  | { type: "session.diff"; properties: { sessionID: string; diff: TDiff[] } }
  | { type: "session.goal"; properties: { sessionID: string; goal: TGoal | null } }
  | { type: "session.deleted"; properties: { info: { id: string } } }
  | { type: "session.created"; properties: { info: TSession } }
  | { type: "session.updated"; properties: { info: TSession } }
  | { type: "session.status"; properties: { sessionID: string; status: TStatus } }
  | { type: "session.error"; properties: { sessionID?: string; error: unknown } }

export type HeadlessControlEvent =
  | { type: "server.connected"; properties: Record<string, never> }
  | { type: "server.heartbeat"; properties: Record<string, never> }
  | { type: "server.instance.disposed" }

export type HeadlessRuntimeEvent<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TGoal = unknown,
> =
  | HeadlessRequestEvent
  | HeadlessSessionEvent<TSession, TTodo, TDiff, TStatus, TGoal>
  | HeadlessMessageEvent<TMessage, TPart>
  | HeadlessRuntimeStatusEvent
  | HeadlessControlEvent

export type HeadlessRuntimeEventEnvelope<TEvent = unknown> = {
  details: TEvent
}

export const HEADLESS_RUNTIME_EVENT_TYPES = new Set<string>([
  "message.updated",
  "message.removed",
  "message.part.updated",
  "message.part.delta",
  "message.part.removed",
  "permission.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
  "question.rejected",
  "todo.updated",
  "session.diff",
  "session.goal",
  "session.deleted",
  "session.created",
  "session.updated",
  "session.status",
  "session.error",
  "mcp.tools.changed",
  "lsp.updated",
  "code.index.progress",
  "code.index.state",
  "vcs.branch.updated",
  "workflow.run.created",
  "workflow.run.updated",
  "workflow.phase.updated",
  "workflow.child.created",
  "workflow.child.updated",
  "workflow.artifact.written",
  "workflow.budget.appended",
  "workflow.verification.attached",
  "server.connected",
  "server.heartbeat",
  "server.instance.disposed",
])

export function headlessRuntimeEventType(event: unknown) {
  if (!event || typeof event !== "object") return undefined
  if (!("type" in event)) return undefined
  const value = (event as { type?: unknown }).type
  return typeof value === "string" ? value : undefined
}

export function isHeadlessRuntimeEvent(event: unknown) {
  const type = headlessRuntimeEventType(event)
  return !!type && HEADLESS_RUNTIME_EVENT_TYPES.has(type)
}

export function headlessSessionStatusType(event: unknown, sessionID?: string) {
  const candidate = eventProperties(event)
  if (!candidate || headlessRuntimeEventType(event) !== "session.status") return undefined
  if (sessionID && candidate.sessionID !== sessionID) return undefined
  const status = candidate.status
  if (!status || typeof status !== "object") return undefined
  if (!("type" in status)) return undefined
  return typeof status.type === "string" ? status.type : undefined
}

export function isHeadlessSessionIdleEvent(event: unknown, sessionID?: string) {
  return headlessSessionStatusType(event, sessionID) === "idle"
}

export function headlessSessionErrorMessage(event: unknown, sessionID?: string) {
  const candidate = eventProperties(event)
  if (!candidate || headlessRuntimeEventType(event) !== "session.error") return undefined
  if (sessionID && candidate.sessionID !== sessionID) return undefined
  const error = candidate.error
  if (!error || typeof error !== "object") return "Session error"
  const data = (error as { data?: unknown }).data
  if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
    return data.message
  }
  if ("message" in error && typeof error.message === "string") return error.message
  if ("name" in error && typeof error.name === "string") return error.name
  return "Session error"
}

function eventProperties(event: unknown) {
  if (!event || typeof event !== "object") return undefined
  if (!("properties" in event)) return undefined
  const properties = event.properties
  return properties && typeof properties === "object" ? (properties as Record<string, unknown>) : undefined
}
