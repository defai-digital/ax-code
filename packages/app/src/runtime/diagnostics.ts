import type { createCommandCenterViewModel } from "../projection/view-model"
import type { AxCodeAppRuntimeConfig } from "./config"
import { isAppFeatureEnabled, runtimeNetworkScope, type AxCodeRuntimeNetworkScope } from "./config"

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
    app?: {
      name?: string
      version?: string
    }
    renderer?: {
      name?: string
      version?: string
    }
    platform?: string
    arch?: string
    desktopBridge?: boolean
    security?: {
      contentOrigin?: string
      contextIsolation?: boolean
      nodeIntegration?: boolean
      sandbox?: boolean
    }
    capabilityProfiles?: AppCapabilityProfile[]
    release?: {
      status?: string
      updatePolicy?: string
      productName?: string
      version?: string
      packageTarget?: string
      signed?: boolean
      notarized?: boolean
      updaterConfigured?: boolean
      updateFeed?: {
        url?: string
        artifactName?: string
        sha256?: string
        sizeBytes?: number
      }
      gates?: Record<string, { configured?: boolean; status?: string; reason?: string }>
    }
    update?: {
      status?: "disabled" | "current" | "available" | "downloaded" | "opened" | "error" | "unavailable" | string
      currentVersion?: string
      latestVersion?: string
      artifactUrl?: string
      artifactPath?: string
      sha256?: string
      sizeBytes?: number
      reason?: string
    }
  }
  releaseReadiness?: AppDesktopReleaseReadiness
  errors: string[]
}

export type AppCapabilityProfile = {
  id?: string
  label?: string
  status?: string
  origin?: string
  bridge?: string
  commands: string[]
  localResources?: string
  network?: string
  gate?: string
  threatModel?: string
  securityReviews?: string[]
}

export type AppDesktopReleaseReadiness = {
  status: "unknown" | "internal-beta" | "release-ready" | "blocked"
  summary: string
  blockedGates: Array<{ name: string; reason?: string }>
  passedGates: string[]
}

export type AppDiagnosticsReport = {
  runtime: {
    mode: AxCodeAppRuntimeConfig["mode"]
    backendUrl?: string
    directory?: string
    authMode: "none" | "configured"
    networkScope: AxCodeRuntimeNetworkScope
    networkWarning?: string
    features: {
      terminalPane: boolean
      browserPane: boolean
      filePane: boolean
    }
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
  catalog: {
    providers: number
    models: number
    agents: number
    skills: {
      total: number
      warnings: number
    }
    mcp: {
      connected: number
      total: number
    }
    lsp: {
      connected: number
      total: number
      error: number
    }
    codeIndex: {
      state: string
      pendingPlans: number
      nodeCount: number
    }
    permissionRules: number
  }
  desktop: AppDesktopDiagnostics
  security: {
    contentOrigin: string
    bridgeAvailable: boolean
    contextIsolation?: boolean
    nodeIntegration?: boolean
    sandbox?: boolean
    previewBridgeProfile: "separate-origin"
    capabilityProfiles: {
      enabled: number
      disabled: number
      remoteDisabled: boolean
      previewBridge: "none" | "unknown"
    }
  }
}

export type AppDiagnosticsBridge = {
  invoke(name: "diagnostics.read", payload: Record<string, never>): Promise<unknown>
  invoke(name: "diagnostics.exportLogs", payload: { includeBackendLogs?: boolean }): Promise<unknown>
  invoke(name: "platform.capabilities", payload: Record<string, never>): Promise<unknown>
  invoke(name: "release.checkUpdate", payload: Record<string, never>): Promise<unknown>
  invoke(name: "release.downloadUpdate", payload: Record<string, never>): Promise<unknown>
  invoke(name: "release.openDownloadedUpdate", payload: { artifactPath: string }): Promise<unknown>
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
  const catalog = catalogDiagnostics(input.view)
  const security = securityDiagnostics(desktop)
  return {
    runtime,
    eventStream: input.eventStream,
    queue,
    renderer,
    catalog,
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
  const capabilities =
    capabilitiesResult.status === "fulfilled" ? normalizeDesktopCapabilities(capabilitiesResult.value) : undefined
  const updateResult =
    capabilities?.release?.updaterConfigured === true
      ? await Promise.resolve(bridge.invoke("release.checkUpdate", {})).then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason) => ({ status: "rejected" as const, reason }),
        )
      : undefined
  return {
    available: true,
    backend:
      diagnosticsResult.status === "fulfilled"
        ? normalizeDesktopBackendDiagnostics(diagnosticsResult.value)
        : undefined,
    capabilities:
      updateResult?.status === "fulfilled"
        ? { ...capabilities, update: normalizeUpdateCheck(updateResult.value) }
        : capabilities,
    releaseReadiness: summarizeDesktopReleaseReadiness(capabilities?.release),
    errors: [
      settledError(diagnosticsResult),
      settledError(capabilitiesResult),
      updateResult ? settledError(updateResult) : undefined,
    ].filter((item): item is string => Boolean(item)),
  }
}

export function summarizeDesktopReleaseReadiness(
  release: NonNullable<AppDesktopDiagnostics["capabilities"]>["release"] | undefined,
): AppDesktopReleaseReadiness {
  if (!release) {
    return {
      status: "unknown",
      summary: "Release manifest is not available.",
      blockedGates: [],
      passedGates: [],
    }
  }

  const gateEntries = Object.entries(release.gates ?? {})
  const blockedGates = gateEntries
    .filter(([, gate]) => gate.status === "blocked")
    .map(([name, gate]) => ({
      name,
      ...(gate.reason ? { reason: gate.reason } : {}),
    }))
  const passedGates = gateEntries.filter(([, gate]) => gate.status === "passed").map(([name]) => name)
  const releaseReady =
    release.signed === true &&
    release.notarized === true &&
    release.updaterConfigured === true &&
    release.updatePolicy === "feed-configured" &&
    blockedGates.length === 0

  if (releaseReady) {
    return {
      status: "release-ready",
      summary: "Signed, notarized, and update-feed-backed desktop release.",
      blockedGates,
      passedGates,
    }
  }

  if (blockedGates.length > 0) {
    return {
      status: "internal-beta",
      summary: `${blockedGates.length} public release gate${blockedGates.length === 1 ? "" : "s"} blocked: ${blockedGates
        .map((gate) => gate.name)
        .join(", ")}.`,
      blockedGates,
      passedGates,
    }
  }

  return {
    status: "blocked",
    summary:
      release.status === "manifest-found"
        ? "Desktop release is missing signed, notarized, or update-feed-backed evidence."
        : "Desktop release manifest is missing or invalid.",
    blockedGates,
    passedGates,
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

export async function downloadDesktopUpdateArtifact(
  bridge: AppDiagnosticsBridge | undefined = globalThis.window?.axCodeDesktop,
) {
  if (!bridge) {
    return {
      available: false,
      status: "unavailable",
      reason: "Desktop release bridge is unavailable",
    }
  }
  const value = await bridge.invoke("release.downloadUpdate", {})
  return {
    available: true,
    ...normalizeUpdateCheck(value),
  }
}

export async function openDownloadedDesktopUpdateArtifact(
  artifactPath: string,
  bridge: AppDiagnosticsBridge | undefined = globalThis.window?.axCodeDesktop,
) {
  const path = artifactPath.trim()
  if (!path) {
    return {
      available: false,
      status: "error",
      reason: "Downloaded update artifact path is required",
    }
  }
  if (!bridge) {
    return {
      available: false,
      status: "unavailable",
      reason: "Desktop release bridge is unavailable",
      artifactPath: path,
    }
  }
  const value = await bridge.invoke("release.openDownloadedUpdate", { artifactPath: path })
  return {
    available: true,
    ...normalizeUpdateCheck(value),
  }
}

function runtimeDiagnostics(config: AxCodeAppRuntimeConfig): AppDiagnosticsReport["runtime"] {
  if (config.mode === "fixture") {
    return {
      mode: "fixture",
      authMode: "none",
      networkScope: "fixture",
      features: runtimeFeatureDiagnostics(config),
    }
  }
  const networkScope = runtimeNetworkScope(config)
  return {
    mode: "live",
    backendUrl: config.baseUrl,
    directory: config.directory,
    authMode: hasAuthorizationHeader(config.headers) ? "configured" : "none",
    networkScope,
    ...(runtimeNetworkWarning(networkScope) ? { networkWarning: runtimeNetworkWarning(networkScope) } : {}),
    features: runtimeFeatureDiagnostics(config),
    scheduledTaskOwner: config.scheduledTaskExecution?.owner,
    scheduledTasksStopOnQuit: config.scheduledTaskExecution?.stopsOnAppQuit,
  }
}

function runtimeNetworkWarning(scope: AxCodeRuntimeNetworkScope) {
  if (scope === "remote") return "Remote backend URL configured; trusted desktop bridge capabilities require loopback."
  if (scope === "invalid") return "Backend URL is invalid; live runtime may not connect."
  return undefined
}

function runtimeFeatureDiagnostics(config: AxCodeAppRuntimeConfig): AppDiagnosticsReport["runtime"]["features"] {
  return {
    terminalPane: isAppFeatureEnabled(config, "terminalPane"),
    browserPane: isAppFeatureEnabled(config, "browserPane"),
    filePane: isAppFeatureEnabled(config, "filePane"),
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
    version: rendererBuildVersion(),
    selectedSessionID: view.selectedSession?.id,
    visibleMessages: view.messages.length,
    hiddenMessages: view.messageHiddenCount,
    worktrees: view.worktrees.length,
    terminals: view.terminals.length,
    scheduledTasks: view.scheduledTasks.length,
    evidenceStatus: view.evidence?.status,
  }
}

function catalogDiagnostics(view: CommandCenterView): AppDiagnosticsReport["catalog"] {
  return {
    providers: view.catalog.providers.length,
    models: view.catalog.models.length,
    agents: view.catalog.agents.length,
    skills: {
      total: view.catalog.skills.length,
      warnings: view.catalog.skills.filter((skill) => skill.status === "warn").length,
    },
    mcp: {
      connected: view.catalog.mcp.connected,
      total: view.catalog.mcp.total,
    },
    lsp: {
      connected: view.catalog.lsp.connected,
      total: view.catalog.lsp.total,
      error: view.catalog.lsp.error,
    },
    codeIndex: {
      state: view.catalog.codeIndex.state,
      pendingPlans: view.catalog.codeIndex.pendingPlans,
      nodeCount: view.catalog.codeIndex.nodeCount,
    },
    permissionRules: view.catalog.permission.totalRules,
  }
}

function rendererBuildVersion() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
  return env.VITE_AX_CODE_APP_VERSION ?? "0.0.0"
}

function securityDiagnostics(desktop: AppDesktopDiagnostics): AppDiagnosticsReport["security"] {
  return {
    contentOrigin: desktop.capabilities?.security?.contentOrigin ?? "fixture",
    bridgeAvailable: desktop.available,
    contextIsolation: desktop.capabilities?.security?.contextIsolation,
    nodeIntegration: desktop.capabilities?.security?.nodeIntegration,
    sandbox: desktop.capabilities?.security?.sandbox,
    previewBridgeProfile: "separate-origin",
    capabilityProfiles: capabilityProfileDiagnostics(desktop.capabilities?.capabilityProfiles),
  }
}

function capabilityProfileDiagnostics(
  profiles: AppCapabilityProfile[] | undefined,
): AppDiagnosticsReport["security"]["capabilityProfiles"] {
  const list = Array.isArray(profiles) ? profiles : []
  const disabledRemote = ["remote-host", "tunnel", "pwa-network", "vscode-webview"].every(
    (id) => list.find((profile) => profile.id === id)?.status === "disabled",
  )
  const preview = list.find((profile) => profile.id === "browser-preview")
  return {
    enabled: list.filter((profile) => profile.status === "enabled").length,
    disabled: list.filter((profile) => profile.status === "disabled").length,
    remoteDisabled: list.length === 0 ? true : disabledRemote,
    previewBridge: preview?.bridge === "none" ? "none" : "unknown",
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
  const app = readRecord(record["app"])
  const renderer = readRecord(record["renderer"])
  const security = readRecord(record["security"])
  const release = readRecord(record["release"])
  return {
    app: Object.keys(app).length
      ? {
          name: readString(app, "name"),
          version: readString(app, "version"),
        }
      : undefined,
    renderer: Object.keys(renderer).length
      ? {
          name: readString(renderer, "name"),
          version: readString(renderer, "version"),
        }
      : undefined,
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
    capabilityProfiles: normalizeCapabilityProfiles(record["capabilityProfiles"]),
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
          updateFeed: normalizeReleaseUpdateFeed(release["updateFeed"]),
          gates: normalizeReleaseGates(release["gates"]),
        }
      : undefined,
  }
}

function normalizeCapabilityProfiles(value: unknown): AppCapabilityProfile[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => {
    const record = readRecord(item)
    return {
      id: readString(record, "id"),
      label: readString(record, "label"),
      status: readString(record, "status"),
      origin: readString(record, "origin"),
      bridge: readString(record, "bridge"),
      commands:
        readArray(record, "commands")?.filter((command): command is string => typeof command === "string") ?? [],
      localResources: readString(record, "localResources"),
      network: readString(record, "network"),
      gate: readString(record, "gate"),
      threatModel: readString(record, "threatModel"),
      securityReviews:
        readArray(record, "securityReviews")?.filter((review): review is string => typeof review === "string") ?? [],
    }
  })
}

function normalizeReleaseUpdateFeed(value: unknown) {
  const record = readRecord(value)
  if (!Object.keys(record).length) return undefined
  return {
    url: readString(record, "url"),
    artifactName: readString(record, "artifactName"),
    sha256: readString(record, "sha256"),
    sizeBytes: readNumber(record, "sizeBytes"),
  }
}

function normalizeUpdateCheck(value: unknown) {
  const record = readRecord(value)
  return {
    status: readString(record, "status"),
    currentVersion: readString(record, "currentVersion"),
    latestVersion: readString(record, "latestVersion"),
    artifactUrl: readString(record, "artifactUrl"),
    artifactPath: readString(record, "artifactPath"),
    sha256: readString(record, "sha256"),
    sizeBytes: readNumber(record, "sizeBytes"),
    reason: readString(record, "reason"),
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
  if (!result) return undefined
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

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readArray(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return Array.isArray(value) ? value : undefined
}
