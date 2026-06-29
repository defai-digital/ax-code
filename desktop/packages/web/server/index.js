import express from "express"
import compression from "compression"
import path from "path"
import { spawn, spawnSync } from "child_process"
import fs from "fs"
import http from "http"
import net from "net"
import { fileURLToPath } from "url"
import os from "os"
import crypto from "crypto"
import { createUiAuth } from "./lib/ui-auth/ui-auth.js"
import { createRequestSecurityRuntime } from "./lib/security/request-security.js"
import { applySecurityHeaders } from "./lib/security/response-headers.js"
import { prepareNotificationLastMessage } from "./lib/notifications/index.js"
import { createTerminalRuntime } from "./lib/terminal/runtime.js"
import {
  createGlobalUiEventBroadcaster,
  createGlobalMessageStreamHub,
  createMessageStreamWsRuntime,
  DEFAULT_UPSTREAM_STALL_TIMEOUT_MS,
  UPSTREAM_STALL_TIMEOUT_CONCURRENT_MS,
} from "./lib/event-stream/index.js"
import { createFsSearchRuntime as createFsSearchRuntimeFactory } from "./lib/fs/search.js"
import { resolveWorkspaceOrApprovedPathFromContext } from "./lib/fs/routes.js"
import { createAxCodeLifecycleRuntime } from "./lib/ax-code/lifecycle.js"
import { createAxCodeEnvRuntime } from "./lib/ax-code/env-runtime.js"
import { resolveAxCodeEnvConfig } from "./lib/ax-code/env-config.js"
import { createHmrStateRuntime } from "./lib/ax-code/hmr-state-runtime.js"
import { createAxCodeNetworkRuntime } from "./lib/ax-code/network-runtime.js"
import { createAxCodeAuthStateRuntime } from "./lib/ax-code/auth-state-runtime.js"
import { createProjectDirectoryRuntime } from "./lib/ax-code/project-directory-runtime.js"
import { createSettingsNormalizationRuntime } from "./lib/ax-code/settings-normalization-runtime.js"
import { createSettingsHelpers } from "./lib/ax-code/settings-helpers.js"
import { createThemeRuntime } from "./lib/ax-code/theme-runtime.js"
import { createFeatureRoutesRuntime } from "./lib/ax-code/feature-routes-runtime.js"
import { parseServeCliOptions } from "./lib/ax-code/cli-options.js"
import {
  registerAuthAndAccessRoutes,
  registerCommonRequestMiddleware,
  registerServerStatusRoutes,
} from "./lib/ax-code/core-routes.js"
import { registerOpenChamberRoutes } from "./lib/ax-code/openchamber-routes.js"
import { createServerUtilsRuntime } from "./lib/ax-code/server-utils-runtime.js"
import { createStaticRoutesRuntime } from "./lib/ax-code/static-routes-runtime.js"
import { createSettingsRuntime } from "./lib/ax-code/settings-runtime.js"
import { createAxCodeResolutionRuntime } from "./lib/ax-code/ax-code-resolution-runtime.js"
import { createBootstrapRuntime } from "./lib/ax-code/bootstrap-runtime.js"
import { createSessionRuntime } from "./lib/ax-code/session-runtime.js"
import { createAxCodeWatcherRuntime } from "./lib/ax-code/watcher.js"
import { createScheduledTasksRuntime } from "./lib/scheduled-tasks/runtime.js"
import { createServerStartupRuntime } from "./lib/ax-code/server-startup-runtime.js"
import { createStartupPipelineRuntime } from "./lib/ax-code/startup-pipeline-runtime.js"
import { runCliEntryIfMain } from "./lib/ax-code/cli-entry-runtime.js"
import { createStartupDiagnosticsRuntime } from "./lib/desktop/startup-diagnostics.js"
import { registerNotificationRoutes } from "./lib/notifications/routes.js"
import { createNotificationEmitterRuntime } from "./lib/notifications/emitter-runtime.js"
import { createNotificationTriggerRuntime } from "./lib/notifications/runtime.js"
import { createNotificationTemplateRuntime } from "./lib/notifications/template-runtime.js"
import { createGracefulShutdownRuntime } from "./lib/ax-code/shutdown-runtime.js"
import { createProjectConfigRuntime } from "./lib/projects/project-config.js"
import { createPreviewProxyRuntime } from "./lib/preview/proxy-runtime.js"
import { createProxyMiddleware, responseInterceptor } from "http-proxy-middleware"
import { createSseProxyMetrics } from "./lib/ax-code/proxy.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_PORT = 3000
const DESKTOP_NOTIFY_PREFIX = "[OpenChamberDesktopNotify] "
const uiNotificationClients = new Set()
const uiNotificationWsClients = new Set()
const uiOpenChamberEventClients = new Set()
const HEALTH_CHECK_INTERVAL = 15000
const configuredShutdownTimeout = Number.parseInt(process.env.AX_CODE_DESKTOP_SHUTDOWN_TIMEOUT_MS || "", 10)
const SHUTDOWN_TIMEOUT =
  Number.isFinite(configuredShutdownTimeout) && configuredShutdownTimeout > 0 ? configuredShutdownTimeout : 10000
const MODELS_DEV_API_URL = "https://models.dev/api.json"
const MODELS_METADATA_CACHE_TTL = 5 * 60 * 1000
const CLIENT_RELOAD_DELAY_MS = 800
const OPEN_CODE_READY_GRACE_MS = 12000
const LONG_REQUEST_TIMEOUT_MS = 4 * 60 * 1000

function headerIncludesEventStream(value) {
  if (typeof value === "string") {
    return value.toLowerCase().includes("text/event-stream")
  }

  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === "string" && entry.toLowerCase().includes("text/event-stream"))
  }

  return false
}

/**
 * SSE endpoint paths that must never be compressed by the compression middleware.
 *
 * The compression middleware filter runs before route handlers, so
 * `res.getHeader('Content-Type')` is still undefined at that point.
 * This means the Accept-header check alone is not sufficient for
 * non-standard clients (e.g. curl, fetch) that omit Accept.
 * Path-based exclusion acts as a deterministic fallback.
 */
const SSE_PATH_PREFIXES = ["/api/event", "/api/global/event", "/api/notifications/stream", "/api/openchamber/events"]

function shouldSkipCompression(req, res) {
  if (headerIncludesEventStream(req.headers.accept)) {
    return true
  }

  const pathname = req.path || req.url || ""
  if ((pathname === "/api" || pathname.startsWith("/api/")) && shouldSkipApiCompression()) {
    return true
  }

  if (pathname.startsWith("/api/terminal/") && pathname.endsWith("/stream")) {
    return true
  }
  for (const prefix of SSE_PATH_PREFIXES) {
    if (pathname === prefix) {
      return true
    }
  }

  return headerIncludesEventStream(res.getHeader("Content-Type"))
}

const AX_CODE_DESKTOP_VERSION = (() => {
  try {
    const packagePath = path.resolve(__dirname, "..", "package.json")
    const raw = fs.readFileSync(packagePath, "utf8")
    const pkg = JSON.parse(raw)
    if (pkg && typeof pkg.version === "string" && pkg.version.trim().length > 0) {
      return pkg.version.trim()
    }
  } catch {}
  return "unknown"
})()

const isEnvFlagEnabled = (value) => {
  if (value === true || value === 1) return true
  if (typeof value !== "string") return false
  const normalized = value.trim().toLowerCase()
  return normalized === "1" || normalized === "true"
}

const isEnvFlagDisabled = (value) => {
  if (value === false || value === 0) return true
  if (typeof value !== "string") return false
  const normalized = value.trim().toLowerCase()
  return normalized === "0" || normalized === "false"
}

const shouldSkipApiCompression = () => {
  if (isEnvFlagEnabled(process.env.AX_CODE_DESKTOP_SKIP_API_COMPRESSION)) return true
  if (isEnvFlagEnabled(process.env.AX_CODE_DESKTOP_COMPRESS_API)) return false
  if (isEnvFlagDisabled(process.env.AX_CODE_DESKTOP_COMPRESS_API)) return true
  return process.env.AX_CODE_DESKTOP_RUNTIME === "desktop"
}

const AX_CODE_DESKTOP_VERBOSE_REQUEST_LOGS = isEnvFlagEnabled(process.env.AX_CODE_DESKTOP_VERBOSE_REQUEST_LOGS)

const PLAN_MODE_EXPERIMENT_ENABLED =
  isEnvFlagEnabled(process.env.AX_CODE_EXPERIMENTAL_PLAN_MODE) || isEnvFlagEnabled(process.env.AX_CODE_EXPERIMENTAL)

const fsPromises = fs.promises

const settingsNormalizationRuntime = createSettingsNormalizationRuntime({
  os,
  path,
  processLike: process,
  realpathSync: fs.realpathSync,
})

const normalizeDirectoryPath = (...args) => settingsNormalizationRuntime.normalizeDirectoryPath(...args)
const normalizePathForPersistence = (...args) => settingsNormalizationRuntime.normalizePathForPersistence(...args)
const normalizeSettingsPaths = (...args) => settingsNormalizationRuntime.normalizeSettingsPaths(...args)
const isUnsafeSkillRelativePath = (...args) => settingsNormalizationRuntime.isUnsafeSkillRelativePath(...args)
const sanitizeTypographySizesPartial = (...args) => settingsNormalizationRuntime.sanitizeTypographySizesPartial(...args)
const normalizeStringArray = (...args) => settingsNormalizationRuntime.normalizeStringArray(...args)
const sanitizeModelRefs = (...args) => settingsNormalizationRuntime.sanitizeModelRefs(...args)
const sanitizeSkillCatalogs = (...args) => settingsNormalizationRuntime.sanitizeSkillCatalogs(...args)
const sanitizeProjects = (...args) => settingsNormalizationRuntime.sanitizeProjects(...args)

const AX_CODE_DESKTOP_USER_CONFIG_ROOT = path.join(os.homedir(), ".config", "openchamber")
const AX_CODE_DESKTOP_USER_THEMES_DIR = path.join(AX_CODE_DESKTOP_USER_CONFIG_ROOT, "themes")
const AX_CODE_DESKTOP_PROJECTS_CONFIG_DIR = path.join(AX_CODE_DESKTOP_USER_CONFIG_ROOT, "projects")

const MAX_THEME_JSON_BYTES = 512 * 1024

const themeRuntime = createThemeRuntime({
  fsPromises,
  path,
  themesDir: AX_CODE_DESKTOP_USER_THEMES_DIR,
  maxThemeJsonBytes: MAX_THEME_JSON_BYTES,
  logger: console,
})

const readCustomThemesFromDisk = (...args) => themeRuntime.readCustomThemesFromDisk(...args)

let notificationTemplateRuntime = null

const createTimeoutSignal = (...args) => notificationTemplateRuntime.createTimeoutSignal(...args)
const formatProjectLabel = (...args) => notificationTemplateRuntime.formatProjectLabel(...args)
const resolveNotificationTemplate = (...args) => notificationTemplateRuntime.resolveNotificationTemplate(...args)
const shouldApplyResolvedTemplateMessage = (...args) =>
  notificationTemplateRuntime.shouldApplyResolvedTemplateMessage(...args)
const fetchFreeZenModels = (...args) => notificationTemplateRuntime.fetchFreeZenModels(...args)
const extractTextFromParts = (...args) => notificationTemplateRuntime.extractTextFromParts(...args)
const extractLastMessageText = (...args) => notificationTemplateRuntime.extractLastMessageText(...args)
const fetchLastAssistantMessageText = (...args) => notificationTemplateRuntime.fetchLastAssistantMessageText(...args)
const maybeCacheSessionInfoFromEvent = (...args) => notificationTemplateRuntime.maybeCacheSessionInfoFromEvent(...args)
const buildTemplateVariables = (...args) => notificationTemplateRuntime.buildTemplateVariables(...args)
const getCachedZenModels = (...args) => notificationTemplateRuntime.getCachedZenModels(...args)

const AX_CODE_DESKTOP_DATA_DIR = process.env.AX_CODE_DESKTOP_DATA_DIR
  ? path.resolve(process.env.AX_CODE_DESKTOP_DATA_DIR)
  : path.join(os.homedir(), ".config", "openchamber")
const SETTINGS_FILE_PATH = path.join(AX_CODE_DESKTOP_DATA_DIR, "settings.json")

const settingsHelpers = createSettingsHelpers({
  normalizePathForPersistence,
  normalizeDirectoryPath,
  sanitizeTypographySizesPartial,
  normalizeStringArray,
  sanitizeModelRefs,
  sanitizeSkillCatalogs,
  sanitizeProjects,
})

const sanitizeSettingsUpdate = (...args) => settingsHelpers.sanitizeSettingsUpdate(...args)
const mergePersistedSettings = (...args) => settingsHelpers.mergePersistedSettings(...args)
const formatSettingsResponse = (...args) => settingsHelpers.formatSettingsResponse(...args)

const projectDirectoryRuntime = createProjectDirectoryRuntime({
  fsPromises,
  path,
  normalizeDirectoryPath,
  getReadSettingsFromDiskMigrated: () => readSettingsFromDiskMigrated,
  sanitizeProjects,
})

const resolveDirectoryCandidate = (...args) => projectDirectoryRuntime.resolveDirectoryCandidate(...args)
const validateDirectoryPath = (...args) => projectDirectoryRuntime.validateDirectoryPath(...args)
const resolveProjectDirectory = (...args) => projectDirectoryRuntime.resolveProjectDirectory(...args)
const resolveOptionalProjectDirectory = (...args) => projectDirectoryRuntime.resolveOptionalProjectDirectory(...args)

const settingsRuntime = createSettingsRuntime({
  fsPromises,
  path,
  crypto,
  SETTINGS_FILE_PATH,
  sanitizeProjects,
  sanitizeSettingsUpdate,
  mergePersistedSettings,
  normalizeSettingsPaths,
  normalizeStringArray,
  formatSettingsResponse,
  resolveDirectoryCandidate,
})

const readSettingsFromDiskMigrated = (...args) => settingsRuntime.readSettingsFromDiskMigrated(...args)
const readSettingsFromDisk = (...args) => settingsRuntime.readSettingsFromDisk(...args)
const writeSettingsToDisk = (...args) => settingsRuntime.writeSettingsToDisk(...args)
const persistSettings = (...args) => settingsRuntime.persistSettings(...args)

const requestSecurityRuntime = createRequestSecurityRuntime({
  readSettingsFromDiskMigrated,
})

const getUiSessionTokenFromRequest = (...args) => requestSecurityRuntime.getUiSessionTokenFromRequest(...args)

const TERMINAL_INPUT_WS_MAX_REBINDS_PER_WINDOW = 128
const TERMINAL_INPUT_WS_REBIND_WINDOW_MS = 60 * 1000
const TERMINAL_INPUT_WS_HEARTBEAT_INTERVAL_MS = 15 * 1000

const rejectWebSocketUpgrade = (...args) => requestSecurityRuntime.rejectWebSocketUpgrade(...args)

const isRequestOriginAllowed = (...args) => requestSecurityRuntime.isRequestOriginAllowed(...args)

const notificationEmitterRuntime = createNotificationEmitterRuntime({
  process,
  getDesktopNotifyEnabled: () => ENV_DESKTOP_NOTIFY,
  desktopNotifyPrefix: DESKTOP_NOTIFY_PREFIX,
  getUiNotificationClients: () => uiNotificationClients,
  getBroadcastGlobalUiEvent: () => broadcastGlobalUiEvent,
})

const writeSseEvent = (...args) => notificationEmitterRuntime.writeSseEvent(...args)
const emitDesktopNotification = (...args) => notificationEmitterRuntime.emitDesktopNotification(...args)
const broadcastGlobalUiEvent = createGlobalUiEventBroadcaster({
  sseClients: uiNotificationClients,
  wsClients: uiNotificationWsClients,
  writeSseEvent,
})
const broadcastUiNotification = (...args) => notificationEmitterRuntime.broadcastUiNotification(...args)

const sessionRuntime = createSessionRuntime({
  writeSseEvent,
  getNotificationClients: () => uiNotificationClients,
  broadcastEvent: broadcastGlobalUiEvent,
})

const getActiveSessionCount = () => {
  const snapshot = sessionRuntime.getSessionActivitySnapshot()
  return Object.values(snapshot).filter((entry) => entry.type === "busy").length
}

const getUpstreamStallTimeoutMs = () =>
  getActiveSessionCount() > 1 ? UPSTREAM_STALL_TIMEOUT_CONCURRENT_MS : DEFAULT_UPSTREAM_STALL_TIMEOUT_MS

const sseProxyMetrics = createSseProxyMetrics()
let startupDiagnosticsRuntime = null

const recordStartupEvent = (name, details = {}, options = {}) => {
  if (!startupDiagnosticsRuntime) return null
  if (options.once === false) {
    return startupDiagnosticsRuntime.record(name, details, options)
  }
  return startupDiagnosticsRuntime.markOnce(name, details, options)
}

const REPEATABLE_DESKTOP_STARTUP_EVENTS = new Set([
  "server.utilityProcess.launch",
  "server.utilityProcess.ready",
])

const projectConfigRuntime = createProjectConfigRuntime({
  fsPromises,
  path,
  projectsDirPath: AX_CODE_DESKTOP_PROJECTS_CONFIG_DIR,
})

// HMR-persistent state via globalThis
// These values survive Vite HMR reloads to prevent zombie ax-code processes
const hmrStateRuntime = createHmrStateRuntime({
  globalThisLike: globalThis,
  os,
  processLike: process,
  stateKey: "__openchamberHmrState",
})
const hmrState = hmrStateRuntime.getOrCreateHmrState()
hmrStateRuntime.ensureUserProvidedAxCodePassword(hmrState)

// Non-HMR state (safe to reset on reload)
let healthCheckInterval = null
let server = null
let expressApp = null
let currentRestartPromise = null
let isRestartingAxCode = false
let axCodeApiPrefix = ""
let axCodeApiPrefixDetected = true
let axCodeApiDetectionTimer = null
let lastAxCodeError = null
let lastAxCodeLaunchDiagnostics = null
let isAxCodeReady = false
let axCodeNotReadySince = 0
let isExternalAxCode = false
let exitOnShutdown = true
let uiAuthController = null
let globalWatcherStartPromise = null
let terminalRuntime = null
let messageStreamRuntime = null
const userProvidedAxCodePassword = hmrStateRuntime.getUserProvidedAxCodePassword(hmrState)
const initialAxCodeAuthState = hmrStateRuntime.resolveAxCodeAuthFromState({
  hmrState,
  userProvidedAxCodePassword,
})
let axCodeAuthPassword = initialAxCodeAuthState.axCodeAuthPassword
let axCodeAuthSource = initialAxCodeAuthState.axCodeAuthSource

// Sync helper - call after modifying any HMR state variable
const syncToHmrState = () => {
  hmrStateRuntime.syncStateFromRuntime(hmrState, {
    axCodeProcess,
    axCodePort,
    axCodeBaseUrl,
    isShuttingDown,
    signalsAttached,
    axCodeWorkingDirectory,
    axCodeAuthPassword,
    axCodeAuthSource,
  })
}

// Sync helper - call to restore state from HMR (e.g., on module reload)
const syncFromHmrState = () => {
  const restored = hmrStateRuntime.restoreRuntimeFromState({
    hmrState,
    userProvidedAxCodePassword,
  })
  axCodeProcess = restored.axCodeProcess
  axCodePort = restored.axCodePort
  axCodeBaseUrl = restored.axCodeBaseUrl
  isShuttingDown = restored.isShuttingDown
  signalsAttached = restored.signalsAttached
  axCodeWorkingDirectory = restored.axCodeWorkingDirectory
  axCodeAuthPassword = restored.axCodeAuthPassword
  axCodeAuthSource = restored.axCodeAuthSource
}

// Module-level variables that shadow HMR state
// These are synced to/from hmrState to survive HMR reloads
let axCodeProcess = hmrState.axCodeProcess
let axCodePort = hmrState.axCodePort
let axCodeBaseUrl = hmrState.axCodeBaseUrl ?? null
let isShuttingDown = hmrState.isShuttingDown
let signalsAttached = hmrState.signalsAttached
let axCodeWorkingDirectory = hmrState.axCodeWorkingDirectory

const {
  configuredAxCodePort: ENV_CONFIGURED_AX_CODE_PORT,
  configuredAxCodeHost: ENV_CONFIGURED_AX_CODE_HOST,
  effectivePort: ENV_EFFECTIVE_PORT,
  configuredAxCodeHostname: ENV_CONFIGURED_AX_CODE_HOSTNAME,
} = resolveAxCodeEnvConfig({
  env: process.env,
  logger: console,
})

const ENV_SKIP_AX_CODE_START =
  process.env.AX_CODE_SKIP_START === "true" || process.env.AX_CODE_DESKTOP_SKIP_AX_CODE_START === "true"
const ENV_DESKTOP_NOTIFY = (() => {
  if (process.env.AX_CODE_DESKTOP_DESKTOP_NOTIFY === "true") {
    return true
  }

  if (process.env.AX_CODE_DESKTOP_RUNTIME === "desktop") {
    return true
  }

  const argv0 = typeof process.argv?.[0] === "string" ? process.argv[0] : ""
  const argv1 = typeof process.argv?.[1] === "string" ? process.argv[1] : ""
  return /openchamber-server/i.test(argv0) || /openchamber-server/i.test(argv1)
})()
const ENV_CONFIGURED_AX_CODE_WSL_DISTRO =
  typeof process.env.AX_CODE_WSL_DISTRO === "string" && process.env.AX_CODE_WSL_DISTRO.trim().length > 0
    ? process.env.AX_CODE_WSL_DISTRO.trim()
    : null

const axCodeAuthStateRuntime = createAxCodeAuthStateRuntime({
  crypto,
  process,
  getAuthPassword: () => axCodeAuthPassword,
  setAuthPassword: (value) => {
    axCodeAuthPassword = value
  },
  getAuthSource: () => axCodeAuthSource,
  setAuthSource: (value) => {
    axCodeAuthSource = value
  },
  getUserProvidedPassword: () => userProvidedAxCodePassword,
  syncToHmrState,
})

const getAxCodeAuthHeaders = (...args) => axCodeAuthStateRuntime.getAxCodeAuthHeaders(...args)
const isAxCodeConnectionSecure = (...args) => axCodeAuthStateRuntime.isAxCodeConnectionSecure(...args)
const ensureLocalAxCodeServerPassword = (...args) => axCodeAuthStateRuntime.ensureLocalAxCodeServerPassword(...args)

const axCodeNetworkState = {}
Object.defineProperties(axCodeNetworkState, {
  axCodePort: {
    get: () => axCodePort,
    set: (value) => {
      axCodePort = value
    },
  },
  axCodeBaseUrl: {
    get: () => axCodeBaseUrl,
    set: (value) => {
      axCodeBaseUrl = value
    },
  },
  axCodeApiPrefix: {
    get: () => axCodeApiPrefix,
    set: (value) => {
      axCodeApiPrefix = value
    },
  },
  axCodeApiPrefixDetected: {
    get: () => axCodeApiPrefixDetected,
    set: (value) => {
      axCodeApiPrefixDetected = value
    },
  },
  axCodeApiDetectionTimer: {
    get: () => axCodeApiDetectionTimer,
    set: (value) => {
      axCodeApiDetectionTimer = value
    },
  },
})

const axCodeNetworkRuntime = createAxCodeNetworkRuntime({
  state: axCodeNetworkState,
  getAxCodeAuthHeaders,
})

const waitForReady = (...args) => axCodeNetworkRuntime.waitForReady(...args)
const normalizeApiPrefix = (...args) => axCodeNetworkRuntime.normalizeApiPrefix(...args)
const setDetectedAxCodeApiPrefix = (...args) => axCodeNetworkRuntime.setDetectedAxCodeApiPrefix(...args)
const buildAxCodeUrl = (...args) => axCodeNetworkRuntime.buildAxCodeUrl(...args)
const ensureAxCodeApiPrefix = (...args) => axCodeNetworkRuntime.ensureAxCodeApiPrefix(...args)
const scheduleAxCodeApiDetection = (...args) => axCodeNetworkRuntime.scheduleAxCodeApiDetection(...args)

const ENV_CONFIGURED_API_PREFIX = normalizeApiPrefix(
  process.env.AX_CODE_API_PREFIX || process.env.AX_CODE_DESKTOP_API_PREFIX || "",
)

if (ENV_CONFIGURED_API_PREFIX && ENV_CONFIGURED_API_PREFIX !== "") {
  console.warn("Ignoring configured ax-code API prefix; API runs at root.")
}

let cachedLoginShellEnvSnapshot
let resolvedAxCodeBinary = null
let resolvedAxCodeBinarySource = null
let resolvedNodeBinary = null
let resolvedBunBinary = null
let resolvedGitBinary = null
let useWslForAxCode = false
let resolvedWslBinary = null
let resolvedWslAxCodePath = null
let resolvedWslDistro = null

const axCodeEnvState = {}
Object.defineProperties(axCodeEnvState, {
  cachedLoginShellEnvSnapshot: {
    get: () => cachedLoginShellEnvSnapshot,
    set: (value) => {
      cachedLoginShellEnvSnapshot = value
    },
  },
  resolvedAxCodeBinary: {
    get: () => resolvedAxCodeBinary,
    set: (value) => {
      resolvedAxCodeBinary = value
    },
  },
  resolvedAxCodeBinarySource: {
    get: () => resolvedAxCodeBinarySource,
    set: (value) => {
      resolvedAxCodeBinarySource = value
    },
  },
  resolvedNodeBinary: {
    get: () => resolvedNodeBinary,
    set: (value) => {
      resolvedNodeBinary = value
    },
  },
  resolvedBunBinary: {
    get: () => resolvedBunBinary,
    set: (value) => {
      resolvedBunBinary = value
    },
  },
  resolvedGitBinary: {
    get: () => resolvedGitBinary,
    set: (value) => {
      resolvedGitBinary = value
    },
  },
  useWslForAxCode: {
    get: () => useWslForAxCode,
    set: (value) => {
      useWslForAxCode = value
    },
  },
  resolvedWslBinary: {
    get: () => resolvedWslBinary,
    set: (value) => {
      resolvedWslBinary = value
    },
  },
  resolvedWslAxCodePath: {
    get: () => resolvedWslAxCodePath,
    set: (value) => {
      resolvedWslAxCodePath = value
    },
  },
  resolvedWslDistro: {
    get: () => resolvedWslDistro,
    set: (value) => {
      resolvedWslDistro = value
    },
  },
})

const axCodeEnvRuntime = createAxCodeEnvRuntime({
  state: axCodeEnvState,
  normalizeDirectoryPath,
  readSettingsFromDiskMigrated,
  ENV_CONFIGURED_AX_CODE_WSL_DISTRO,
})

const applyLoginShellEnvSnapshot = (...args) => axCodeEnvRuntime.applyLoginShellEnvSnapshot(...args)
const ensureLoginShellEnvSnapshotAsync = (...args) => axCodeEnvRuntime.ensureLoginShellEnvSnapshotAsync(...args)
const getLoginShellEnvSnapshot = (...args) => axCodeEnvRuntime.getLoginShellEnvSnapshot(...args)
const ensureAxCodeCliEnv = (...args) => axCodeEnvRuntime.ensureAxCodeCliEnv(...args)
const applyAxCodeBinaryFromSettings = (...args) => axCodeEnvRuntime.applyAxCodeBinaryFromSettings(...args)
const resolveAxCodeCliPath = (...args) => axCodeEnvRuntime.resolveAxCodeCliPath(...args)
const isExecutable = (...args) => axCodeEnvRuntime.isExecutable(...args)
const searchPathFor = (...args) => axCodeEnvRuntime.searchPathFor(...args)
const resolveGitBinaryForSpawn = (...args) => axCodeEnvRuntime.resolveGitBinaryForSpawn(...args)
const resolveWslExecutablePath = (...args) => axCodeEnvRuntime.resolveWslExecutablePath(...args)
const buildWslExecArgs = (...args) => axCodeEnvRuntime.buildWslExecArgs(...args)
const resolveManagedAxCodeLaunchSpec = (...args) => axCodeEnvRuntime.resolveManagedAxCodeLaunchSpec(...args)
const clearResolvedAxCodeBinary = (...args) => axCodeEnvRuntime.clearResolvedAxCodeBinary(...args)
const axCodeResolutionRuntime = createAxCodeResolutionRuntime({
  path,
  resolveAxCodeCliPath,
  applyAxCodeBinaryFromSettings,
  ensureAxCodeCliEnv,
  resolveManagedAxCodeLaunchSpec,
  getResolvedState: () => ({
    resolvedAxCodeBinary,
    resolvedAxCodeBinarySource,
    useWslForAxCode,
    resolvedWslBinary,
    resolvedWslAxCodePath,
    resolvedWslDistro,
    resolvedNodeBinary,
    resolvedBunBinary,
  }),
  setResolvedAxCodeBinarySource: (value) => {
    resolvedAxCodeBinarySource = value
  },
})
const getAxCodeResolutionSnapshot = (...args) => axCodeResolutionRuntime.getAxCodeResolutionSnapshot(...args)

// Shell env snapshot is applied asynchronously inside main() via
// ensureLoginShellEnvSnapshotAsync() so it does not block module loading.

notificationTemplateRuntime = createNotificationTemplateRuntime({
  readSettingsFromDisk,
  persistSettings,
  buildAxCodeUrl,
  getAxCodeAuthHeaders,
  resolveGitBinaryForSpawn,
})

const notificationTriggerRuntime = createNotificationTriggerRuntime({
  readSettingsFromDisk,
  prepareNotificationLastMessage,
  buildTemplateVariables,
  extractLastMessageText,
  fetchLastAssistantMessageText,
  resolveNotificationTemplate,
  shouldApplyResolvedTemplateMessage,
  emitDesktopNotification,
  broadcastUiNotification,
  buildAxCodeUrl,
  getAxCodeAuthHeaders,
})

const maybeDispatchNotificationForTrigger = (...args) =>
  notificationTriggerRuntime.maybeDispatchNotificationForTrigger(...args)
const setAutoAcceptSession = (...args) => notificationTriggerRuntime.setAutoAcceptSession(...args)

const globalMessageStreamHub = createGlobalMessageStreamHub({
  buildAxCodeUrl,
  getAxCodeAuthHeaders,
  upstreamStallTimeoutMs: getUpstreamStallTimeoutMs,
  upstreamReconnectDelayMs: 1000,
})

const axCodeWatcherRuntime = createAxCodeWatcherRuntime({
  waitForAxCodePort: (...args) => waitForAxCodePort(...args),
  buildAxCodeUrl,
  getAxCodeAuthHeaders,
  parseSseDataPayload: (...args) => parseSseDataPayload(...args),
  globalEventHub: globalMessageStreamHub,
  onPayload: (payload) => {
    maybeCacheSessionInfoFromEvent(payload)
    void maybeDispatchNotificationForTrigger(payload)
    sessionRuntime.processAxCodeSsePayload(payload)
  },
})

const processForwardedEventPayload = (payload, emitSyntheticEvent) => {
  if (!payload || typeof payload !== "object" || typeof emitSyntheticEvent !== "function") {
    return
  }

  maybeCacheSessionInfoFromEvent(payload)

  if (payload.type !== "session.status") {
    return
  }

  const properties = payload.properties && typeof payload.properties === "object" ? payload.properties : {}
  const statusInfo = properties.status && typeof properties.status === "object" ? properties.status : {}
  const info = properties.info && typeof properties.info === "object" ? properties.info : {}
  const sessionId = typeof properties.sessionID === "string" ? properties.sessionID.trim() : ""
  const status =
    typeof statusInfo.type === "string" ? statusInfo.type.trim() : typeof info.type === "string" ? info.type.trim() : ""

  if (!sessionId || !status) {
    return
  }

  emitSyntheticEvent({
    type: "openchamber:session-status",
    properties: {
      sessionID: sessionId,
      status,
      timestamp: Date.now(),
      metadata: {
        attempt:
          typeof statusInfo.attempt === "number"
            ? statusInfo.attempt
            : typeof info.attempt === "number"
              ? info.attempt
              : undefined,
        message:
          typeof statusInfo.message === "string"
            ? statusInfo.message
            : typeof info.message === "string"
              ? info.message
              : undefined,
        next:
          typeof statusInfo.next === "number" ? statusInfo.next : typeof info.next === "number" ? info.next : undefined,
      },
      needsAttention: false,
    },
  })

  emitSyntheticEvent({
    type: "openchamber:session-activity",
    properties: {
      sessionId,
      phase: status === "busy" || status === "retry" ? "busy" : "idle",
    },
  })
}

const serverUtilsRuntime = createServerUtilsRuntime({
  fs,
  os,
  path,
  process,
  axCodeReadyGraceMs: OPEN_CODE_READY_GRACE_MS,
  longRequestTimeoutMs: LONG_REQUEST_TIMEOUT_MS,
  settingsFilePath: SETTINGS_FILE_PATH,
  getRuntime: () => ({
    axCodePort,
    axCodeBaseUrl,
    axCodeNotReadySince,
    isAxCodeReady,
    isRestartingAxCode,
    axCodeRuntimeHealth: axCodeLifecycleState.axCodeRuntimeHealth || null,
  }),
  getAxCodeAuthHeaders,
  buildAxCodeUrl,
  ensureAxCodeApiPrefix,
  getUiNotificationClients: () => uiNotificationClients,
  sseMetrics: sseProxyMetrics,
  recordStartupEvent,
  getAxCodePort: () => axCodePort,
  setAxCodePortState: (value) => {
    axCodePort = value
  },
  syncToHmrState,
  markAxCodeNotReady: () => {
    isAxCodeReady = false
  },
  setAxCodeNotReadySince: (value) => {
    axCodeNotReadySince = value
  },
  clearLastAxCodeError: () => {
    lastAxCodeError = null
  },
  getLoginShellPath: () => {
    const snapshot = getLoginShellEnvSnapshot()
    if (!snapshot || typeof snapshot.PATH !== "string" || snapshot.PATH.length === 0) {
      return null
    }
    return snapshot.PATH
  },
})

const setAxCodePort = (...args) => serverUtilsRuntime.setAxCodePort(...args)
const waitForAxCodePort = (...args) => serverUtilsRuntime.waitForAxCodePort(...args)
const buildAugmentedPath = (...args) => serverUtilsRuntime.buildAugmentedPath(...args)
const buildManagedAxCodePath = (...args) => serverUtilsRuntime.buildManagedAxCodePath(...args)
const parseSseDataPayload = (...args) => serverUtilsRuntime.parseSseDataPayload(...args)
const staticRoutesRuntime = createStaticRoutesRuntime({
  fs,
  path,
  process,
  __dirname,
  express,
})
const featureRoutesRuntime = createFeatureRoutesRuntime({
  clientReloadDelayMs: CLIENT_RELOAD_DELAY_MS,
})
const bootstrapRuntime = createBootstrapRuntime({
  createUiAuth,
  registerServerStatusRoutes,
  registerCommonRequestMiddleware,
  registerAuthAndAccessRoutes,
  registerNotificationRoutes,
  registerOpenChamberRoutes,
  express,
})
const startupPipelineRuntime = createStartupPipelineRuntime({
  createTerminalRuntime,
  createMessageStreamWsRuntime,
  createServerStartupRuntime,
})

const axCodeLifecycleState = {}
Object.defineProperties(axCodeLifecycleState, {
  axCodeProcess: {
    get: () => axCodeProcess,
    set: (value) => {
      axCodeProcess = value
    },
  },
  axCodePort: {
    get: () => axCodePort,
    set: (value) => {
      axCodePort = value
    },
  },
  axCodeBaseUrl: {
    get: () => axCodeBaseUrl,
    set: (value) => {
      axCodeBaseUrl = value
    },
  },
  axCodeWorkingDirectory: {
    get: () => axCodeWorkingDirectory,
    set: (value) => {
      axCodeWorkingDirectory = value
    },
  },
  currentRestartPromise: {
    get: () => currentRestartPromise,
    set: (value) => {
      currentRestartPromise = value
    },
  },
  isRestartingAxCode: {
    get: () => isRestartingAxCode,
    set: (value) => {
      isRestartingAxCode = value
    },
  },
  axCodeApiPrefix: {
    get: () => axCodeApiPrefix,
    set: (value) => {
      axCodeApiPrefix = value
    },
  },
  axCodeApiPrefixDetected: {
    get: () => axCodeApiPrefixDetected,
    set: (value) => {
      axCodeApiPrefixDetected = value
    },
  },
  axCodeApiDetectionTimer: {
    get: () => axCodeApiDetectionTimer,
    set: (value) => {
      axCodeApiDetectionTimer = value
    },
  },
  lastAxCodeError: {
    get: () => lastAxCodeError,
    set: (value) => {
      lastAxCodeError = value
    },
  },
  lastAxCodeLaunchDiagnostics: {
    get: () => lastAxCodeLaunchDiagnostics,
    set: (value) => {
      lastAxCodeLaunchDiagnostics = value
    },
  },
  isAxCodeReady: {
    get: () => isAxCodeReady,
    set: (value) => {
      isAxCodeReady = value
    },
  },
  axCodeNotReadySince: {
    get: () => axCodeNotReadySince,
    set: (value) => {
      axCodeNotReadySince = value
    },
  },
  isExternalAxCode: {
    get: () => isExternalAxCode,
    set: (value) => {
      isExternalAxCode = value
    },
  },
  isShuttingDown: {
    get: () => isShuttingDown,
    set: (value) => {
      isShuttingDown = value
    },
  },
  healthCheckInterval: {
    get: () => healthCheckInterval,
    set: (value) => {
      healthCheckInterval = value
    },
  },
  expressApp: {
    get: () => expressApp,
    set: (value) => {
      expressApp = value
    },
  },
  useWslForAxCode: {
    get: () => useWslForAxCode,
    set: (value) => {
      useWslForAxCode = value
    },
  },
  resolvedWslBinary: {
    get: () => resolvedWslBinary,
    set: (value) => {
      resolvedWslBinary = value
    },
  },
  resolvedWslAxCodePath: {
    get: () => resolvedWslAxCodePath,
    set: (value) => {
      resolvedWslAxCodePath = value
    },
  },
  resolvedWslDistro: {
    get: () => resolvedWslDistro,
    set: (value) => {
      resolvedWslDistro = value
    },
  },
})

const axCodeLifecycleRuntime = createAxCodeLifecycleRuntime({
  state: axCodeLifecycleState,
  env: {
    ENV_CONFIGURED_AX_CODE_PORT,
    ENV_CONFIGURED_AX_CODE_HOST,
    ENV_EFFECTIVE_PORT,
    ENV_CONFIGURED_AX_CODE_HOSTNAME,
    ENV_SKIP_AX_CODE_START,
  },
  syncToHmrState,
  syncFromHmrState,
  getAxCodeAuthHeaders,
  buildAxCodeUrl,
  waitForReady,
  normalizeApiPrefix,
  applyAxCodeBinaryFromSettings,
  ensureAxCodeCliEnv,
  ensureLocalAxCodeServerPassword,
  buildWslExecArgs,
  resolveWslExecutablePath,
  resolveManagedAxCodeLaunchSpec,
  setAxCodePort,
  setDetectedAxCodeApiPrefix,
  setupProxy: (...args) => setupProxy(...args),
  ensureAxCodeApiPrefix,
  clearResolvedAxCodeBinary,
  buildAugmentedPath,
  buildManagedAxCodePath,
  getManagedAxCodeShellEnvSnapshot: getLoginShellEnvSnapshot,
  getActiveSessionCount,
  recordStartupEvent,
})

const restartAxCode = (...args) => axCodeLifecycleRuntime.restartAxCode(...args)
const waitForAxCodeReady = (...args) => axCodeLifecycleRuntime.waitForAxCodeReady(...args)
const waitForAgentPresence = (...args) => axCodeLifecycleRuntime.waitForAgentPresence(...args)
const refreshAxCodeAfterConfigChange = (...args) => axCodeLifecycleRuntime.refreshAxCodeAfterConfigChange(...args)
const startHealthMonitoring = () => axCodeLifecycleRuntime.startHealthMonitoring(HEALTH_CHECK_INTERVAL)
const triggerHealthCheck = () => axCodeLifecycleRuntime.triggerHealthCheck()
const scheduledTasksRuntime = createScheduledTasksRuntime({
  projectConfigRuntime,
  listProjects: async () => {
    const settings = await readSettingsFromDiskMigrated()
    return sanitizeProjects(settings?.projects || [])
  },
  buildAxCodeUrl,
  getAxCodeAuthHeaders,
  waitForAxCodeReady,
  emitTaskRunEvent: (event) => {
    for (const client of uiOpenChamberEventClients) {
      try {
        writeSseEvent(client, {
          type: "openchamber:scheduled-task-ran",
          properties: {
            projectId: event.projectID,
            taskId: event.taskID,
            ranAt: event.ranAt,
            status: event.status,
            ...(event.sessionID ? { sessionId: event.sessionID } : {}),
          },
        })
      } catch {
        uiOpenChamberEventClients.delete(client)
      }
    }
  },
  logger: console,
})

const ensureGlobalWatcherStarted = async () => {
  if (globalWatcherStartPromise) {
    return globalWatcherStartPromise
  }

  globalWatcherStartPromise = axCodeWatcherRuntime.start().catch((error) => {
    globalWatcherStartPromise = null
    throw error
  })

  return globalWatcherStartPromise
}
const bootstrapAxCodeAtStartup = async (...args) => {
  await axCodeLifecycleRuntime.bootstrapAxCodeAtStartup(...args)
  scheduleAxCodeApiDetection()
  if (axCodeLifecycleState.axCodeProcess && !axCodeLifecycleState.isExternalAxCode) {
    startHealthMonitoring()
  }
  if (ENV_DESKTOP_NOTIFY) {
    void ensureGlobalWatcherStarted().catch((error) => {
      console.warn(`Global event watcher startup failed: ${error?.message || error}`)
    })
  }
}
const killProcessOnPort = (...args) => axCodeLifecycleRuntime.killProcessOnPort(...args)
const waitForPortRelease = (...args) => axCodeLifecycleRuntime.waitForPortRelease(...args)

const fetchAgentsSnapshot = (...args) => serverUtilsRuntime.fetchAgentsSnapshot(...args)
const fetchProvidersSnapshot = (...args) => serverUtilsRuntime.fetchProvidersSnapshot(...args)
const fetchModelsSnapshot = (...args) => serverUtilsRuntime.fetchModelsSnapshot(...args)
const setupProxy = (...args) => serverUtilsRuntime.setupProxy(...args)
const gracefulShutdownRuntime = createGracefulShutdownRuntime({
  process,
  shutdownTimeoutMs: SHUTDOWN_TIMEOUT,
  getExitOnShutdown: () => exitOnShutdown,
  getIsShuttingDown: () => isShuttingDown,
  setIsShuttingDown: (value) => {
    isShuttingDown = value
  },
  syncToHmrState,
  axCodeWatcherRuntime,
  sessionRuntime,
  getHealthCheckInterval: () => healthCheckInterval,
  clearHealthCheckInterval: (value) => clearInterval(value),
  getTerminalRuntime: () => terminalRuntime,
  setTerminalRuntime: (value) => {
    terminalRuntime = value
  },
  getMessageStreamRuntime: () => messageStreamRuntime,
  setMessageStreamRuntime: (value) => {
    messageStreamRuntime = value
  },
  shouldSkipAxCodeStop: () => ENV_SKIP_AX_CODE_START || isExternalAxCode,
  getAxCodePort: () => axCodePort,
  getAxCodeProcess: () => axCodeProcess,
  setAxCodeProcess: (value) => {
    axCodeProcess = value
  },
  killProcessOnPort,
  waitForPortRelease,
  getServer: () => server,
  getUiAuthController: () => uiAuthController,
  setUiAuthController: (value) => {
    uiAuthController = value
  },
  scheduledTasksRuntime,
  destroyAllClientConnections: () => {
    // Close all tracked SSE connections
    for (const client of uiNotificationClients) {
      try {
        client.end?.()
        client.socket?.destroy()
      } catch {
        /* ignore */
      }
    }
    uiNotificationClients.clear()

    for (const client of uiOpenChamberEventClients) {
      try {
        client.end?.()
        client.socket?.destroy()
      } catch {
        /* ignore */
      }
    }
    uiOpenChamberEventClients.clear()

    // Close all tracked WebSocket connections
    for (const ws of uiNotificationWsClients) {
      try {
        ws.terminate?.()
      } catch {
        /* ignore */
      }
    }
    uiNotificationWsClients.clear()
  },
})

const gracefulShutdown = (...args) => gracefulShutdownRuntime.gracefulShutdown(...args)

async function main(options = {}) {
  const port = Number.isFinite(options.port) && options.port >= 0 ? Math.trunc(options.port) : DEFAULT_PORT
  const host = typeof options.host === "string" && options.host.length > 0 ? options.host : undefined
  const attachSignals = options.attachSignals !== false
  startupDiagnosticsRuntime = createStartupDiagnosticsRuntime({
    initialSnapshot: options.startupDiagnosticsSnapshot ?? null,
    source: "web-server",
    onEvent: typeof options.onStartupDiagnostic === "function" ? options.onStartupDiagnostic : null,
  })
  recordStartupEvent(
    "web.server.bootstrap.start",
    {
      port: port === 0 ? "auto" : port,
      host: host || "default",
    },
    { source: "web-server" },
  )
  if (typeof options.exitOnShutdown === "boolean") {
    exitOnShutdown = options.exitOnShutdown
  }
  if (typeof options.onDesktopNotification === "function") {
    notificationEmitterRuntime.setOnDesktopNotification(options.onDesktopNotification)
  }
  if (typeof options.getIsWindowFocused === "function") {
    notificationTriggerRuntime.setGetIsWindowFocused(options.getIsWindowFocused)
  }

  console.log(`Starting AX Code Desktop on port ${port === 0 ? "auto" : port}`)

  // Apply login shell environment asynchronously (non-blocking).
  // Must complete before ax-code is spawned so PATH and other env vars
  // are available for binary resolution and process launch.
  await ensureLoginShellEnvSnapshotAsync()

  const app = express()
  const serverStartedAt = new Date().toISOString()
  app.set("trust proxy", "loopback, linklocal, uniquelocal")
  // ── HTTP security headers (defense-in-depth for standalone/Docker deployments) ──
  app.use((req, res, next) => {
    applySecurityHeaders(req, res)
    next()
  })
  let firstApiResponseRecorded = false
  app.use((req, res, next) => {
    if (firstApiResponseRecorded || !req.path.startsWith("/api")) {
      next()
      return
    }

    const startedAt = Date.now()
    res.once("finish", () => {
      if (firstApiResponseRecorded) return
      firstApiResponseRecorded = true
      recordStartupEvent(
        "api.first_response",
        {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Math.max(0, Date.now() - startedAt),
        },
        { source: "web-server", milestone: "api.first_response" },
      )
    })
    next()
  })
  app.use(
    compression({
      filter: (req, res) => {
        if (shouldSkipCompression(req, res)) return false
        return compression.filter(req, res)
      },
      threshold: 1024,
    }),
  )
  expressApp = app
  server = http.createServer(app)

  const uiPassword = typeof options.uiPassword === "string" ? options.uiPassword : null
  const bootstrapResult = bootstrapRuntime.setupBaseRoutes(app, {
    process,
    openchamberVersion: AX_CODE_DESKTOP_VERSION,
    runtimeName: process.env.AX_CODE_DESKTOP_RUNTIME || "web",
    serverStartedAt,
    gracefulShutdown,
    getHealthSnapshot: () => {
      const launchSpec =
        resolvedAxCodeBinary && !useWslForAxCode ? resolveManagedAxCodeLaunchSpec(resolvedAxCodeBinary) : null
      return {
        axCodePort,
        axCodeRunning: Boolean(axCodePort && isAxCodeReady && !isRestartingAxCode),
        axCodeSecureConnection: isAxCodeConnectionSecure(),
        axCodeAuthSource: axCodeAuthSource || null,
        axCodeApiPrefix: "",
        axCodeApiPrefixDetected: true,
        isAxCodeReady,
        lastAxCodeError,
        lastAxCodeLaunchDiagnostics,
        axCodeBinaryResolved: resolvedAxCodeBinary || null,
        axCodeBinarySource: resolvedAxCodeBinarySource || null,
        axCodeVersion: axCodeLifecycleState.detectedAxCodeVersion || null,
        axCodeVersionCompatibility: axCodeLifecycleState.axCodeVersionCompatibility || null,
        axCodeRuntimeHealth: axCodeLifecycleState.axCodeRuntimeHealth || null,
        axCodeLaunchBinary: launchSpec?.binary || null,
        axCodeLaunchArgs: launchSpec?.args || [],
        axCodeLaunchWrapperType: launchSpec?.wrapperType || null,
        axCodeViaWsl: useWslForAxCode,
        axCodeWslBinary: resolvedWslBinary || null,
        axCodeWslPath: resolvedWslAxCodePath || null,
        axCodeWslDistro: resolvedWslDistro || null,
        nodeBinaryResolved: resolvedNodeBinary || null,
        bunBinaryResolved: resolvedBunBinary || null,
        desktopNotifyEnabled: ENV_DESKTOP_NOTIFY,
        planModeExperimentalEnabled: PLAN_MODE_EXPERIMENT_ENABLED,
      }
    },
    getStartupDiagnosticsSnapshot: () =>
      startupDiagnosticsRuntime
        ? startupDiagnosticsRuntime.snapshot({
            sseProxy: sseProxyMetrics.snapshot(),
          })
        : { error: "Startup diagnostics are not available" },
    verboseRequestLogs: AX_CODE_DESKTOP_VERBOSE_REQUEST_LOGS,
    uiPassword,
    readSettingsFromDiskMigrated,
    ensureGlobalWatcherStarted,
    getUiSessionTokenFromRequest,
    writeSettingsToDisk,
    getUiNotificationClients: () => uiNotificationClients,
    writeSseEvent,
    sessionRuntime,
    fs,
    os,
    path,
    server,
    __dirname,
    openchamberDataDir: AX_CODE_DESKTOP_DATA_DIR,
    modelsDevApiUrl: MODELS_DEV_API_URL,
    modelsMetadataCacheTtl: MODELS_METADATA_CACHE_TTL,
    fetchFreeZenModels,
    getCachedZenModels,
    setAutoAcceptSession,
  })
  uiAuthController = bootstrapResult.uiAuthController

  await featureRoutesRuntime.registerRoutes(app, {
    crypto,
    fs,
    os,
    path,
    fsPromises,
    spawn,
    resolveGitBinaryForSpawn,
    createFsSearchRuntime: createFsSearchRuntimeFactory,
    openchamberDataDir: AX_CODE_DESKTOP_DATA_DIR,
    openchamberUserConfigRoot: AX_CODE_DESKTOP_USER_CONFIG_ROOT,
    normalizeDirectoryPath,
    resolveProjectDirectory,
    resolveOptionalProjectDirectory,
    validateDirectoryPath,
    readCustomThemesFromDisk,
    refreshAxCodeAfterConfigChange,
    getAxCodeResolutionSnapshot,
    formatSettingsResponse,
    readSettingsFromDisk,
    readSettingsFromDiskMigrated,
    persistSettings,
    sanitizeProjects,
    sanitizeSkillCatalogs,
    isUnsafeSkillRelativePath,
    buildAxCodeUrl,
    getAxCodeAuthHeaders,
    getAxCodePort: () => axCodePort,
    buildAugmentedPath,
    projectConfigRuntime,
    scheduledTasksRuntime,
    getOpenChamberEventClients: () => uiOpenChamberEventClients,
    writeSseEvent,
  })

  const previewProxyRuntime = createPreviewProxyRuntime({
    crypto,
    URL,
    createProxyMiddleware,
    responseInterceptor,
  })
  previewProxyRuntime.attach(app, {
    server,
    express,
    uiAuthController,
    isRequestOriginAllowed,
    rejectWebSocketUpgrade,
  })

  const startupPipelineResult = await startupPipelineRuntime.run({
    app,
    server,
    express,
    fs,
    path,
    uiAuthController,
    buildAugmentedPath,
    searchPathFor,
    isExecutable,
    isRequestOriginAllowed,
    rejectWebSocketUpgrade,
    buildAxCodeUrl,
    getAxCodeAuthHeaders,
    globalEventHub: globalMessageStreamHub,
    processForwardedEventPayload,
    messageStreamWsClients: uiNotificationWsClients,
    upstreamStallTimeoutMs: getUpstreamStallTimeoutMs,
    terminalHeartbeatIntervalMs: TERMINAL_INPUT_WS_HEARTBEAT_INTERVAL_MS,
    terminalRebindWindowMs: TERMINAL_INPUT_WS_REBIND_WINDOW_MS,
    terminalMaxRebindsPerWindow: TERMINAL_INPUT_WS_MAX_REBINDS_PER_WINDOW,
    validateTerminalCwd: async (req, cwd) => {
      const resolved = await resolveWorkspaceOrApprovedPathFromContext({
        req,
        targetPath: cwd,
        resolveProjectDirectory,
        readSettingsFromDiskMigrated,
        path,
        os,
        normalizeDirectoryPath,
        openchamberUserConfigRoot: AX_CODE_DESKTOP_USER_CONFIG_ROOT,
      })
      return resolved.ok ? { ok: true, cwd: resolved.resolved } : { ok: false, error: resolved.error }
    },
    setupProxy,
    scheduleAxCodeApiDetection,
    bootstrapAxCodeAtStartup,
    triggerHealthCheck,
    staticRoutesRuntime,
    process,
    gracefulShutdown,
    getSignalsAttached: () => signalsAttached,
    setSignalsAttached: (value) => {
      signalsAttached = value
    },
    syncToHmrState,
    host,
    port,
    attachSignals,
  })
  terminalRuntime = startupPipelineResult.terminalRuntime
  messageStreamRuntime = startupPipelineResult.messageStreamRuntime
  recordStartupEvent(
    "web.server.ready",
    {
      port: startupPipelineResult.activePort,
    },
    { source: "web-server" },
  )

  try {
    await scheduledTasksRuntime.start()
  } catch (error) {
    console.warn("[ScheduledTasks] Failed to start runtime:", error?.message || error)
  }

  return {
    expressApp: app,
    httpServer: server,
    getPort: () => startupPipelineResult.activePort,
    getAxCodePort: () => axCodePort,
    getQuitRiskStatus: () => ({
      scheduledTasks: scheduledTasksRuntime.getStatus(),
    }),
    getStartupDiagnostics: () =>
      startupDiagnosticsRuntime
        ? startupDiagnosticsRuntime.snapshot({
            sseProxy: sseProxyMetrics.snapshot(),
          })
        : null,
    recordDesktopStartupEvent: (event) => {
      if (!event || typeof event.name !== "string") return null
      return recordStartupEvent(event.name, event.details ?? {}, {
        source: typeof event.source === "string" ? event.source : "electron-main",
        atEpochMs: Number.isFinite(event.atEpochMs) ? event.atEpochMs : undefined,
        once: REPEATABLE_DESKTOP_STARTUP_EVENTS.has(event.name) ? false : undefined,
        milestone: event.name,
      })
    },
    isReady: () => isAxCodeReady,
    restartAxCode: () => restartAxCode(),
    stop: (shutdownOptions = {}) => gracefulShutdown({ exitProcess: shutdownOptions.exitProcess ?? false }),
  }
}

runCliEntryIfMain({
  process,
  currentFilename: __filename,
  parseServeCliOptions,
  defaultPort: DEFAULT_PORT,
  setExitOnShutdown: (value) => {
    exitOnShutdown = value
  },
  startServer: main,
})

export { gracefulShutdown, setupProxy, restartAxCode, main as startWebUiServer, parseServeCliOptions as parseArgs }
