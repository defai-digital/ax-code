import type { PermissionRequest, QuestionRequest } from "../v2/index.js"

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

export type HeadlessRuntimeStatusEvent =
  | { type: "mcp.tools.changed" }
  | { type: "lsp.updated" }
  | { type: "code.index.progress" }
  | { type: "code.index.state" }
  | { type: "vcs.branch.updated"; properties: { branch: string } }

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
  "server.connected",
  "server.heartbeat",
  "server.instance.disposed",
])

export function isHeadlessRuntimeEvent(event: unknown): boolean {
  if (!event || typeof event !== "object") return false
  if (!("type" in event)) return false
  const value = (event as { type?: unknown }).type
  return typeof value === "string" && HEADLESS_RUNTIME_EVENT_TYPES.has(value)
}
