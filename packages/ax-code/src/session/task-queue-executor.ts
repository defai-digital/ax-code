import { Bus } from "@/bus"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { Permission } from "@/permission"
import { Instance } from "@/project/instance"
import { Question } from "@/question"
import { Log } from "@/util/log"
import { NamedError } from "@ax-code/util/error"
import { lazy } from "../util/lazy"
import { SessionPrompt } from "./prompt"
import { PromptIsolationPolicy, type PromptIsolationPolicy as PromptIsolationPolicyType } from "./prompt-runtime-policy"
import { TaskQueue } from "./task-queue"
import type { SessionID, TaskQueueID } from "./schema"
import type { WorkflowChildID, WorkflowPhaseID, WorkflowRunID } from "../workflow/state"

const log = Log.create({ service: "session.task-queue-executor" })

// Lazy: session/prompt has a circular dep with session/index. Evaluating these
// schemas at module load can race the circular load cycle in the full test suite.
const QueuePromptBody = lazy(() => SessionPrompt.PromptInput.omit({ sessionID: true }))
const QueueCommandBody = lazy(() => SessionPrompt.CommandInput.omit({ sessionID: true }))
const QueueShellBody = lazy(() => SessionPrompt.ShellInput.omit({ sessionID: true }))

type QueueExecution = {
  sessionID: SessionID
  run: () => Promise<unknown>
}

const activeStatuses = ["running", "blocked_permission", "blocked_question"] as const

const blockObserverState = Instance.state(
  () => ({
    initialized: false,
    unsubscribe: [] as Array<() => void>,
  }),
  async (state) => {
    for (const unsubscribe of state.unsubscribe) unsubscribe()
    state.unsubscribe = []
    state.initialized = false
  },
)

export namespace TaskQueueExecutor {
  export function initSessionBlockObservers() {
    ensureSessionBlockObservers()
  }

  export async function sendNow(id: TaskQueueID): Promise<TaskQueue.Info> {
    const item = await TaskQueue.sendNow(id)
    return start(item)
  }

  export async function start(item: TaskQueue.Info): Promise<TaskQueue.Info> {
    ensureSessionBlockObservers()
    const execution = queueItemExecution(item)
    if (!execution) return item
    if (item.status !== "queued" && item.status !== "waiting_for_idle") return item

    if (await shouldWaitForIdle(execution.sessionID, item.id)) {
      return item.status === "waiting_for_idle"
        ? item
        : TaskQueue.setStatus({ id: item.id, status: "waiting_for_idle" })
    }
    if (await shouldWaitForWorkflowPhaseSlot(item)) return item

    const running = await TaskQueue.claimForExecution(item.id)
    if (!running) return TaskQueue.get(item.id)

    startDetachedQueueTask(async () => {
      await executeClaimedItem(running, execution)
    })
    return running
  }

  export async function drainNextForSession(sessionID: SessionID): Promise<TaskQueue.Info | undefined> {
    const pending = await pendingSessionItems(sessionID)
    for (const item of pending) {
      if (!queueItemExecution(item)) continue
      return start(item)
    }
    return undefined
  }
}

async function executeClaimedItem(item: TaskQueue.Info, execution: QueueExecution) {
  try {
    await execution.run()
    await finishIfRunning(item, { status: "completed" })
  } catch (error) {
    DiagnosticLog.recordProcess("server.taskQueueTaskFailed", {
      taskID: item.id,
      sessionID: item.sessionID,
      kind: item.kind,
      error,
    })
    await finishIfRunning(item, {
      status: "failed",
      error: NamedError.message(error),
    })
    log.error("task queue item execution failed", { taskID: item.id, sessionID: item.sessionID, error })
  } finally {
    if (item.sessionID) {
      await TaskQueueExecutor.drainNextForSession(item.sessionID).catch((error) => {
        DiagnosticLog.recordProcess("server.taskQueueDrainFailed", {
          taskID: item.id,
          sessionID: item.sessionID,
          error,
        })
        log.warn("failed to drain task queue after item settled", { taskID: item.id, sessionID: item.sessionID, error })
      })
    }
    await drainNextWorkflowPhaseItem(item).catch((error) => {
      DiagnosticLog.recordProcess("server.taskQueueWorkflowDrainFailed", {
        taskID: item.id,
        sessionID: item.sessionID,
        error,
      })
      log.warn("failed to drain workflow phase queue after item settled", {
        taskID: item.id,
        sessionID: item.sessionID,
        error,
      })
    })
  }
}

async function finishIfRunning(
  item: TaskQueue.Info,
  input: { status: Extract<TaskQueue.Status, "completed" | "failed">; error?: string },
) {
  const current = await TaskQueue.get(item.id)
  if (!isActiveQueueStatus(current.status)) return current
  return TaskQueue.setStatus({ id: item.id, status: input.status, error: input.error })
}

function startDetachedQueueTask(task: () => Promise<void>) {
  setTimeout(() => {
    void task().catch((error) => {
      DiagnosticLog.recordProcess("server.taskQueueTaskUnhandledFailure", { error })
      log.error("detached task queue execution failed", { error })
    })
  }, 0)
}

async function shouldWaitForIdle(sessionID: SessionID, currentTaskID: TaskQueueID) {
  if (sessionPromptBusy(sessionID)) return true
  const active = await activeSessionItems(sessionID)
  return active.some((item) => item.id !== currentTaskID)
}

async function shouldWaitForWorkflowPhaseSlot(item: TaskQueue.Info) {
  const workflow = workflowPayload(item)
  const maxParallel = workflowMaxParallel(item.payload)
  if (!workflow || maxParallel === undefined) return false
  const active = await activeWorkflowPhaseItems(workflow, item.id)
  return active.length >= maxParallel
}

async function drainNextWorkflowPhaseItem(item: TaskQueue.Info) {
  const workflow = workflowPayload(item)
  const maxParallel = workflowMaxParallel(item.payload)
  if (!workflow || maxParallel === undefined) return
  if ((await activeWorkflowPhaseItems(workflow, item.id)).length >= maxParallel) return

  const queued = await TaskQueue.list({ status: "queued", limit: 100 })
  const next = queued.filter((candidate) => sameWorkflowPhase(candidate, workflow)).sort(compareQueueItems)[0]
  if (!next) return
  await TaskQueueExecutor.start(next)
}

async function activeWorkflowPhaseItems(workflow: WorkflowQueuePayload, currentTaskID?: TaskQueueID) {
  const items = await Promise.all(activeStatuses.map((status) => TaskQueue.list({ status, limit: 100 })))
  return items
    .flat()
    .filter((candidate) => candidate.id !== currentTaskID && sameWorkflowPhase(candidate, workflow))
}

function sessionPromptBusy(sessionID: SessionID) {
  try {
    SessionPrompt.assertNotBusy(sessionID)
    return false
  } catch {
    return true
  }
}

async function pendingSessionItems(sessionID: SessionID) {
  const [queued, waiting] = await Promise.all([
    TaskQueue.list({ sessionID, status: "queued", limit: 100 }),
    TaskQueue.list({ sessionID, status: "waiting_for_idle", limit: 100 }),
  ])
  return [...queued, ...waiting].sort(compareQueueItems)
}

async function activeSessionItems(sessionID: SessionID) {
  const items = await Promise.all(activeStatuses.map((status) => TaskQueue.list({ sessionID, status, limit: 100 })))
  return items.flat()
}

function isActiveQueueStatus(status: TaskQueue.Status) {
  return activeStatuses.includes(status as (typeof activeStatuses)[number])
}

function ensureSessionBlockObservers() {
  const state = blockObserverState()
  if (state.initialized) return
  state.initialized = true
  state.unsubscribe.push(
    Bus.subscribe(Permission.Event.Asked, (event) => {
      void refreshSessionBlockStatus(event.properties.sessionID)
    }),
    Bus.subscribe(Permission.Event.Replied, (event) => {
      void refreshSessionBlockStatus(event.properties.sessionID)
    }),
    Bus.subscribe(Question.Event.Asked, (event) => {
      void refreshSessionBlockStatus(event.properties.sessionID)
    }),
    Bus.subscribe(Question.Event.Replied, (event) => {
      void refreshSessionBlockStatus(event.properties.sessionID)
    }),
    Bus.subscribe(Question.Event.Rejected, (event) => {
      void refreshSessionBlockStatus(event.properties.sessionID)
    }),
  )
}

async function refreshSessionBlockStatus(sessionID: SessionID) {
  try {
    const target = await sessionBlockStatus(sessionID)
    const active = await activeSessionItems(sessionID)
    await Promise.all(
      active.map((item) => {
        const status = target ?? "running"
        return item.status === status ? item : TaskQueue.setStatus({ id: item.id, status })
      }),
    )
  } catch (error) {
    DiagnosticLog.recordProcess("server.taskQueueBlockRefreshFailed", { sessionID, error })
    log.warn("failed to refresh task queue block status", { sessionID, error })
  }
}

async function sessionBlockStatus(sessionID: SessionID): Promise<TaskQueue.Status | undefined> {
  const [permissions, questions] = await Promise.all([Permission.list(), Question.list()])
  if (permissions.some((request) => request.sessionID === sessionID)) return "blocked_permission"
  if (questions.some((request) => request.sessionID === sessionID)) return "blocked_question"
  return undefined
}

function compareQueueItems(a: TaskQueue.Info, b: TaskQueue.Info) {
  return a.position - b.position || b.time.created - a.time.created || b.id.localeCompare(a.id)
}

function queueItemExecution(item: TaskQueue.Info): QueueExecution | undefined {
  if (!item.sessionID) return undefined
  switch (item.kind) {
    case "prompt":
    case "followup": {
      const body = promptBodyFromQueueItem(item)
      if (!body) return undefined
      return {
        sessionID: item.sessionID,
        run: () => SessionPrompt.prompt({ ...body, sessionID: item.sessionID! }),
      }
    }
    case "command": {
      const body = commandBodyFromQueueItem(item)
      if (!body) return undefined
      return {
        sessionID: item.sessionID,
        run: () => SessionPrompt.command({ ...body, sessionID: item.sessionID! }),
      }
    }
    case "shell": {
      const body = shellBodyFromQueueItem(item)
      if (!body) return undefined
      return {
        sessionID: item.sessionID,
        run: () => SessionPrompt.shell({ ...body, sessionID: item.sessionID! }),
      }
    }
    case "subagent":
      return workflowSubagentExecution(item)
    case "review":
    case "automation":
      return undefined
  }
}

function workflowSubagentExecution(item: TaskQueue.Info): QueueExecution | undefined {
  if (!isWorkflowQueueItem(item)) return undefined
  const body = promptBodyFromQueueItem(item)
  if (!body) return undefined
  return {
    sessionID: item.sessionID!,
    run: async () => {
      const result = await SessionPrompt.prompt({ ...body, sessionID: item.sessionID! })
      await recordWorkflowSubagentUsage(item, result)
      return result
    },
  }
}

async function recordWorkflowSubagentUsage(item: TaskQueue.Info, result: unknown) {
  const workflow = workflowPayload(item)
  if (!workflow) return
  const usage = messageBudgetUsage(result)

  const { WorkflowRun } = await import("../workflow/run")
  const outputArtifact = messageOutputArtifact(result, usage ?? EmptyWorkflowSubagentBudgetUsage)
  if (outputArtifact) {
    await WorkflowRun.appendArtifact({
      runID: workflow.runID as WorkflowRunID,
      phaseID: workflow.phaseID as WorkflowPhaseID,
      childID: workflow.childID as WorkflowChildID,
      kind: "summary",
      retention: "session",
      summary: outputArtifact.summary,
      payload: outputArtifact.payload,
    })
  }
  if (!usage) return
  await WorkflowRun.appendBudgetUsage({
    runID: workflow.runID as WorkflowRunID,
    phaseID: workflow.phaseID as WorkflowPhaseID,
    childID: workflow.childID as WorkflowChildID,
    kind: "consume",
    usageDelta: usage,
  })

  const detail = await WorkflowRun.getDetail(workflow.runID as WorkflowRunID)
  const child = detail.children.find((candidate) => candidate.id === workflow.childID)
  if (child?.status === "failed" && child.error?.startsWith("Workflow budget exceeded")) {
    throw new Error(child.error)
  }
}

function promptBodyFromQueueItem(item: TaskQueue.Info) {
  const direct = readPayloadBody(item)
  if (direct) return QueuePromptBody().parse(applyWorkflowPromptPolicy(direct, item))
  const text = readPayloadText(item) ?? readPayloadPrompt(item)
  if (!text) return undefined
  return QueuePromptBody().parse(
    applyWorkflowPromptPolicy(
      {
        parts: [{ type: "text", text }],
        agent: item.agent,
        agentRouting: "preserve",
        model: modelObject(item.model),
      },
      item,
    ),
  )
}

function commandBodyFromQueueItem(item: TaskQueue.Info) {
  const direct = readPayloadBody(item)
  if (direct) return QueueCommandBody().parse(direct)
  const text = readPayloadText(item)
  if (!text) return undefined
  return QueueCommandBody().parse({
    command: text,
    arguments: "",
    agent: item.agent,
    model: typeof item.model === "string" ? item.model : undefined,
  })
}

function shellBodyFromQueueItem(item: TaskQueue.Info) {
  const direct = readPayloadBody(item)
  if (direct) return QueueShellBody().parse(direct)
  const text = readPayloadText(item)
  if (!text) return undefined
  return QueueShellBody().parse({
    command: text,
    agent: item.agent ?? "build",
    model: modelObject(item.model),
  })
}

function readPayloadBody(item: TaskQueue.Info) {
  const body = item.payload["body"]
  return body && typeof body === "object" ? (body as Record<string, unknown>) : undefined
}

function readPayloadText(item: TaskQueue.Info) {
  const text = item.payload["text"]
  return typeof text === "string" && text.trim().length > 0 ? text.trim() : undefined
}

function readPayloadPrompt(item: TaskQueue.Info) {
  const prompt = item.payload["prompt"]
  return typeof prompt === "string" && prompt.trim().length > 0 ? prompt.trim() : undefined
}

function applyWorkflowPromptPolicy(body: Record<string, unknown>, item: TaskQueue.Info): Record<string, unknown> {
  const policy = workflowPromptPolicy(item.payload)
  if (!policy) return body

  const next = { ...body }
  const tools = promptToolsFromAllowedTools(policy.allowedTools, policy.escalationPolicy)
  if (tools) {
    next.tools = mergeWorkflowToolPolicy(readBooleanRecord(next.tools), tools)
    next.toolsScope = "turn"
  } else if (readBooleanRecord(next.tools)) {
    next.toolsScope = "turn"
  }

  const isolation = promptIsolationFromWorkflowPolicy(policy)
  if (isolation) next.isolation = mergeWorkflowIsolationPolicy(readPromptIsolationPolicy(next.isolation), isolation)
  return next
}

function workflowPromptPolicy(payload: TaskQueue.Payload) {
  const workflow = payload["workflow"]
  if (!workflow || typeof workflow !== "object") return undefined

  const allowedTools = stringArray(payload["allowedTools"])
  const writePolicy = workflowWritePolicy(payload["writePolicy"])
  const networkPolicy = workflowNetworkPolicy(payload["networkPolicy"])
  const escalationPolicy = workflowEscalationPolicy(payload["escalationPolicy"])
  return { allowedTools, writePolicy, networkPolicy, escalationPolicy }
}

function promptToolsFromAllowedTools(
  allowedTools: string[] | undefined,
  escalationPolicy: "inherit" | "ask" | "deny" | undefined,
): Record<string, boolean> | undefined {
  const tools: Record<string, boolean> = {}
  if (allowedTools?.length) {
    tools["*"] = false
    for (const tool of allowedTools.flatMap(workflowToolPermissionNames)) tools[tool] = true
  }
  if (escalationPolicy === "deny") {
    tools.isolation_escalation = false
  } else if (escalationPolicy === "ask" && allowedTools?.length) {
    // `isolation_escalation` is interactive-only, so an allow rule still asks.
    // This preserves the workflow default while `* = false` denies other tools.
    tools.isolation_escalation = true
  }
  return Object.keys(tools).length > 0 ? tools : undefined
}

function workflowToolPermissionNames(tool: string): string[] {
  const trimmed = tool.trim()
  if (!trimmed) return []
  const names = new Set([trimmed])
  const sanitized = trimmed.replace(/[^A-Za-z0-9_]/g, "_")
  if (sanitized !== trimmed) names.add(sanitized)
  for (const alias of workflowToolAliases(trimmed)) names.add(alias)
  return Array.from(names)
}

function workflowToolAliases(tool: string): string[] {
  switch (tool) {
    case "file.read":
      return ["read"]
    case "file.grep":
    case "rg":
      return ["grep"]
    case "file.glob":
      return ["glob"]
    case "file.list":
      return ["list"]
    default:
      return []
  }
}

function mergeWorkflowToolPolicy(
  existing: Record<string, boolean> | undefined,
  workflow: Record<string, boolean>,
): Record<string, boolean> {
  const merged = { ...workflow }
  for (const [tool, enabled] of Object.entries(existing ?? {})) {
    if (enabled === false) merged[tool] = false
    else if (workflow[tool] === true) merged[tool] = true
  }
  return merged
}

function promptIsolationFromWorkflowPolicy(policy: {
  writePolicy?: "read-only" | "serialized" | "worktree-required"
  networkPolicy?: "inherit" | "disabled" | "allowed"
}): PromptIsolationPolicyType | undefined {
  const isolation: PromptIsolationPolicyType = {}
  if (policy.writePolicy === "read-only") isolation.mode = "read-only"
  if (policy.writePolicy === "serialized" || policy.writePolicy === "worktree-required") {
    isolation.mode = "workspace-write"
  }
  if (policy.networkPolicy === "disabled") isolation.network = false
  if (policy.networkPolicy === "allowed") isolation.network = true
  return Object.keys(isolation).length > 0 ? isolation : undefined
}

function mergeWorkflowIsolationPolicy(
  existing: PromptIsolationPolicyType | undefined,
  workflow: PromptIsolationPolicyType,
): PromptIsolationPolicyType {
  if (!existing) return workflow
  const mode = stricterIsolationMode(workflow.mode, existing.mode)
  const network =
    workflow.network === false || existing.network === false ? false : (workflow.network ?? existing.network)
  return {
    ...(mode ? { mode } : {}),
    ...(network === undefined ? {} : { network }),
  }
}

function stricterIsolationMode(
  a: PromptIsolationPolicyType["mode"],
  b: PromptIsolationPolicyType["mode"],
): PromptIsolationPolicyType["mode"] {
  if (!a) return b
  if (!b) return a
  const rank = { "read-only": 0, "workspace-write": 1, "full-access": 2 } as const
  return rank[a] <= rank[b] ? a : b
}

function readPromptIsolationPolicy(value: unknown): PromptIsolationPolicyType | undefined {
  const parsed = PromptIsolationPolicy.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function readBooleanRecord(value: unknown): Record<string, boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const result: Record<string, boolean> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "boolean") result[key] = item
  }
  return result
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  return items.length ? items : undefined
}

function workflowWritePolicy(value: unknown): "read-only" | "serialized" | "worktree-required" | undefined {
  return value === "read-only" || value === "serialized" || value === "worktree-required" ? value : undefined
}

function workflowNetworkPolicy(value: unknown): "inherit" | "disabled" | "allowed" | undefined {
  return value === "inherit" || value === "disabled" || value === "allowed" ? value : undefined
}

function workflowEscalationPolicy(value: unknown): "inherit" | "ask" | "deny" | undefined {
  return value === "inherit" || value === "ask" || value === "deny" ? value : undefined
}

type WorkflowQueuePayload = {
  runID: string
  phaseID: string
  childID: string
}

function isWorkflowQueueItem(item: TaskQueue.Info) {
  const workflow = item.payload["workflow"]
  return !!workflow && typeof workflow === "object"
}

function workflowPayload(item: TaskQueue.Info): WorkflowQueuePayload | undefined {
  const workflow = item.payload["workflow"]
  if (!workflow || typeof workflow !== "object") return undefined
  const record = workflow as Record<string, unknown>
  if (typeof record.runID !== "string" || typeof record.phaseID !== "string" || typeof record.childID !== "string") {
    return undefined
  }
  return {
    runID: record.runID,
    phaseID: record.phaseID,
    childID: record.childID,
  }
}

function sameWorkflowPhase(item: TaskQueue.Info, workflow: WorkflowQueuePayload) {
  const candidate = workflowPayload(item)
  return candidate?.runID === workflow.runID && candidate.phaseID === workflow.phaseID
}

function workflowMaxParallel(payload: TaskQueue.Payload) {
  return positiveInteger(payload["maxParallel"])
}

type WorkflowSubagentBudgetUsage = {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  toolCalls: number
  estimatedCostUsd: number
}

const EmptyWorkflowSubagentBudgetUsage: WorkflowSubagentBudgetUsage = {
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  toolCalls: 0,
  estimatedCostUsd: 0,
}

function messageBudgetUsage(result: unknown): WorkflowSubagentBudgetUsage | undefined {
  const tokens = messageTokens(result)
  const toolCalls = messageToolCalls(result)
  if (!tokens && toolCalls === 0) return undefined
  const estimatedCostUsd = messageEstimatedCostUsd(result)
  return {
    totalTokens: tokens?.total ?? 0,
    inputTokens: tokens?.input ?? 0,
    outputTokens: tokens?.output ?? 0,
    toolCalls,
    estimatedCostUsd: estimatedCostUsd ?? 0,
  }
}

function messageOutputArtifact(result: unknown, usage: WorkflowSubagentBudgetUsage) {
  if (!result || typeof result !== "object") return undefined
  const info = (result as { info?: unknown }).info
  if (!info || typeof info !== "object" || (info as { role?: unknown }).role !== "assistant") return undefined
  const messageID = info && typeof info === "object" ? (info as { id?: unknown }).id : undefined
  const parts = (result as { parts?: unknown }).parts
  const output = messageTextOutput(parts)
  const tools = messageToolNames(parts)
  const fallback = usage.toolCalls > 0 ? `${usage.toolCalls} tool call(s) completed.` : "Workflow child completed."
  return {
    summary: truncateArtifactSummary(output || fallback),
    payload: {
      messageID: typeof messageID === "string" ? messageID : undefined,
      output: output || undefined,
      tools,
      usage,
    },
  }
}

function messageTokens(result: unknown) {
  if (!result || typeof result !== "object") return undefined
  const info = (result as { info?: unknown }).info
  if (!info || typeof info !== "object") return undefined
  const tokens = (info as { tokens?: unknown }).tokens
  if (!tokens || typeof tokens !== "object") return undefined
  const record = tokens as Record<string, unknown>
  const input = nonNegativeNumber(record.input)
  const output = nonNegativeNumber(record.output)
  const total = nonNegativeNumber(record.total) ?? (input ?? 0) + (output ?? 0)
  if (input === undefined && output === undefined && total === 0) return undefined
  return {
    total,
    input: input ?? 0,
    output: output ?? 0,
  }
}

function messageEstimatedCostUsd(result: unknown) {
  if (!result || typeof result !== "object") return undefined
  const info = (result as { info?: unknown }).info
  if (!info || typeof info !== "object") return undefined
  return nonNegativeNumber((info as { estimatedCostUsd?: unknown }).estimatedCostUsd)
}

function messageToolCalls(result: unknown) {
  if (!result || typeof result !== "object") return 0
  const parts = (result as { parts?: unknown }).parts
  if (!Array.isArray(parts)) return 0
  return parts.filter((part) => {
    if (!part || typeof part !== "object") return false
    return (part as { type?: unknown }).type === "tool"
  }).length
}

function messageTextOutput(parts: unknown) {
  if (!Array.isArray(parts)) return ""
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return ""
      const record = part as { type?: unknown; text?: unknown }
      return record.type === "text" && typeof record.text === "string" ? record.text.trim() : ""
    })
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

function messageToolNames(parts: unknown) {
  if (!Array.isArray(parts)) return []
  return Array.from(
    new Set(
      parts
        .map((part) => {
          if (!part || typeof part !== "object") return undefined
          const record = part as { type?: unknown; tool?: unknown }
          return record.type === "tool" && typeof record.tool === "string" ? record.tool : undefined
        })
        .filter((tool): tool is string => typeof tool === "string" && tool.length > 0),
    ),
  )
}

function truncateArtifactSummary(text: string) {
  const compact = text.replace(/\s+/g, " ").trim()
  return compact.length > 500 ? `${compact.slice(0, 497)}...` : compact
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}

function modelObject(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (typeof record.providerID !== "string" || typeof record.modelID !== "string") return undefined
  return {
    providerID: record.providerID,
    modelID: record.modelID,
  }
}
