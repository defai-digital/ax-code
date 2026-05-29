import { startHeadlessBackend, type HeadlessBackendHandle } from "@ax-code/sdk/headless"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { createCommandCenterViewModel } from "../projection/view-model"
import {
  applyLiveSessionMessages,
  bootstrapLiveCommandCenterState,
  createLiveHeadlessClient,
  followLiveCommandCenterEventsWithReconnect,
  loadLiveSessionMessages,
  type LiveHeadlessClientLike,
  type LiveSessionMessages,
} from "../runtime/live"

export type LiveBackendQaMode = "start" | "attach"

export type LiveBackendQaOptions = {
  mode: LiveBackendQaMode
  directory?: string
  attachFromDirectory?: string
  baseUrl?: string
  authHeader?: string
  eventWindowMs?: number
  sessionLimit?: number
  representative?: boolean | LiveBackendQaRepresentativeRequirements
  fetch?: typeof fetch
  client?: LiveHeadlessClientLike
  startBackend?: typeof startHeadlessBackend
}

export type LiveBackendQaRepresentativeRequirements = {
  minSessions?: number
  minQueueItems?: number
  minVisibleMessages?: number
  minHiddenMessages?: number
  minAppliedEvents?: number
  minScheduledTasks?: number
}

export type LiveBackendQaRepresentativeCheck = {
  actual: number
  minimum: number
  passed: boolean
}

export type LiveBackendQaResult = {
  mode: LiveBackendQaMode
  baseUrl: string
  directory?: string
  startedSidecar: boolean
  attachHarnessStartedSidecar?: boolean
  bootstrap: {
    sessions: number
    queueItems: number
    visibleMessages: number
    hiddenMessages: number
    visibleQueueItems: number
    hiddenQueueItems: number
    scheduledTasks: number
  }
  eventStream: {
    attempts: number
    appliedEvents: number
    statuses: string[]
    windowMs: number
  }
  representative: {
    required: boolean
    passed: boolean
    checks: {
      sessions: LiveBackendQaRepresentativeCheck
      queueItems: LiveBackendQaRepresentativeCheck
      visibleMessages: LiveBackendQaRepresentativeCheck
      hiddenMessages: LiveBackendQaRepresentativeCheck
      appliedEvents: LiveBackendQaRepresentativeCheck
      scheduledTasks: LiveBackendQaRepresentativeCheck
    }
  }
  diagnostics: {
    connected: boolean
    streamObserved: boolean
    withinRendererWindows: boolean
  }
  withinBudget: boolean
}

const DEFAULT_EVENT_WINDOW_MS = 2_000
const DEFAULT_SESSION_LIMIT = 50

export async function runLiveBackendQa(options: LiveBackendQaOptions): Promise<LiveBackendQaResult> {
  const eventWindowMs = Math.max(100, options.eventWindowMs ?? DEFAULT_EVENT_WINDOW_MS)
  const sessionLimit = options.sessionLimit ?? DEFAULT_SESSION_LIMIT
  const representativeRequirements = normalizeRepresentativeRequirements(options.representative)
  const backend = await resolveBackend(options)
  const headers = backend.headers
  if (!options.client && options.mode === "attach") {
    await assertBackendHealth({ baseUrl: backend.url, headers, fetch: options.fetch ?? fetch })
  }
  const config = {
    mode: "live" as const,
    baseUrl: backend.url,
    headers,
    directory: options.directory,
    sessionLimit,
  }
  const createClient = () => options.client ?? createLiveHeadlessClient(config)
  const statuses: string[] = []

  try {
    const state = await bootstrapLiveCommandCenterState({
      ...config,
      client: options.client ?? createLiveHeadlessClient(config),
    })
    await hydrateRepresentativeSessionMessages({
      state,
      client: createClient(),
      directory: config.directory,
      minVisibleMessages: representativeRequirements?.minVisibleMessages ?? 0,
    })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), eventWindowMs)
    const streamResult = await followLiveCommandCenterEventsWithReconnect(state, createClient, {
      signal: controller.signal,
      maxAttempts: 2,
      retryDelayMs: 250,
      onStatus: (status) => statuses.push(status),
    }).finally(() => clearTimeout(timer))
    const view = createCommandCenterViewModel(state)
    const withinRendererWindows = view.messages.length <= 200 && view.queue.length <= 200
    const representative = createRepresentativeResult(representativeRequirements, {
      sessions: view.sessions.length,
      queueItems: view.queueSummary.total,
      visibleMessages: view.messages.length,
      hiddenMessages: view.messageHiddenCount,
      appliedEvents: streamResult.appliedCount,
      scheduledTasks: view.scheduledTasks.length,
    })

    return {
      mode: options.mode,
      baseUrl: backend.url,
      directory: options.directory ?? options.attachFromDirectory,
      startedSidecar: backend.startedSidecar,
      attachHarnessStartedSidecar: backend.attachHarnessStartedSidecar,
      bootstrap: {
        sessions: view.sessions.length,
        queueItems: view.queueSummary.total,
        visibleMessages: view.messages.length,
        hiddenMessages: view.messageHiddenCount,
        visibleQueueItems: view.queue.length,
        hiddenQueueItems: view.queueHiddenCount,
        scheduledTasks: view.scheduledTasks.length,
      },
      eventStream: {
        attempts: streamResult.attempts,
        appliedEvents: streamResult.appliedCount,
        statuses,
        windowMs: eventWindowMs,
      },
      representative,
      diagnostics: {
        connected: true,
        streamObserved: statuses.includes("connected") || streamResult.appliedCount > 0,
        withinRendererWindows,
      },
      withinBudget: withinRendererWindows && representative.passed,
    }
  } finally {
    await backend.close?.()
  }
}

async function hydrateRepresentativeSessionMessages(input: {
  state: Awaited<ReturnType<typeof bootstrapLiveCommandCenterState>>
  client: LiveHeadlessClientLike
  directory?: string
  minVisibleMessages: number
}) {
  if (input.minVisibleMessages <= 0) return
  let best:
    | {
        sessionID: string
        messages: LiveSessionMessages
      }
    | undefined

  for (const session of input.state.projection.session) {
    const messages = await loadLiveSessionMessages(input.client, session.id, input.directory)
    const count = messages.messages.length
    if (count > (best?.messages.messages.length ?? -1)) best = { sessionID: session.id, messages }
    if (count >= input.minVisibleMessages) break
  }

  if (!best || best.messages.messages.length === 0) return
  const currentCount = input.state.projection.message[input.state.selectedSessionID]?.length ?? 0
  if (currentCount >= best.messages.messages.length) return
  applyLiveSessionMessages(input.state.projection, best.messages)
  input.state.selectedSessionID = best.sessionID
}

function normalizeRepresentativeRequirements(
  value: LiveBackendQaOptions["representative"],
): Required<LiveBackendQaRepresentativeRequirements> | undefined {
  if (!value) return undefined
  const defaults =
    value === true
      ? {
          minSessions: 1,
          minQueueItems: 0,
          minVisibleMessages: 50,
          minHiddenMessages: 0,
          minAppliedEvents: 1,
          minScheduledTasks: 0,
        }
      : value
  return {
    minSessions: normalizeMinimum(defaults.minSessions, 0),
    minQueueItems: normalizeMinimum(defaults.minQueueItems, 0),
    minVisibleMessages: normalizeMinimum(defaults.minVisibleMessages, 0),
    minHiddenMessages: normalizeMinimum(defaults.minHiddenMessages, 0),
    minAppliedEvents: normalizeMinimum(defaults.minAppliedEvents, 0),
    minScheduledTasks: normalizeMinimum(defaults.minScheduledTasks, 0),
  }
}

function normalizeMinimum(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback
}

function createRepresentativeResult(
  requirements: Required<LiveBackendQaRepresentativeRequirements> | undefined,
  actual: {
    sessions: number
    queueItems: number
    visibleMessages: number
    hiddenMessages: number
    appliedEvents: number
    scheduledTasks: number
  },
): LiveBackendQaResult["representative"] {
  const minimums = requirements ?? {
    minSessions: 0,
    minQueueItems: 0,
    minVisibleMessages: 0,
    minHiddenMessages: 0,
    minAppliedEvents: 0,
    minScheduledTasks: 0,
  }
  const checks = {
    sessions: representativeCheck(actual.sessions, minimums.minSessions),
    queueItems: representativeCheck(actual.queueItems, minimums.minQueueItems),
    visibleMessages: representativeCheck(actual.visibleMessages, minimums.minVisibleMessages),
    hiddenMessages: representativeCheck(actual.hiddenMessages, minimums.minHiddenMessages),
    appliedEvents: representativeCheck(actual.appliedEvents, minimums.minAppliedEvents),
    scheduledTasks: representativeCheck(actual.scheduledTasks, minimums.minScheduledTasks),
  }
  return {
    required: Boolean(requirements),
    passed: Object.values(checks).every((check) => check.passed),
    checks,
  }
}

function representativeCheck(actual: number, minimum: number): LiveBackendQaRepresentativeCheck {
  return {
    actual,
    minimum,
    passed: actual >= minimum,
  }
}

async function resolveBackend(options: LiveBackendQaOptions): Promise<{
  url: string
  headers: Record<string, string>
  startedSidecar: boolean
  attachHarnessStartedSidecar?: boolean
  close?: () => Promise<void>
}> {
  if (options.mode === "attach") {
    if (options.attachFromDirectory) {
      const backend: HeadlessBackendHandle = await (options.startBackend ?? startHeadlessBackend)({
        directory: options.attachFromDirectory,
        hostname: "127.0.0.1",
      })
      return {
        url: backend.url,
        headers: backend.headers,
        startedSidecar: false,
        attachHarnessStartedSidecar: true,
        close: backend.close,
      }
    }
    if (!options.baseUrl)
      throw new Error("Live backend QA attach mode requires --attach-url or --attach-from-directory")
    return {
      url: options.baseUrl.replace(/\/$/, ""),
      headers: options.authHeader ? { authorization: options.authHeader } : {},
      startedSidecar: false,
    }
  }

  if (!options.directory) throw new Error("Live backend QA start mode requires --directory")
  const backend: HeadlessBackendHandle = await (options.startBackend ?? startHeadlessBackend)({
    directory: options.directory,
    hostname: "127.0.0.1",
  })
  return {
    url: backend.url,
    headers: backend.headers,
    startedSidecar: true,
    close: backend.close,
  }
}

async function assertBackendHealth(input: { baseUrl: string; headers: Record<string, string>; fetch: typeof fetch }) {
  let response: Response
  try {
    response = await input.fetch(new URL("/global/health", input.baseUrl), {
      method: "GET",
      headers: input.headers,
    })
  } catch (cause) {
    const detail = cause instanceof Error ? ` Cause: ${cause.message}` : ""
    throw new Error(
      `Live backend QA could not reach ${input.baseUrl}. Start a loopback AX Code backend first, pass a reachable --attach-url, or use --directory to start a sidecar.${detail}`,
      { cause },
    )
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Live backend QA health check failed (${response.status}): ${text || response.statusText}`)
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      directory: { type: "string" },
      "attach-url": { type: "string" },
      "attach-from-directory": { type: "string" },
      "auth-header": { type: "string" },
      "event-window-ms": { type: "string" },
      "session-limit": { type: "string" },
      representative: { type: "boolean", default: false },
      "min-sessions": { type: "string" },
      "min-queue-items": { type: "string" },
      "min-visible-messages": { type: "string" },
      "min-hidden-messages": { type: "string" },
      "min-applied-events": { type: "string" },
      "min-scheduled-tasks": { type: "string" },
      output: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  })
  try {
    const result = await runLiveBackendQa({
      mode: values["attach-url"] || values["attach-from-directory"] ? "attach" : "start",
      directory: values.directory ?? values["attach-from-directory"],
      attachFromDirectory: values["attach-from-directory"],
      baseUrl: values["attach-url"],
      authHeader: values["auth-header"],
      eventWindowMs: values["event-window-ms"] ? Number(values["event-window-ms"]) : undefined,
      sessionLimit: values["session-limit"] ? Number(values["session-limit"]) : undefined,
      representative: representativeCliRequirements(values),
    })
    const json = JSON.stringify(result, null, 2)
    if (values.output) {
      await mkdir(path.dirname(values.output), { recursive: true })
      await writeFile(values.output, `${json}\n`)
    }
    console.log(json)
    if (!result.withinBudget) {
      console.error("Live backend QA failed")
      process.exitCode = 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

function representativeCliRequirements(values: Record<string, string | boolean | undefined>) {
  const explicit = values.representative === true
  const requirements: LiveBackendQaRepresentativeRequirements = {
    minSessions: numberCliValue(values["min-sessions"]),
    minQueueItems: numberCliValue(values["min-queue-items"]),
    minVisibleMessages: numberCliValue(values["min-visible-messages"]),
    minHiddenMessages: numberCliValue(values["min-hidden-messages"]),
    minAppliedEvents: numberCliValue(values["min-applied-events"]),
    minScheduledTasks: numberCliValue(values["min-scheduled-tasks"]),
  }
  const hasThreshold = Object.values(requirements).some((value) => value !== undefined)
  if (!explicit && !hasThreshold) return undefined
  return explicit && !hasThreshold ? true : requirements
}

function numberCliValue(value: unknown) {
  return typeof value === "string" ? Number(value) : undefined
}
