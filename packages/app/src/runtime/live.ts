import {
  createHeadlessClient,
  type HeadlessClient,
  type HeadlessSessionEvidence,
  type HeadlessTaskQueueItem,
} from "@ax-code/sdk/headless/client"
import { isHeadlessRuntimeEvent } from "@ax-code/sdk/headless/event"
import { applyHeadlessProjectionEvent, createHeadlessProjectionState } from "@ax-code/sdk/headless/projection"
import type { AxCodeAppRuntimeConfig } from "./config"
import type {
  AppCommandCenterState,
  AppAgentOption,
  AppDreEvidence,
  AppHeadlessEvent,
  AppModelOption,
  AppProviderStatus,
  AppProjectionState,
  AppRiskEvidence,
  AppRollbackPoint,
  AppRuntimeCatalog,
  AppScheduledTask,
  AppSemanticEvidence,
  AppSession,
  AppSessionEvidence,
  AppTerminal,
  AppWorktree,
} from "../projection/types"
import type { AppQueueItem } from "../projection/types"

export type LiveHeadlessClientLike = {
  client: {
    session: {
      list(parameters?: { directory?: string; limit?: number }): Promise<{ data?: unknown }>
    }
    config?: {
      providers(parameters?: { directory?: string }): Promise<{ data?: unknown }>
    }
    agent?: {
      agents(parameters?: { directory?: string }): Promise<{ data?: unknown }>
    }
    worktree?: {
      list(parameters?: { directory?: string }): Promise<{ data?: unknown }>
    }
    pty?: {
      list(parameters?: { directory?: string }): Promise<{ data?: unknown }>
    }
  }
  taskQueue?: {
    list(parameters?: { limit?: number }): Promise<unknown>
  }
  scheduledTask?: {
    list(parameters?: { limit?: number }): Promise<unknown>
  }
  sessionEvidence?: {
    load(sessionID: string): Promise<unknown>
  }
  subscribe?(options?: { signal?: AbortSignal }): AsyncGenerator<unknown>
}

export type LiveBootstrapOptions = Extract<AxCodeAppRuntimeConfig, { mode: "live" }> & {
  client?: LiveHeadlessClientLike
}

export function createLiveHeadlessClient(config: Extract<AxCodeAppRuntimeConfig, { mode: "live" }>): HeadlessClient {
  return createHeadlessClient({
    baseUrl: config.baseUrl,
    headers: config.headers,
    directory: config.directory,
  })
}

export async function bootstrapLiveCommandCenterState(options: LiveBootstrapOptions): Promise<AppCommandCenterState> {
  const client = options.client ?? createLiveHeadlessClient(options)
  const projection = createEmptyAppProjection()
  const response = await client.client.session.list({
    directory: options.directory,
    limit: options.sessionLimit ?? 50,
  })
  const sessions = normalizeSessionList(response.data, options.directory)
  const [queue, catalog, worktrees, terminals, scheduledTasks] = await Promise.all([
    loadLiveTaskQueue(client),
    loadLiveRuntimeCatalog(client, options),
    loadLiveWorktrees(client, options),
    loadLiveTerminals(client, options),
    loadLiveScheduledTasks(client),
  ])

  for (const session of sessions) {
    applyHeadlessProjectionEvent(projection, {
      type: "session.created",
      properties: { info: session },
    })
  }

  return {
    projection,
    queue,
    evidence: sessions[0] ? { [sessions[0].id]: await loadLiveSessionEvidence(client, sessions[0].id) } : {},
    catalog,
    worktrees,
    terminals,
    scheduledTasks,
    selectedSessionID: sessions[0]?.id ?? "",
  }
}

export function applyLiveRuntimeEvent(state: AppCommandCenterState, event: unknown) {
  if (!isHeadlessRuntimeEvent(event)) return false
  if (applyTaskQueueEvent(state, event)) return true
  if (applyScheduledTaskEvent(state, event)) return true
  applyHeadlessProjectionEvent(state.projection, event as AppHeadlessEvent)
  return true
}

export async function followLiveCommandCenterEvents(
  state: AppCommandCenterState,
  client: Pick<LiveHeadlessClientLike, "subscribe">,
  options: {
    signal?: AbortSignal
    onEvent?: (event: unknown, applied: boolean) => void
  } = {},
) {
  if (!client.subscribe) return 0
  let appliedCount = 0
  for await (const event of client.subscribe({ signal: options.signal })) {
    const applied = applyLiveRuntimeEvent(state, event)
    if (applied) appliedCount++
    options.onEvent?.(event, applied)
  }
  return appliedCount
}

export async function loadLiveSessionEvidence(
  client: Pick<LiveHeadlessClientLike, "sessionEvidence">,
  sessionID: string,
): Promise<AppSessionEvidence> {
  if (!client.sessionEvidence) return emptySessionEvidence(sessionID)
  try {
    return normalizeLiveSessionEvidence(await client.sessionEvidence.load(sessionID), sessionID)
  } catch (error) {
    return {
      ...emptySessionEvidence(sessionID),
      status: "error",
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}

function createEmptyAppProjection(): AppProjectionState {
  return createHeadlessProjectionState<
    AppProjectionState["session"][number],
    AppProjectionState["todo"][string][number],
    AppProjectionState["session_diff"][string][number],
    NonNullable<AppProjectionState["session_status"][string]>,
    AppProjectionState["message"][string][number],
    AppProjectionState["part"][string][number],
    unknown,
    NonNullable<AppProjectionState["session_goal"][string]>,
    AppQueueItem
  >()
}

async function loadLiveTaskQueue(client: LiveHeadlessClientLike): Promise<AppQueueItem[]> {
  if (!client.taskQueue) return []
  const response = await client.taskQueue.list({ limit: 200 })
  return normalizeQueueList(response)
}

async function loadLiveScheduledTasks(client: LiveHeadlessClientLike): Promise<AppScheduledTask[]> {
  if (!client.scheduledTask) return []
  const response = await client.scheduledTask.list({ limit: 100 })
  return normalizeScheduledTaskList(response)
}

async function loadLiveRuntimeCatalog(
  client: LiveHeadlessClientLike,
  options: Pick<LiveBootstrapOptions, "directory">,
): Promise<AppRuntimeCatalog> {
  const [providers, agents] = await Promise.all([
    client.client.config?.providers({ directory: options.directory }).catch(() => undefined),
    client.client.agent?.agents({ directory: options.directory }).catch(() => undefined),
  ])
  const providerData = providers?.data
  return {
    providers: normalizeProviderStatuses(providerData),
    agents: normalizeAgentOptions(agents?.data),
    models: normalizeModelOptions(providerData),
  }
}

async function loadLiveWorktrees(
  client: LiveHeadlessClientLike,
  options: Pick<LiveBootstrapOptions, "directory">,
): Promise<AppWorktree[]> {
  const response = await client.client.worktree?.list({ directory: options.directory }).catch(() => undefined)
  return normalizeWorktreeList(response?.data)
}

export function normalizeWorktreeList(value: unknown): AppWorktree[] {
  const list = Array.isArray(value)
    ? value
    : (readArrayProperty(value, "worktrees") ??
      readArrayProperty(value, "items") ??
      readArrayProperty(value, "data") ??
      [])
  return list.map(normalizeWorktree).filter((item): item is AppWorktree => Boolean(item))
}

export function normalizeWorktree(value: unknown): AppWorktree | undefined {
  const directory = typeof value === "string" ? value : readString(readRecord(value) ?? {}, "directory")
  if (!directory) return undefined
  return {
    directory,
    name: readString(readRecord(value) ?? {}, "name") ?? directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory,
  }
}

async function loadLiveTerminals(
  client: LiveHeadlessClientLike,
  options: Pick<LiveBootstrapOptions, "directory">,
): Promise<AppTerminal[]> {
  const response = await client.client.pty?.list({ directory: options.directory }).catch(() => undefined)
  return normalizeTerminalList(response?.data)
}

export function normalizeTerminalList(value: unknown): AppTerminal[] {
  const list = Array.isArray(value)
    ? value
    : (readArrayProperty(value, "terminals") ??
      readArrayProperty(value, "items") ??
      readArrayProperty(value, "data") ??
      [])
  return list.map(normalizeTerminal).filter((item): item is AppTerminal => Boolean(item))
}

export function normalizeTerminal(value: unknown): AppTerminal | undefined {
  const record = readRecord(value)
  if (!record) return undefined
  const id = readString(record, "id")
  if (!id) return undefined
  const status = readString(record, "status")
  return {
    id,
    title: readString(record, "title") ?? readString(record, "command") ?? id,
    command: readString(record, "command") ?? "",
    cwd: readString(record, "cwd") ?? "",
    status: status === "running" || status === "exited" ? status : "unknown",
  }
}

function applyTaskQueueEvent(state: AppCommandCenterState, event: unknown) {
  if (!event || typeof event !== "object") return false
  const record = event as Record<string, unknown>
  const properties = record["properties"]
  if (!properties || typeof properties !== "object") return false
  const props = properties as Record<string, unknown>
  switch (record["type"]) {
    case "task.queue.created":
    case "task.queue.updated": {
      const item = normalizeLiveQueueItem(props["item"])
      if (!item) return true
      const index = state.queue.findIndex((existing) => existing.id === item.id)
      if (index >= 0) state.queue[index] = item
      else state.queue.push(item)
      return true
    }
    case "task.queue.deleted": {
      const id = typeof props["id"] === "string" ? props["id"] : undefined
      if (id) state.queue = state.queue.filter((item) => item.id !== id)
      return true
    }
  }
  return false
}

function applyScheduledTaskEvent(state: AppCommandCenterState, event: unknown) {
  if (!event || typeof event !== "object") return false
  const record = event as Record<string, unknown>
  const properties = record["properties"]
  if (!properties || typeof properties !== "object") return false
  const props = properties as Record<string, unknown>
  switch (record["type"]) {
    case "scheduled.task.created":
    case "scheduled.task.updated": {
      const task = normalizeScheduledTask(props["task"])
      if (!task) return true
      const index = state.scheduledTasks.findIndex((existing) => existing.id === task.id)
      if (index >= 0) state.scheduledTasks[index] = task
      else state.scheduledTasks.push(task)
      return true
    }
    case "scheduled.task.deleted": {
      const id = typeof props["id"] === "string" ? props["id"] : undefined
      if (id) state.scheduledTasks = state.scheduledTasks.filter((task) => task.id !== id)
      return true
    }
  }
  return false
}

function normalizeQueueList(value: unknown): AppQueueItem[] {
  if (Array.isArray(value))
    return value.map(normalizeLiveQueueItem).filter((item): item is AppQueueItem => Boolean(item))
  const data = value && typeof value === "object" ? (value as Record<string, unknown>)["data"] : undefined
  if (Array.isArray(data)) return data.map(normalizeLiveQueueItem).filter((item): item is AppQueueItem => Boolean(item))
  return []
}

function normalizeScheduledTaskList(value: unknown): AppScheduledTask[] {
  if (Array.isArray(value))
    return value.map(normalizeScheduledTask).filter((task): task is AppScheduledTask => Boolean(task))
  const data = value && typeof value === "object" ? (value as Record<string, unknown>)["data"] : undefined
  if (Array.isArray(data))
    return data.map(normalizeScheduledTask).filter((task): task is AppScheduledTask => Boolean(task))
  return []
}

export function normalizeScheduledTask(value: unknown): AppScheduledTask | undefined {
  const record = readRecord(value)
  if (!record) return undefined
  const id = readString(record, "id")
  const title = readString(record, "title")
  const prompt = readString(record, "prompt")
  const status = readString(record, "status")
  if (!id || !title || !prompt || !status) return undefined
  return {
    id,
    project:
      readString(record, "projectID") ?? readString(record, "project") ?? readString(record, "directory") ?? "project",
    title,
    prompt,
    schedule: record["schedule"],
    status: status === "active" || status === "paused" || status === "disabled" ? status : "disabled",
    agent: readString(record, "agent"),
    model: record["model"],
    lastQueueID: readString(record, "lastQueueID"),
    error: readString(record, "error"),
    nextRunAt: readNumber(record, "nextRunAt"),
    lastRunAt: readNumber(record, "lastRunAt"),
  }
}

function normalizeAgentOptions(value: unknown): AppAgentOption[] {
  const list = Array.isArray(value)
    ? value
    : (readArrayProperty(value, "agents") ??
      readArrayProperty(value, "items") ??
      readArrayProperty(value, "data") ??
      [])
  return list.map(normalizeAgentOption).filter((agent): agent is AppAgentOption => Boolean(agent))
}

function normalizeAgentOption(value: unknown): AppAgentOption | undefined {
  const record = readRecord(value)
  if (!record) return undefined
  const id = readString(record, "id") ?? readString(record, "name") ?? readString(record, "key")
  if (!id) return undefined
  return {
    id,
    label: readString(record, "label") ?? readString(record, "description") ?? id,
    mode: readString(record, "mode"),
  }
}

function normalizeModelOptions(value: unknown): AppModelOption[] {
  const root = readRecord(value)
  const providers = Array.isArray(value)
    ? value
    : (readArrayProperty(value, "providers") ?? readArrayProperty(value, "items") ?? [])
  return providers.flatMap((provider) => normalizeProviderModels(provider, root))
}

function normalizeProviderStatuses(value: unknown): AppProviderStatus[] {
  const root = readRecord(value)
  const providers = Array.isArray(value)
    ? value
    : (readArrayProperty(value, "providers") ?? readArrayProperty(value, "items") ?? [])
  return providers
    .map((provider) => normalizeProviderStatus(provider, root))
    .filter((provider): provider is AppProviderStatus => Boolean(provider))
}

function normalizeProviderStatus(value: unknown, root?: Record<string, unknown>): AppProviderStatus | undefined {
  const provider = readRecord(value)
  if (!provider) return undefined
  const id = readString(provider, "id") ?? readString(provider, "providerID") ?? readString(provider, "name")
  if (!id) return undefined
  const models = readModelArray(provider["models"])
  const defaultValue = readRecord(root?.["default"])?.[id]
  const defaultModelID = typeof defaultValue === "string" ? defaultValue : undefined
  return {
    id,
    label: readString(provider, "name") ?? readString(provider, "label") ?? id,
    source: readString(provider, "source"),
    modelCount: models.length,
    ...(defaultModelID ? { defaultModelID } : {}),
    status: models.length > 0 ? "available" : "no_models",
  }
}

function normalizeProviderModels(value: unknown, root?: Record<string, unknown>): AppModelOption[] {
  const provider = readRecord(value)
  if (!provider) return []
  const providerID = readString(provider, "id") ?? readString(provider, "providerID") ?? readString(provider, "name")
  if (!providerID) return []
  const models = readModelArray(provider["models"])
  const defaultModelID = readRecord(root?.["default"])?.[providerID]
  const defaultModel =
    typeof defaultModelID === "string" && !models.some((model) => readModelID(model) === defaultModelID)
      ? [defaultModelID]
      : []
  return [...models, ...defaultModel]
    .map((model) => normalizeModelOption(providerID, model))
    .filter((model): model is AppModelOption => Boolean(model))
}

function readModelArray(value: unknown) {
  if (Array.isArray(value)) return value
  if (value && typeof value === "object") return Object.values(value)
  return []
}

function normalizeModelOption(providerID: string, value: unknown): AppModelOption | undefined {
  const modelID = readModelID(value)
  if (!modelID) return undefined
  const record = readRecord(value)
  const label = record ? (readString(record, "name") ?? readString(record, "label") ?? modelID) : modelID
  return {
    providerID,
    modelID,
    label: `${providerID} · ${label}`,
  }
}

function readModelID(value: unknown) {
  if (typeof value === "string") return value
  const record = readRecord(value)
  return record ? (readString(record, "id") ?? readString(record, "modelID") ?? readString(record, "name")) : undefined
}

export function normalizeLiveQueueItem(value: unknown): AppQueueItem | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as HeadlessTaskQueueItem & Record<string, unknown>
  const id = readString(record, "id")
  const title = readString(record, "title")
  const kind = readString(record, "kind")
  const status = readString(record, "status")
  if (!id || !title || !kind || !status) return undefined
  return {
    id,
    project:
      readString(record, "projectID") ?? readString(record, "project") ?? readString(record, "directory") ?? "project",
    directory: readString(record, "directory"),
    sessionID: readString(record, "sessionID"),
    title,
    kind: kind as AppQueueItem["kind"],
    status: status as AppQueueItem["status"],
    priority: typeof record.priority === "number" ? record.priority : 0,
    position: typeof record.position === "number" ? record.position : undefined,
    agent: readString(record, "agent"),
    model: record.model,
    payload: readRecord(record.payload),
    sourceMessageID: readString(record, "sourceMessageID"),
    sourceTaskID: readString(record, "sourceTaskID"),
    createdAt:
      record.time && typeof record.time === "object"
        ? (readTime(record.time as Record<string, unknown>, "created") ?? Date.now())
        : Date.now(),
  }
}

export function normalizeLiveSessionEvidence(value: unknown, fallbackSessionID: string): AppSessionEvidence {
  if (!value || typeof value !== "object") return emptySessionEvidence(fallbackSessionID)
  const record = value as Partial<HeadlessSessionEvidence> & Record<string, unknown>
  const sessionID = readString(record, "sessionID") ?? fallbackSessionID
  const riskRecord = readRecord(record["risk"])
  const dreRecord = readRecord(record["dre"])
  const semanticRecord = readRecord(record["semantic"]) ?? readRecord(riskRecord?.["semantic"])
  const rollback = Array.isArray(record["rollback"]) ? record["rollback"] : []

  return {
    sessionID,
    status: "ready",
    risk: riskRecord ? normalizeRiskEvidence(riskRecord) : undefined,
    semantic: semanticRecord ? normalizeSemanticEvidence(semanticRecord) : undefined,
    dre: dreRecord ? normalizeDreEvidence(dreRecord) : undefined,
    rollbackPoints: rollback.map(normalizeRollbackPoint).filter((point): point is AppRollbackPoint => Boolean(point)),
    artifactCounts: {
      findings: readArrayLength(riskRecord?.["findings"]),
      verificationEnvelopes: readArrayLength(riskRecord?.["envelopes"]),
      reviewResults: readArrayLength(riskRecord?.["reviewResults"]),
      debugCases: readArrayLength(readRecord(riskRecord?.["debug"])?.["cases"]),
      decisionHints: countDecisionHints(riskRecord?.["decisionHints"]),
    },
    errors: Array.isArray(record["errors"])
      ? record["errors"].map(readEvidenceError).filter((error): error is string => Boolean(error))
      : [],
  }
}

function emptySessionEvidence(sessionID: string): AppSessionEvidence {
  return {
    sessionID,
    status: "ready",
    rollbackPoints: [],
    artifactCounts: {
      findings: 0,
      verificationEnvelopes: 0,
      reviewResults: 0,
      debugCases: 0,
      decisionHints: 0,
    },
    errors: [],
  }
}

function normalizeRiskEvidence(record: Record<string, unknown>): AppRiskEvidence | undefined {
  const assessment = readRecord(record["assessment"])
  const source = assessment ?? record
  const level = readString(source, "level")
  if (!level) return undefined
  return {
    level,
    score: readNumber(source, "score"),
    confidence: readNumber(source, "confidence"),
    readiness: readString(source, "readiness"),
    summary: readString(source, "summary"),
    drivers: readStringArray(record["drivers"]),
  }
}

function normalizeSemanticEvidence(record: Record<string, unknown>): AppSemanticEvidence | undefined {
  const headline = readString(record, "headline")
  const risk = readString(record, "risk")
  if (!headline || !risk) return undefined
  const changes = Array.isArray(record["changes"]) ? record["changes"] : []
  return {
    headline,
    risk,
    primary: readString(record, "primary"),
    files: readNumber(record, "files"),
    additions: readNumber(record, "additions"),
    deletions: readNumber(record, "deletions"),
    changes: changes
      .map(normalizeSemanticChange)
      .filter((change): change is AppSemanticEvidence["changes"][number] => Boolean(change)),
  }
}

function normalizeSemanticChange(value: unknown): AppSemanticEvidence["changes"][number] | undefined {
  const record = readRecord(value)
  if (!record) return undefined
  const file = readString(record, "file")
  const summary = readString(record, "summary")
  if (!file || !summary) return undefined
  const risk = readString(record, "risk")
  return {
    file,
    summary,
    ...(risk ? { risk } : {}),
  }
}

function normalizeDreEvidence(record: Record<string, unknown>): AppDreEvidence | undefined {
  const detail = readRecord(record["detail"])
  const source = detail ?? record
  const timeline = Array.isArray(record["timeline"]) ? record["timeline"] : []
  const normalizedTimeline = timeline
    .map((item) => (typeof item === "string" ? item : readString(readRecord(item) ?? {}, "text")))
    .filter((line): line is string => Boolean(line))
  if (!readString(source, "decision") && !readString(source, "summary") && normalizedTimeline.length === 0) {
    return undefined
  }
  return {
    decision: readString(source, "decision"),
    summary: readString(source, "summary"),
    readiness: readString(source, "readiness"),
    timeline: normalizedTimeline.slice(0, 6),
  }
}

function normalizeRollbackPoint(value: unknown): AppRollbackPoint | undefined {
  const record = readRecord(value)
  if (!record) return undefined
  const step = readNumber(record, "step")
  if (step == null) return undefined
  const tokens = readRecord(record["tokens"])
  const input = tokens ? readNumber(tokens, "input") : undefined
  const output = tokens ? readNumber(tokens, "output") : undefined
  return {
    step,
    messageID: readString(record, "messageID"),
    partID: readString(record, "partID"),
    durationMs: readNumber(record, "duration"),
    tokens:
      input === undefined || output === undefined
        ? undefined
        : {
            input,
            output,
          },
    tools: readStringArray(record["tools"]),
    kinds: readStringArray(record["kinds"]),
  }
}

function normalizeSessionList(value: unknown, fallbackProject?: string): AppSession[] {
  const list = Array.isArray(value)
    ? value
    : (readArrayProperty(value, "sessions") ?? readArrayProperty(value, "items") ?? [])
  return list.map((item) => normalizeSession(item, fallbackProject)).filter((item): item is AppSession => Boolean(item))
}

function normalizeSession(value: unknown, fallbackProject?: string): AppSession | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const id = readString(record, "id") ?? readString(record, "sessionID")
  if (!id) return undefined

  return {
    id,
    title: readString(record, "title") ?? readString(record, "name") ?? `Session ${id.slice(0, 8)}`,
    project: readProjectName(record) ?? fallbackProject ?? "current project",
    worktree: readString(record, "worktree") ?? readString(record, "branch"),
    updatedAt: readTime(record, "updatedAt") ?? readTime(record, "time") ?? Date.now(),
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function readArrayProperty(value: unknown, key: string): unknown[] | undefined {
  if (!value || typeof value !== "object") return undefined
  const child = (value as Record<string, unknown>)[key]
  return Array.isArray(child) ? child : undefined
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function readArrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}

function readEvidenceError(value: unknown) {
  if (typeof value === "string") return value
  const record = readRecord(value)
  if (!record) return undefined
  const source = readString(record, "source")
  const message = readString(record, "message")
  if (!message) return undefined
  return source ? `${source}: ${message}` : message
}

function countDecisionHints(value: unknown) {
  const record = readRecord(value)
  if (!record) return 0
  for (const key of ["hints", "items", "decisions"]) {
    const count = readArrayLength(record[key])
    if (count > 0) return count
  }
  return readNumber(record, "count") ?? 0
}

function readTime(record: Record<string, unknown>, key: string) {
  const value = record[key]
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readProjectName(record: Record<string, unknown>) {
  const direct = readString(record, "project")
  if (direct) return direct

  const project = record["project"]
  if (!project || typeof project !== "object") return undefined
  const projectRecord = project as Record<string, unknown>
  return (
    readString(projectRecord, "name") ?? readString(projectRecord, "path") ?? readString(projectRecord, "directory")
  )
}
