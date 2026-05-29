import type { createCommandCenterViewModel } from "../projection/view-model"
import type { AxCodeAppRuntimeConfig } from "./config"

export type AppEventStreamDiagnostics = {
  status: "fixture" | "connecting" | "connected" | "unavailable" | "error"
  appliedEvents: number
  lastEventAt?: number
  error?: string
}

export type AppDesktopDiagnostics = {
  available: boolean
  backend?: {
    status?: string
    mode?: string
    url?: string
    loopbackOnly?: boolean
    generatedAuth?: boolean
    logLines?: number
    error?: string
  }
  capabilities?: {
    platform?: string
    arch?: string
    desktopBridge?: boolean
    security?: {
      contentOrigin?: string
      contextIsolation?: boolean
      nodeIntegration?: boolean
      sandbox?: boolean
    }
    release?: {
      status?: string
      updatePolicy?: string
      productName?: string
      version?: string
      packageTarget?: string
      signed?: boolean
      notarized?: boolean
      updaterConfigured?: boolean
      gates?: Record<string, { configured?: boolean; status?: string; reason?: string }>
    }
  }
  errors: string[]
}

export type AppDiagnosticsReport = {
  runtime: {
    mode: AxCodeAppRuntimeConfig["mode"]
    backendUrl?: string
    directory?: string
    authMode: "none" | "configured"
    scheduledTaskOwner?: string
    scheduledTasksStopOnQuit?: boolean
  }
  eventStream: AppEventStreamDiagnostics
  queue: {
    total: number
    running: number
    blocked: number
    queued: number
    failedVisible: number
    hidden: number
    health: "empty" | "active" | "blocked" | "degraded" | "idle"
  }
  renderer: {
    name: "@ax-code/app"
    version: string
    selectedSessionID?: string
    visibleMessages: number
    hiddenMessages: number
    worktrees: number
    terminals: number
    scheduledTasks: number
    evidenceStatus?: string
  }
  desktop: AppDesktopDiagnostics
  security: {
    contentOrigin: string
    bridgeAvailable: boolean
    contextIsolation?: boolean
    nodeIntegration?: boolean
    sandbox?: boolean
    previewBridgeProfile: "separate-origin"
  }
}

export type AppDiagnosticsBridge = {
  invoke(name: "diagnostics.read", payload: Record<string, never>): Promise<unknown>
  invoke(name: "diagnostics.exportLogs", payload: { includeBackendLogs?: boolean }): Promise<unknown>
  invoke(name: "platform.capabilities", payload: Record<string, never>): Promise<unknown>
}

type CommandCenterView = ReturnType<typeof createCommandCenterViewModel>

export function createAppDiagnosticsReport(input: {
  config: AxCodeAppRuntimeConfig
  view: CommandCenterView
  eventStream: AppEventStreamDiagnostics
  desktop?: AppDesktopDiagnostics
}): AppDiagnosticsReport {
  const desktop = input.desktop ?? unavailableDesktopDiagnostics()
  const runtime = runtimeDiagnostics(input.config)
  const queue = queueDiagnostics(input.view)
  const renderer = rendererDiagnostics(input.view)
  const security = securityDiagnostics(desktop)
  return {
    runtime,
    eventStream: input.eventStream,
    queue,
    renderer,
    desktop,
    security,
  }
}

export async function readDesktopDiagnostics(
  bridge: AppDiagnosticsBridge | undefined = globalThis.window?.axCodeDesktop,
): Promise<AppDesktopDiagnostics> {
  if (!bridge) return unavailableDesktopDiagnostics()

  const [diagnosticsResult, capabilitiesResult] = await Promise.allSettled([
    bridge.invoke("diagnostics.read", {}),
    bridge.invoke("platform.capabilities", {}),
  ])
  return {
    available: true,
    backend:
      diagnosticsResult.status === "fulfilled"
        ? normalizeDesktopBackendDiagnostics(diagnosticsResult.value)
        : undefined,
    capabilities:
      capabilitiesResult.status === "fulfilled" ? normalizeDesktopCapabilities(capabilitiesResult.value) : undefined,
    errors: [settledError(diagnosticsResult), settledError(capabilitiesResult)].filter((item): item is string =>
      Boolean(item),
    ),
  }
}

export async function exportDesktopLogs(
  bridge: AppDiagnosticsBridge | undefined = globalThis.window?.axCodeDesktop,
  includeBackendLogs = true,
) {
  if (!bridge) {
    return {
      available: false,
      text: "",
      length: 0,
    }
  }
  const value = await bridge.invoke("diagnostics.exportLogs", { includeBackendLogs })
  const text = readString(readRecord(value), "text") ?? ""
  return {
    available: true,
    text,
    length: text.length,
  }
}

function runtimeDiagnostics(config: AxCodeAppRuntimeConfig): AppDiagnosticsReport["runtime"] {
  if (config.mode === "fixture") {
    return {
      mode: "fixture",
      authMode: "none",
    }
  }
  return {
    mode: "live",
    backendUrl: config.baseUrl,
    directory: config.directory,
    authMode: hasAuthorizationHeader(config.headers) ? "configured" : "none",
    scheduledTaskOwner: config.scheduledTaskExecution?.owner,
    scheduledTasksStopOnQuit: config.scheduledTaskExecution?.stopsOnAppQuit,
  }
}

function queueDiagnostics(view: CommandCenterView): AppDiagnosticsReport["queue"] {
  const failedVisible = view.queue.filter((item) => item.status === "failed" || item.status === "cancelled").length
  return {
    total: view.queueSummary.total,
    running: view.queueSummary.running,
    blocked: view.queueSummary.blocked,
    queued: view.queueSummary.queued,
    failedVisible,
    hidden: view.queueHiddenCount,
    health: queueHealth({
      total: view.queueSummary.total,
      running: view.queueSummary.running,
      blocked: view.queueSummary.blocked,
      queued: view.queueSummary.queued,
      failedVisible,
    }),
  }
}

function rendererDiagnostics(view: CommandCenterView): AppDiagnosticsReport["renderer"] {
  return {
    name: "@ax-code/app",
    version: "0.0.0",
    selectedSessionID: view.selectedSession?.id,
    visibleMessages: view.messages.length,
    hiddenMessages: view.messageHiddenCount,
    worktrees: view.worktrees.length,
    terminals: view.terminals.length,
    scheduledTasks: view.scheduledTasks.length,
    evidenceStatus: view.evidence?.status,
  }
}

function securityDiagnostics(desktop: AppDesktopDiagnostics): AppDiagnosticsReport["security"] {
  return {
    contentOrigin: desktop.capabilities?.security?.contentOrigin ?? "fixture",
    bridgeAvailable: desktop.available,
    contextIsolation: desktop.capabilities?.security?.contextIsolation,
    nodeIntegration: desktop.capabilities?.security?.nodeIntegration,
    sandbox: desktop.capabilities?.security?.sandbox,
    previewBridgeProfile: "separate-origin",
  }
}

function queueHealth(input: {
  total: number
  running: number
  blocked: number
  queued: number
  failedVisible: number
}): AppDiagnosticsReport["queue"]["health"] {
  if (input.failedVisible > 0) return "degraded"
  if (input.blocked > 0) return "blocked"
  if (input.running > 0 || input.queued > 0) return "active"
  if (input.total > 0) return "idle"
  return "empty"
}

function normalizeDesktopBackendDiagnostics(value: unknown): NonNullable<AppDesktopDiagnostics["backend"]> {
  const record = readRecord(value)
  return {
    status: readString(record, "status"),
    mode: readString(record, "mode"),
    url: readString(record, "url"),
    loopbackOnly: readBoolean(record, "loopbackOnly"),
    generatedAuth: readBoolean(record, "generatedAuth"),
    logLines: readArray(record, "logs")?.length,
    error: readString(record, "error"),
  }
}

function normalizeDesktopCapabilities(value: unknown): NonNullable<AppDesktopDiagnostics["capabilities"]> {
  const record = readRecord(value)
  const security = readRecord(record["security"])
  const release = readRecord(record["release"])
  return {
    platform: readString(record, "platform"),
    arch: readString(record, "arch"),
    desktopBridge: readBoolean(record, "desktopBridge"),
    security: security
      ? {
          contentOrigin: readString(security, "contentOrigin"),
          contextIsolation: readBoolean(security, "contextIsolation"),
          nodeIntegration: readBoolean(security, "nodeIntegration"),
          sandbox: readBoolean(security, "sandbox"),
        }
      : undefined,
    release: release
      ? {
          status: readString(release, "status"),
          updatePolicy: readString(release, "updatePolicy"),
          productName: readString(release, "productName"),
          version: readString(release, "version"),
          packageTarget: readString(release, "packageTarget"),
          signed: readBoolean(release, "signed"),
          notarized: readBoolean(release, "notarized"),
          updaterConfigured: readBoolean(release, "updaterConfigured"),
          gates: normalizeReleaseGates(release["gates"]),
        }
      : undefined,
  }
}

function normalizeReleaseGates(value: unknown) {
  const gates = readRecord(value)
  const result: Record<string, { configured?: boolean; status?: string; reason?: string }> = {}
  for (const [name, gate] of Object.entries(gates)) {
    const record = readRecord(gate)
    result[name] = {
      configured: readBoolean(record, "configured"),
      status: readString(record, "status"),
      reason: readString(record, "reason"),
    }
  }
  return result
}

function unavailableDesktopDiagnostics(): AppDesktopDiagnostics {
  return {
    available: false,
    errors: [],
  }
}

function hasAuthorizationHeader(headers: Record<string, string> | undefined) {
  if (!headers) return false
  return Object.keys(headers).some((key) => key.toLowerCase() === "authorization")
}

function settledError(result: PromiseSettledResult<unknown>) {
  if (result.status === "fulfilled") return undefined
  return result.reason instanceof Error ? result.reason.message : String(result.reason)
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function readBoolean(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "boolean" ? value : undefined
}

function readArray(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return Array.isArray(value) ? value : undefined
}
