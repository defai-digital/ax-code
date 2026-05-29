import {
  createHeadlessClient,
  type HeadlessClient,
  type HeadlessSessionEvidence,
  type HeadlessTaskQueueItem,
} from "@ax-code/sdk/headless/client"
import { isHeadlessRuntimeEvent, type HeadlessRuntimeStatusEvent } from "@ax-code/sdk/headless/event"
import {
  applyHeadlessProjectionEvent,
  createHeadlessProjectionState,
  runtimeProbeKeysForEvent,
  type HeadlessProjectionEffect,
} from "@ax-code/sdk/headless/projection"
import type { AxCodeAppRuntimeConfig } from "./config"
import type {
  AppCommandCenterState,
  AppAgentOption,
  AppArtifactPreview,
  AppBranchRankEvidence,
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
  AppSkillOption,
  AppTerminal,
  AppWorktree,
} from "../projection/types"
import type { AppQueueItem } from "../projection/types"

export type LiveHeadlessClientLike = {
  client: {
    session: {
      list(parameters?: { directory?: string; limit?: number }): Promise<{ data?: unknown }>
      messages?(parameters: { sessionID: string; directory?: string; limit?: number }): Promise<{ data?: unknown }>
    }
    config?: {
      get(parameters?: { directory?: string }): Promise<{ data?: unknown }>
      providers(parameters?: { directory?: string }): Promise<{ data?: unknown }>
    }
    agent?: {
      agents(parameters?: { directory?: string }): Promise<{ data?: unknown }>
    }
    app?: {
      skills(parameters?: { directory?: string }): Promise<{ data?: unknown }>
    }
    mcp?: {
      status(parameters?: { directory?: string }): Promise<{ data?: unknown }>
    }
    lsp?: {
      status(parameters?: { directory?: string }): Promise<{ data?: unknown }>
    }
    debugEngine?: {
      pendingPlans(parameters?: { directory?: string }): Promise<{ data?: unknown }>
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
    load(sessionID: string, parameters?: { includeBranchRank?: boolean; deepBranchRank?: boolean }): Promise<unknown>
  }
  subscribe?(options?: { signal?: AbortSignal }): AsyncGenerator<unknown>
}

export type AppRuntimeProbeKey = "mcp" | "lsp" | "debug-engine"

export type LiveRuntimeApplyResult = {
  applied: boolean
  effects: HeadlessProjectionEffect[]
}

export type LiveBootstrapOptions = Extract<AxCodeAppRuntimeConfig, { mode: "live" }> & {
  client?: LiveHeadlessClientLike
}

export type LiveSessionMessages = {
  messages: AppProjectionState["message"][string]
  parts: AppProjectionState["part"]
}

const LIVE_SESSION_MESSAGE_LIMIT = 500

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

  const selectedSessionID = sessions[0]?.id
  const [messages, evidence] = selectedSessionID
    ? await Promise.all([
        loadLiveSessionMessages(client, selectedSessionID, options.directory),
        loadLiveSessionEvidence(client, selectedSessionID),
      ])
    : [emptyLiveSessionMessages(), undefined]
  applyLiveSessionMessages(projection, messages)

  return {
    projection,
    queue,
    evidence: selectedSessionID && evidence ? { [selectedSessionID]: evidence } : {},
    catalog,
    worktrees,
    terminals,
    scheduledTasks,
    selectedSessionID: selectedSessionID ?? "",
  }
}

export function applyLiveRuntimeEvent(state: AppCommandCenterState, event: unknown) {
  return applyLiveRuntimeEventWithEffects(state, event).applied
}

export function applyLiveRuntimeEventWithEffects(state: AppCommandCenterState, event: unknown): LiveRuntimeApplyResult {
  if (!isHeadlessRuntimeEvent(event)) return { applied: false, effects: [] }
  if (applyTaskQueueEvent(state, event)) return { applied: true, effects: [] }
  if (applyScheduledTaskEvent(state, event)) return { applied: true, effects: [] }
  const result = applyHeadlessProjectionEvent(state.projection, event as AppHeadlessEvent)
  return { applied: result.handled, effects: result.effects }
}

export async function followLiveCommandCenterEvents(
  state: AppCommandCenterState,
  client: Pick<LiveHeadlessClientLike, "subscribe">,
  options: {
    signal?: AbortSignal
    probeClient?: LiveHeadlessClientLike
    directory?: string
    probeDelayMs?: number
    onEvent?: (event: unknown, applied: boolean) => void
    onBootstrapReload?: () => void
    onProbeRefresh?: (catalog: AppRuntimeCatalog, keys: AppRuntimeProbeKey[]) => void
    onProbeRefreshError?: (error: unknown, keys: AppRuntimeProbeKey[]) => void
  } = {},
) {
  if (!client.subscribe) return 0
  let appliedCount = 0
  const probeScheduler = createRuntimeCatalogProbeScheduler(state, options)
  try {
    for await (const event of client.subscribe({ signal: options.signal })) {
      const { applied, effects } = applyLiveRuntimeEventWithEffects(state, event)
      if (applied) appliedCount++
      if (applied) probeScheduler.schedule(runtimeProbeKeysForUnknownEvent(event))
      if (effects.some((effect) => effect.type === "bootstrap.reload")) options.onBootstrapReload?.()
      options.onEvent?.(event, applied)
    }
  } finally {
    await probeScheduler.flush()
  }
  return appliedCount
}

export type LiveEventStreamFollowStatus = "connecting" | "connected" | "unavailable" | "error"

export async function followLiveCommandCenterEventsWithReconnect(
  state: AppCommandCenterState,
  createClient: () => Pick<LiveHeadlessClientLike, "subscribe">,
  options: {
    signal?: AbortSignal
    maxAttempts?: number
    retryDelayMs?: number
    probeClient?: LiveHeadlessClientLike
    directory?: string
    probeDelayMs?: number
    onStatus?: (status: LiveEventStreamFollowStatus, metadata?: { attempt: number; error?: unknown }) => void
    onEvent?: (event: unknown, applied: boolean) => void
    onBootstrapReload?: () => void
    onProbeRefresh?: (catalog: AppRuntimeCatalog, keys: AppRuntimeProbeKey[]) => void
    onProbeRefreshError?: (error: unknown, keys: AppRuntimeProbeKey[]) => void
  } = {},
): Promise<{ appliedCount: number; attempts: number; status: LiveEventStreamFollowStatus }> {
  const maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY
  const retryDelayMs = options.retryDelayMs ?? 1_000
  let appliedCount = 0
  let attempt = 0
  let status: LiveEventStreamFollowStatus = "connecting"

  while (!options.signal?.aborted && attempt < maxAttempts) {
    attempt++
    status = "connecting"
    options.onStatus?.(status, { attempt })
    try {
      const count = await followLiveCommandCenterEvents(state, createClient(), {
        signal: options.signal,
        probeClient: options.probeClient,
        directory: options.directory,
        probeDelayMs: options.probeDelayMs,
        onBootstrapReload: options.onBootstrapReload,
        onProbeRefresh: options.onProbeRefresh,
        onProbeRefreshError: options.onProbeRefreshError,
        onEvent: (event, applied) => {
          if (applied) {
            status = "connected"
            options.onStatus?.(status, { attempt })
          }
          options.onEvent?.(event, applied)
        },
      })
      appliedCount += count
      if (options.signal?.aborted) break
      if (appliedCount === 0) {
        status = "unavailable"
        options.onStatus?.(status, { attempt })
      }
      return { appliedCount, attempts: attempt, status }
    } catch (error) {
      if (options.signal?.aborted) break
      status = "error"
      options.onStatus?.(status, { attempt, error })
      if (attempt >= maxAttempts) return { appliedCount, attempts: attempt, status }
      await waitForReconnectDelay(retryDelayMs, options.signal)
    }
  }

  return { appliedCount, attempts: attempt, status }
}

function waitForReconnectDelay(delayMs: number, signal?: AbortSignal) {
  if (delayMs <= 0 || signal?.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, delayMs)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout)
        resolve()
      },
      { once: true },
    )
  })
}

function createRuntimeCatalogProbeScheduler(
  state: AppCommandCenterState,
  options: {
    signal?: AbortSignal
    probeClient?: LiveHeadlessClientLike
    directory?: string
    probeDelayMs?: number
    onProbeRefresh?: (catalog: AppRuntimeCatalog, keys: AppRuntimeProbeKey[]) => void
    onProbeRefreshError?: (error: unknown, keys: AppRuntimeProbeKey[]) => void
  },
) {
  const pending = new Set<AppRuntimeProbeKey>()
  const delayMs = options.probeDelayMs ?? 250
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | undefined

  const clearTimer = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = undefined
  }

  const runPending = async () => {
    if (!options.probeClient || options.signal?.aborted || pending.size === 0) return
    const keys = Array.from(pending)
    pending.clear()
    try {
      state.catalog = await refreshLiveRuntimeCatalog(state.catalog, options.probeClient, {
        directory: options.directory,
        keys,
      })
      options.onProbeRefresh?.(state.catalog, keys)
    } catch (error) {
      options.onProbeRefreshError?.(error, keys)
    }
  }

  const start = () => {
    if (inFlight) return
    inFlight = runPending().finally(() => {
      inFlight = undefined
      if (pending.size > 0 && !options.signal?.aborted) start()
    })
  }

  const schedule = (keys: AppRuntimeProbeKey[]) => {
    if (!options.probeClient || options.signal?.aborted || keys.length === 0) return
    for (const key of keys) pending.add(key)
    if (timer || inFlight) return
    timer = setTimeout(() => {
      timer = undefined
      start()
    }, delayMs)
  }

  return {
    schedule,
    async flush() {
      clearTimer()
      if (pending.size > 0) start()
      while (inFlight) await inFlight
    },
  }
}

function runtimeProbeKeysForUnknownEvent(event: unknown): AppRuntimeProbeKey[] {
  if (!event || typeof event !== "object") return []
  const type = (event as Record<string, unknown>)["type"]
  if (
    type !== "mcp.tools.changed" &&
    type !== "lsp.updated" &&
    type !== "code.index.progress" &&
    type !== "code.index.state"
  ) {
    return []
  }
  return runtimeProbeKeysForEvent(event as HeadlessRuntimeStatusEvent)
}

export async function loadLiveSessionEvidence(
  client: Pick<LiveHeadlessClientLike, "sessionEvidence">,
  sessionID: string,
): Promise<AppSessionEvidence> {
  if (!client.sessionEvidence) return emptySessionEvidence(sessionID)
  try {
    return normalizeLiveSessionEvidence(
      await client.sessionEvidence.load(sessionID, { includeBranchRank: true }),
      sessionID,
    )
  } catch (error) {
    return {
      ...emptySessionEvidence(sessionID),
      status: "error",
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}

export async function loadLiveSessionMessages(
  client: Pick<LiveHeadlessClientLike, "client">,
  sessionID: string,
  directory?: string,
): Promise<LiveSessionMessages> {
  if (!client.client.session.messages) return emptyLiveSessionMessages()
  try {
    const response = await client.client.session.messages({ sessionID, directory, limit: LIVE_SESSION_MESSAGE_LIMIT })
    return normalizeLiveSessionMessages(response.data)
  } catch {
    return emptyLiveSessionMessages()
  }
}

export function applyLiveSessionMessages(projection: AppProjectionState, messages: LiveSessionMessages) {
  for (const message of messages.messages) {
    applyHeadlessProjectionEvent(projection, {
      type: "message.updated",
      properties: { info: message },
    })
  }
  for (const parts of Object.values(messages.parts)) {
    for (const part of parts) {
      applyHeadlessProjectionEvent(projection, {
        type: "message.part.updated",
        properties: { part },
      })
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

function emptyLiveSessionMessages(): LiveSessionMessages {
  return { messages: [], parts: {} }
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

export async function loadLiveRuntimeCatalog(
  client: LiveHeadlessClientLike,
  options: Pick<LiveBootstrapOptions, "directory">,
): Promise<AppRuntimeCatalog> {
  const [providers, agents, skills, lsp, debugEngine] = await Promise.all([
    client.client.config?.providers({ directory: options.directory }).catch(() => undefined),
    client.client.agent?.agents({ directory: options.directory }).catch(() => undefined),
    client.client.app?.skills({ directory: options.directory }).catch(() => undefined),
    client.client.lsp?.status({ directory: options.directory }).catch(() => undefined),
    client.client.debugEngine?.pendingPlans({ directory: options.directory }).catch(() => undefined),
  ])
  const [config, mcp] = await Promise.all([
    client.client.config?.get?.({ directory: options.directory }).catch(() => undefined),
    client.client.mcp?.status({ directory: options.directory }).catch(() => undefined),
  ])
  const providerData = providers?.data
  return {
    providers: normalizeProviderStatuses(providerData),
    agents: normalizeAgentOptions(agents?.data),
    skills: normalizeSkillOptions(skills?.data),
    models: normalizeModelOptions(providerData),
    mcp: normalizeMcpStatusSummary(mcp?.data),
    lsp: normalizeLspStatusSummary(lsp?.data),
    codeIndex: normalizeCodeIndexSummary(debugEngine?.data),
    permission: normalizePermissionSummary(config?.data),
  }
}

export async function refreshLiveRuntimeCatalog(
  catalog: AppRuntimeCatalog,
  client: LiveHeadlessClientLike,
  options: Pick<LiveBootstrapOptions, "directory"> & { keys?: AppRuntimeProbeKey[] } = {},
): Promise<AppRuntimeCatalog> {
  const keys =
    options.keys && options.keys.length > 0 ? [...new Set(options.keys)] : (["mcp", "lsp", "debug-engine"] as const)
  const next: AppRuntimeCatalog = {
    ...catalog,
    mcp: { ...catalog.mcp },
    lsp: { ...catalog.lsp },
    codeIndex: { ...catalog.codeIndex },
  }

  await Promise.all(
    keys.map(async (key) => {
      switch (key) {
        case "mcp": {
          const response = await client.client.mcp?.status({ directory: options.directory }).catch(() => undefined)
          if (response) next.mcp = normalizeMcpStatusSummary(response.data)
          return
        }
        case "lsp": {
          const response = await client.client.lsp?.status({ directory: options.directory }).catch(() => undefined)
          if (response) next.lsp = normalizeLspStatusSummary(response.data)
          return
        }
        case "debug-engine": {
          const response = await client.client.debugEngine
            ?.pendingPlans({ directory: options.directory })
            .catch(() => undefined)
          if (response) next.codeIndex = normalizeCodeIndexSummary(response.data)
          return
        }
      }
    }),
  )

  return next
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
  const record = readRecord(value) ?? {}
  const directory = typeof value === "string" ? value : readString(record, "directory")
  if (!directory) return undefined
  const branch = readString(record, "branch")
  return {
    directory,
    name: readString(record, "name") ?? directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory,
    ...(branch ? { branch } : {}),
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
    ...(readString(record, "sessionID") ? { sessionID: readString(record, "sessionID") } : {}),
    ...(readString(record, "sessionTitle") ? { sessionTitle: readString(record, "sessionTitle") } : {}),
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
    lastSessionID: readString(record, "lastSessionID") ?? readString(record, "sessionID"),
    lastDurationMs: readNumber(record, "lastDurationMs") ?? readNumber(record, "durationMs"),
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

export function normalizeSkillOptions(value: unknown): AppSkillOption[] {
  const list = Array.isArray(value)
    ? value
    : (readArrayProperty(value, "skills") ??
      readArrayProperty(value, "items") ??
      readArrayProperty(value, "data") ??
      [])
  return list.map(normalizeSkillOption).filter((skill): skill is AppSkillOption => Boolean(skill))
}

function normalizeSkillOption(value: unknown): AppSkillOption | undefined {
  const record = readRecord(value)
  if (!record) return undefined
  const name = readString(record, "name") ?? readString(record, "id")
  if (!name) return undefined
  const issues = readStringArray(record["standardIssues"]).slice(0, 6)
  const location = readString(record, "location")
  const argumentHint = readString(record, "argumentHint")
  return {
    name,
    description: readString(record, "description"),
    ...(location ? { location } : {}),
    ...(argumentHint ? { argumentHint } : {}),
    ...(readBoolean(record, "builtin") === true ? { builtin: true } : {}),
    status: issues.length > 0 ? "warn" : "ok",
    issues,
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

function normalizeMcpStatusSummary(value: unknown): AppRuntimeCatalog["mcp"] {
  const servers = Object.values(readRecord(value) ?? {})
    .map((server) => {
      const record = readRecord(server)
      return record ? readString(record, "status") : undefined
    })
    .filter((status): status is string => Boolean(status))
  return {
    total: servers.length,
    connected: servers.filter((status) => status === "connected").length,
    disabled: servers.filter((status) => status === "disabled").length,
    failed: servers.filter((status) => status === "failed").length,
    needsAuth: servers.filter((status) => status === "needs_auth" || status === "needs_client_registration").length,
    needsTrust: servers.filter((status) => status === "needs_trust").length,
  }
}

export function normalizeLspStatusSummary(value: unknown): AppRuntimeCatalog["lsp"] {
  const servers = (
    Array.isArray(value) ? value : (readArrayProperty(value, "data") ?? readArrayProperty(value, "items") ?? [])
  )
    .map((server) => {
      const record = readRecord(server)
      return record ? readString(record, "status") : undefined
    })
    .filter((status): status is string => Boolean(status))
  return {
    total: servers.length,
    connected: servers.filter((status) => status === "connected").length,
    error: servers.filter((status) => status === "error").length,
  }
}

export function normalizeCodeIndexSummary(value: unknown): AppRuntimeCatalog["codeIndex"] {
  const record = readRecord(value) ?? {}
  const graph = readRecord(record["graph"]) ?? {}
  const state = readString(graph, "state")
  const lastIndexedAt = readNumber(graph, "lastIndexedAt")
  const error = readString(graph, "error")
  return {
    pendingPlans: readNumber(record, "count") ?? 0,
    toolCount: readNumber(record, "toolCount") ?? 0,
    nodeCount: readNumber(graph, "nodeCount") ?? 0,
    edgeCount: readNumber(graph, "edgeCount") ?? 0,
    state: state === "idle" || state === "indexing" || state === "failed" ? state : "unknown",
    completed: readNumber(graph, "completed") ?? 0,
    total: readNumber(graph, "total") ?? 0,
    ...(lastIndexedAt == null ? {} : { lastIndexedAt }),
    ...(error ? { error } : {}),
  }
}

function normalizePermissionSummary(value: unknown): AppRuntimeCatalog["permission"] {
  const config = readRecord(value)
  const permission = readRecord(config?.["permission"]) ?? {}
  const actions = flattenPermissionActions(permission)
  const experimental = readRecord(config?.["experimental"])
  return {
    totalRules: actions.length,
    allow: actions.filter((action) => action === "allow").length,
    ask: actions.filter((action) => action === "ask").length,
    deny: actions.filter((action) => action === "deny").length,
    strictUnknown: readBoolean(experimental, "autonomous_strict_permission"),
  }
}

function flattenPermissionActions(value: Record<string, unknown>): string[] {
  const actions: string[] = []
  for (const item of Object.values(value)) {
    if (typeof item === "string") {
      actions.push(item)
      continue
    }
    const nested = readRecord(item)
    if (nested) actions.push(...flattenPermissionActions(nested))
  }
  return actions
}

function normalizeProviderStatus(value: unknown, root?: Record<string, unknown>): AppProviderStatus | undefined {
  const provider = readRecord(value)
  if (!provider) return undefined
  const id = readString(provider, "id") ?? readString(provider, "providerID") ?? readString(provider, "name")
  if (!id) return undefined
  const models = readModelArray(provider["models"])
  const defaultValue = readRecord(root?.["default"])?.[id]
  const defaultModelID = typeof defaultValue === "string" ? defaultValue : undefined
  const reason =
    readString(provider, "reason") ??
    readString(provider, "error") ??
    readString(provider, "message") ??
    (models.length === 0 ? "No models returned by backend" : undefined)
  return {
    id,
    label: readString(provider, "name") ?? readString(provider, "label") ?? id,
    source: readString(provider, "source"),
    modelCount: models.length,
    ...(defaultModelID ? { defaultModelID } : {}),
    status: models.length > 0 ? "available" : "no_models",
    ...(reason ? { reason } : {}),
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
  const time = readRecord(record.time)
  const startedAt = time ? readTime(time, "started") : undefined
  const completedAt = time ? readTime(time, "completed") : undefined
  return {
    id,
    project:
      readString(record, "projectID") ?? readString(record, "project") ?? readString(record, "directory") ?? "project",
    directory: readString(record, "directory"),
    worktree: readString(record, "worktree"),
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
    error: readString(record, "error"),
    createdAt: time ? (readTime(time, "created") ?? Date.now()) : Date.now(),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
  }
}

export function normalizeLiveSessionEvidence(value: unknown, fallbackSessionID: string): AppSessionEvidence {
  if (!value || typeof value !== "object") return emptySessionEvidence(fallbackSessionID)
  const record = value as Partial<HeadlessSessionEvidence> & Record<string, unknown>
  const sessionID = readString(record, "sessionID") ?? fallbackSessionID
  const riskRecord = readRecord(record["risk"])
  const dreRecord = readRecord(record["dre"])
  const branchRankRecord = readRecord(record["branchRank"]) ?? readRecord(record["branch_rank"])
  const semanticRecord = readRecord(record["semantic"]) ?? readRecord(riskRecord?.["semantic"])
  const rollback = Array.isArray(record["rollback"]) ? record["rollback"] : []

  return {
    sessionID,
    status: "ready",
    risk: riskRecord ? normalizeRiskEvidence(riskRecord) : undefined,
    semantic: semanticRecord ? normalizeSemanticEvidence(semanticRecord) : undefined,
    dre: dreRecord ? normalizeDreEvidence(dreRecord) : undefined,
    branchRank: branchRankRecord ? normalizeBranchRankEvidence(branchRankRecord) : undefined,
    rollbackPoints: rollback.map(normalizeRollbackPoint).filter((point): point is AppRollbackPoint => Boolean(point)),
    artifactCounts: {
      findings: readArrayLength(riskRecord?.["findings"]),
      verificationEnvelopes: readArrayLength(riskRecord?.["envelopes"]),
      reviewResults: readArrayLength(riskRecord?.["reviewResults"]),
      debugCases: readArrayLength(readRecord(riskRecord?.["debug"])?.["cases"]),
      decisionHints: countDecisionHints(riskRecord?.["decisionHints"]),
    },
    artifactPreviews: {
      findings: normalizeArtifactPreviewList(riskRecord?.["findings"], "finding"),
      verificationEnvelopes: normalizeArtifactPreviewList(riskRecord?.["envelopes"], "verification"),
      reviewResults: normalizeArtifactPreviewList(riskRecord?.["reviewResults"], "review"),
      debugCases: normalizeArtifactPreviewList(readRecord(riskRecord?.["debug"])?.["cases"], "debug"),
      decisionHints: normalizeDecisionHintPreviews(riskRecord?.["decisionHints"]),
    },
    errors: Array.isArray(record["errors"])
      ? record["errors"].map(readEvidenceError).filter((error): error is string => Boolean(error))
      : [],
  }
}

function normalizeLiveSessionMessages(value: unknown): LiveSessionMessages {
  const list = Array.isArray(value)
    ? value
    : (readArrayProperty(value, "items") ?? readArrayProperty(value, "messages") ?? [])
  const result = emptyLiveSessionMessages()
  for (const item of list) {
    const normalized = normalizeLiveSessionMessageItem(item)
    if (!normalized) continue
    result.messages.push(normalized.message)
    result.parts[normalized.message.id] = normalized.parts
  }
  return result
}

function normalizeLiveSessionMessageItem(
  value: unknown,
): { message: AppProjectionState["message"][string][number]; parts: AppProjectionState["part"][string] } | undefined {
  const record = readRecord(value)
  if (!record) return undefined
  const info = readRecord(record["info"]) ?? record
  const message = normalizeLiveMessage(info)
  if (!message) return undefined
  const parts =
    readArrayProperty(record, "parts")
      ?.map((part) => normalizeLivePart(part, message.id))
      .filter((part): part is AppProjectionState["part"][string][number] => Boolean(part)) ?? []
  return { message, parts }
}

function normalizeLiveMessage(
  value: Record<string, unknown>,
): AppProjectionState["message"][string][number] | undefined {
  const id = readString(value, "id") ?? readString(value, "messageID")
  const sessionID = readString(value, "sessionID")
  const role = readString(value, "role")
  if (!id || !sessionID || (role !== "user" && role !== "assistant")) return undefined
  const time = readRecord(value["time"])
  return {
    id,
    sessionID,
    role,
    createdAt: (time ? readTime(time, "created") : undefined) ?? readTime(value, "createdAt") ?? Date.now(),
  }
}

function normalizeLivePart(
  value: unknown,
  fallbackMessageID: string,
): AppProjectionState["part"][string][number] | undefined {
  const record = readRecord(value)
  if (!record) return undefined
  const id = readString(record, "id") ?? readString(record, "partID")
  const messageID = readString(record, "messageID") ?? fallbackMessageID
  const type = readString(record, "type")
  if (!id || !messageID) return undefined
  if (type === "text" || type === "reasoning") {
    return {
      id,
      messageID,
      type,
      text: readString(record, "text") ?? readString(record, "content"),
    }
  }
  if (type === "tool") {
    const state = readRecord(record["state"])
    return {
      id,
      messageID,
      type: "tool",
      toolName: readString(record, "tool") ?? readString(record, "toolName"),
      text:
        readString(state ?? {}, "title") ??
        readString(state ?? {}, "output") ??
        readString(state ?? {}, "error") ??
        readString(record, "text"),
    }
  }
  return undefined
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
    artifactPreviews: emptyArtifactPreviews(),
    errors: [],
  }
}

function emptyArtifactPreviews(): AppSessionEvidence["artifactPreviews"] {
  return {
    findings: [],
    verificationEnvelopes: [],
    reviewResults: [],
    debugCases: [],
    decisionHints: [],
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

function normalizeBranchRankEvidence(record: Record<string, unknown>): AppBranchRankEvidence | undefined {
  const items = (Array.isArray(record["items"]) ? record["items"] : [])
    .map(normalizeBranchRankItem)
    .filter((item): item is AppBranchRankEvidence["items"][number] => Boolean(item))
  const recommended = readRecord(record["recommended"]) ?? {}
  const recommendedID = readString(record, "recommendedID") ?? readString(recommended, "id")
  if (items.length === 0 && !recommendedID) return undefined
  return {
    currentID: readString(record, "currentID"),
    recommendedID,
    recommendedTitle:
      readString(recommended, "title") ?? items.find((item) => item.id === recommendedID)?.title ?? recommendedID,
    confidence: readNumber(record, "confidence"),
    reasons: readStringArray(record["reasons"]).slice(0, 6),
    items,
  }
}

function normalizeBranchRankItem(value: unknown): AppBranchRankEvidence["items"][number] | undefined {
  const record = readRecord(value)
  if (!record) return undefined
  const id = readString(record, "id")
  const title = readString(record, "title")
  if (!id || !title) return undefined
  const risk = readRecord(record["risk"]) ?? {}
  const decision = readRecord(record["decision"]) ?? {}
  return {
    id,
    title,
    current: readBoolean(record, "current") ?? false,
    recommended: readBoolean(record, "recommended") ?? false,
    headline: readString(record, "headline"),
    riskLevel: readString(risk, "level"),
    riskScore: readNumber(risk, "score"),
    decisionScore: readNumber(decision, "total"),
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

function normalizeArtifactPreviewList(value: unknown, fallbackKind: string): AppArtifactPreview[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => normalizeArtifactPreview(item, fallbackKind, index))
    .filter((item): item is AppArtifactPreview => Boolean(item))
    .slice(0, 5)
}

function normalizeArtifactPreview(value: unknown, fallbackKind: string, index: number): AppArtifactPreview | undefined {
  if (typeof value === "string") return { title: value }
  const record = readRecord(value)
  if (!record) return undefined
  const id =
    readString(record, "id") ??
    readString(record, "findingId") ??
    readString(record, "findingID") ??
    readString(record, "envelopeId") ??
    readString(record, "envelopeID") ??
    readString(record, "reviewId") ??
    readString(record, "reviewID") ??
    readString(record, "caseId") ??
    readString(record, "caseID")
  const title =
    readString(record, "title") ??
    readString(record, "summary") ??
    readString(record, "message") ??
    readString(record, "command") ??
    readString(record, "workflow") ??
    id ??
    `${fallbackKind} ${index + 1}`
  const status =
    readString(record, "status") ??
    readString(record, "severity") ??
    readString(record, "classification") ??
    readString(record, "outcome") ??
    readString(record, "decision")
  const detail =
    readString(record, "file") ??
    readString(record, "path") ??
    readString(record, "body") ??
    readString(record, "detail") ??
    readString(record, "description")
  return {
    ...(id ? { id } : {}),
    title,
    ...(status ? { status } : {}),
    ...(detail ? { detail } : {}),
  }
}

function normalizeDecisionHintPreviews(value: unknown): AppArtifactPreview[] {
  const record = readRecord(value)
  if (!record) return []
  for (const key of ["hints", "items", "decisions"]) {
    const previews = normalizeArtifactPreviewList(record[key], "decision hint")
    if (previews.length > 0) return previews
  }
  const count = readNumber(record, "count") ?? 0
  return count > 0 ? [{ title: `${count} decision hints recorded` }] : []
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

function readBoolean(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key]
  return typeof value === "boolean" ? value : undefined
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
