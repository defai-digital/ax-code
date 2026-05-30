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
  | { type: "workflow.run.created"; properties: Record<string, unknown> }
  | { type: "workflow.run.updated"; properties: Record<string, unknown> }
  | { type: "workflow.run.started"; properties: Record<string, unknown> }
  | { type: "workflow.run.blocked"; properties: Record<string, unknown> }
  | { type: "workflow.run.paused"; properties: Record<string, unknown> }
  | { type: "workflow.run.resumed"; properties: Record<string, unknown> }
  | { type: "workflow.run.completed"; properties: Record<string, unknown> }
  | { type: "workflow.run.failed"; properties: Record<string, unknown> }
  | { type: "workflow.run.cancelled"; properties: Record<string, unknown> }
  | { type: "workflow.phase.updated"; properties: Record<string, unknown> }
  | { type: "workflow.phase.started"; properties: Record<string, unknown> }
  | { type: "workflow.phase.completed"; properties: Record<string, unknown> }
  | { type: "workflow.phase.failed"; properties: Record<string, unknown> }
  | { type: "workflow.child.created"; properties: Record<string, unknown> }
  | { type: "workflow.child.updated"; properties: Record<string, unknown> }
  | { type: "workflow.child.started"; properties: Record<string, unknown> }
  | { type: "workflow.child.completed"; properties: Record<string, unknown> }
  | { type: "workflow.child.failed"; properties: Record<string, unknown> }
  | { type: "workflow.child.cancelled"; properties: Record<string, unknown> }
  | { type: "workflow.artifact.written"; properties: Record<string, unknown> }
  | { type: "workflow.budget.appended"; properties: Record<string, unknown> }
  | { type: "workflow.budget.warning"; properties: Record<string, unknown> }
  | { type: "workflow.budget.exceeded"; properties: Record<string, unknown> }
  | { type: "workflow.verification.attached"; properties: Record<string, unknown> }

export type HeadlessRuntimeProbeKey = "mcp" | "lsp" | "debug-engine" | "workflow"

export type HeadlessSessionEvent<TSession extends { id: string }, TTodo, TDiff, TStatus, TGoal = unknown> =
  | { type: "todo.updated"; properties: { sessionID: string; todos: TTodo[] } }
  | { type: "session.diff"; properties: { sessionID: string; diff: TDiff[] } }
  | { type: "session.goal"; properties: { sessionID: string; goal: TGoal | null } }
  | { type: "session.deleted"; properties: { info: { id: string } } }
  | { type: "session.created"; properties: { info: TSession } }
  | { type: "session.updated"; properties: { info: TSession } }
  | { type: "session.status"; properties: { sessionID: string; status: TStatus } }
  | { type: "session.error"; properties: { sessionID?: string; error: unknown } }

export type HeadlessTaskQueueEvent<TTaskQueueItem> =
  | { type: "task.queue.created"; properties: { item: TTaskQueueItem } }
  | { type: "task.queue.updated"; properties: { item: TTaskQueueItem } }
  | { type: "task.queue.deleted"; properties: { id: string; projectID: string; sessionID?: string } }

export type HeadlessScheduledTaskEvent<TScheduledTask> =
  | { type: "scheduled.task.created"; properties: { task: TScheduledTask } }
  | { type: "scheduled.task.updated"; properties: { task: TScheduledTask } }
  | { type: "scheduled.task.deleted"; properties: { id: string; projectID: string } }

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
  TTaskQueueItem = unknown,
  TScheduledTask = unknown,
> =
  | HeadlessRequestEvent
  | HeadlessSessionEvent<TSession, TTodo, TDiff, TStatus, TGoal>
  | HeadlessTaskQueueEvent<TTaskQueueItem>
  | HeadlessScheduledTaskEvent<TScheduledTask>
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
  "task.queue.created",
  "task.queue.updated",
  "task.queue.deleted",
  "scheduled.task.created",
  "scheduled.task.updated",
  "scheduled.task.deleted",
  "mcp.tools.changed",
  "lsp.updated",
  "code.index.progress",
  "code.index.state",
  "vcs.branch.updated",
  "workflow.run.created",
  "workflow.run.updated",
  "workflow.run.started",
  "workflow.run.blocked",
  "workflow.run.paused",
  "workflow.run.resumed",
  "workflow.run.completed",
  "workflow.run.failed",
  "workflow.run.cancelled",
  "workflow.phase.updated",
  "workflow.phase.started",
  "workflow.phase.completed",
  "workflow.phase.failed",
  "workflow.child.created",
  "workflow.child.updated",
  "workflow.child.started",
  "workflow.child.completed",
  "workflow.child.failed",
  "workflow.child.cancelled",
  "workflow.artifact.written",
  "workflow.budget.appended",
  "workflow.budget.warning",
  "workflow.budget.exceeded",
  "workflow.verification.attached",
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
