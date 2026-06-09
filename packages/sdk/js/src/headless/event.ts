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

export type WorkflowRunStatus = "queued" | "running" | "blocked" | "paused" | "completed" | "failed" | "cancelled"

export type WorkflowPhaseStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export type WorkflowChildStatus =
  | "queued"
  | "running"
  | "blocked_permission"
  | "blocked_question"
  | "completed"
  | "failed"
  | "cancelled"

export interface WorkflowRunProperties {
  id: string
  status: WorkflowRunStatus
  error?: string
  sourceTemplateID?: string
}

export interface WorkflowPhaseProperties {
  id: string
  runID: string
  name: string
  status: WorkflowPhaseStatus
  error?: string
}

export interface WorkflowChildProperties {
  id: string
  runID: string
  phaseID: string
  status: WorkflowChildStatus
  outputSummary?: string
  error?: string
}

export interface WorkflowArtifactProperties {
  id: string
  runID: string
  phaseID?: string
  childID?: string
  kind: string
  summary?: string
  specArtifactID?: string
}

export interface WorkflowBudgetProperties {
  id: string
  runID: string
  kind: string
  message?: string
}

export interface WorkflowVerificationProperties {
  id: string
  envelopeIDs: string[]
}

export type HeadlessRuntimeStatusEvent =
  | { type: "mcp.tools.changed" }
  | { type: "lsp.updated" }
  | { type: "code.index.progress" }
  | { type: "code.index.state" }
  | { type: "vcs.branch.updated"; properties: { branch: string } }
  | { type: "workflow.run.created"; properties: WorkflowRunProperties }
  | { type: "workflow.run.updated"; properties: WorkflowRunProperties }
  | { type: "workflow.run.started"; properties: WorkflowRunProperties }
  | { type: "workflow.run.blocked"; properties: WorkflowRunProperties }
  | { type: "workflow.run.paused"; properties: WorkflowRunProperties }
  | { type: "workflow.run.resumed"; properties: WorkflowRunProperties }
  | { type: "workflow.run.completed"; properties: WorkflowRunProperties }
  | { type: "workflow.run.failed"; properties: WorkflowRunProperties }
  | { type: "workflow.run.cancelled"; properties: WorkflowRunProperties }
  | { type: "workflow.phase.updated"; properties: WorkflowPhaseProperties }
  | { type: "workflow.phase.started"; properties: WorkflowPhaseProperties }
  | { type: "workflow.phase.completed"; properties: WorkflowPhaseProperties }
  | { type: "workflow.phase.failed"; properties: WorkflowPhaseProperties }
  | { type: "workflow.child.created"; properties: WorkflowChildProperties }
  | { type: "workflow.child.updated"; properties: WorkflowChildProperties }
  | { type: "workflow.child.started"; properties: WorkflowChildProperties }
  | { type: "workflow.child.completed"; properties: WorkflowChildProperties }
  | { type: "workflow.child.failed"; properties: WorkflowChildProperties }
  | { type: "workflow.child.cancelled"; properties: WorkflowChildProperties }
  | { type: "workflow.artifact.written"; properties: WorkflowArtifactProperties }
  | { type: "workflow.budget.appended"; properties: WorkflowBudgetProperties }
  | { type: "workflow.budget.warning"; properties: WorkflowBudgetProperties }
  | { type: "workflow.budget.exceeded"; properties: WorkflowBudgetProperties }
  | { type: "workflow.verification.attached"; properties: WorkflowVerificationProperties }

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
