import type { HeadlessRuntimeEvent } from "@ax-code/sdk/headless/event"
import type { HeadlessProjectionState } from "@ax-code/sdk/headless/projection"

export type AppSession = {
  id: string
  title: string
  project: string
  worktree?: string
  updatedAt: number
}

export type AppTodo = {
  id: string
  text: string
  status: "pending" | "in_progress" | "completed"
}

export type AppDiff = {
  path: string
  added: number
  removed: number
}

export type AppStatus =
  | { type: "idle" }
  | { type: "busy"; activeTool?: string; waitState?: "llm" | "tool"; step?: number; maxSteps?: number }
  | { type: "blocked"; reason: "permission" | "question" }
  | { type: "failed"; message: string }

export type AppMessage = {
  id: string
  sessionID: string
  role: "user" | "assistant"
  createdAt: number
}

export type AppPart = {
  id: string
  messageID: string
  type: "text" | "reasoning" | "tool"
  text?: string
  toolName?: string
}

export type AppGoal = {
  objective: string
  status: "active" | "complete" | "blocked"
  remainingTokens?: number
}

export type AppQueueItem = {
  id: string
  project: string
  directory?: string
  sessionID?: string
  title: string
  kind: "prompt" | "command" | "shell" | "followup" | "subagent" | "review" | "automation"
  status:
    | "queued"
    | "waiting_for_idle"
    | "running"
    | "blocked_permission"
    | "blocked_question"
    | "paused"
    | "failed"
    | "completed"
    | "cancelled"
  priority: number
  position?: number
  createdAt: number
  agent?: string
  model?: unknown
  payload?: Record<string, unknown>
  sourceMessageID?: string
  sourceTaskID?: string
}

export type AppMultiRunGroup = {
  id: string
  title: string
  attention: "ready" | "queued" | "running" | "blocked" | "failed" | "conflict"
  total: number
  running: number
  blocked: number
  queued: number
  completed: number
  failed: number
  sessions: string[]
  worktrees: string[]
  conflictPaths: string[]
  changedFiles: string[]
  sessionDiffs: Array<{
    sessionID: string
    files: string[]
    additions: number
    removals: number
  }>
  items: AppQueueItem[]
}

export type AppRiskEvidence = {
  level: string
  score?: number
  confidence?: number
  readiness?: string
  summary?: string
  drivers: string[]
}

export type AppSemanticEvidence = {
  headline: string
  risk: string
  primary?: string
  files?: number
  additions?: number
  deletions?: number
  changes: Array<{
    file: string
    summary: string
    risk?: string
  }>
}

export type AppDreEvidence = {
  decision?: string
  summary?: string
  readiness?: string
  timeline: string[]
}

export type AppRollbackPoint = {
  step: number
  messageID?: string
  partID?: string
  durationMs?: number
  tokens?: {
    input: number
    output: number
  }
  tools: string[]
  kinds: string[]
}

export type AppSessionEvidence = {
  sessionID: string
  status: "ready" | "loading" | "error"
  risk?: AppRiskEvidence
  semantic?: AppSemanticEvidence
  dre?: AppDreEvidence
  rollbackPoints: AppRollbackPoint[]
  artifactCounts: {
    findings: number
    verificationEnvelopes: number
    reviewResults: number
    debugCases: number
    decisionHints: number
  }
  errors: string[]
}

export type AppAgentOption = {
  id: string
  label: string
  mode?: string
}

export type AppModelOption = {
  providerID: string
  modelID: string
  label: string
}

export type AppProviderStatus = {
  id: string
  label: string
  source?: string
  modelCount: number
  defaultModelID?: string
  status: "available" | "no_models"
}

export type AppRuntimeCatalog = {
  providers: AppProviderStatus[]
  agents: AppAgentOption[]
  models: AppModelOption[]
}

export type AppWorktree = {
  directory: string
  name: string
}

export type AppTerminal = {
  id: string
  title: string
  command: string
  cwd: string
  status: "running" | "exited" | "unknown"
}

export type AppScheduledTask = {
  id: string
  project: string
  title: string
  prompt: string
  schedule: unknown
  status: "active" | "paused" | "disabled"
  agent?: string
  model?: unknown
  lastQueueID?: string
  error?: string
  nextRunAt?: number
  lastRunAt?: number
}

export type AppHeadlessEvent = HeadlessRuntimeEvent<
  AppSession,
  AppTodo,
  AppDiff,
  AppStatus,
  AppMessage,
  AppPart,
  AppGoal,
  AppQueueItem,
  AppScheduledTask
>

export type AppProjectionState = HeadlessProjectionState<
  AppSession,
  AppTodo,
  AppDiff,
  AppStatus,
  AppMessage,
  AppPart,
  unknown,
  AppGoal
>

export type AppCommandCenterState = {
  projection: AppProjectionState
  queue: AppQueueItem[]
  evidence: Record<string, AppSessionEvidence>
  catalog: AppRuntimeCatalog
  worktrees: AppWorktree[]
  terminals: AppTerminal[]
  scheduledTasks: AppScheduledTask[]
  selectedSessionID: string
}
