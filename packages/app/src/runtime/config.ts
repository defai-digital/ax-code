export type AxCodeAppFeatureConfig = {
  terminalPane?: boolean
  browserPane?: boolean
  filePane?: boolean
}

export type AxCodeAppRuntimeConfig =
  | {
      mode: "fixture"
      features?: AxCodeAppFeatureConfig
    }
  | {
      mode: "live"
      baseUrl: string
      headers?: Record<string, string>
      directory?: string
      features?: AxCodeAppFeatureConfig
      sessionLimit?: number
      scheduledTaskExecution?: {
        owner: "desktop-sidecar" | "attached-backend" | "external"
        stopsOnAppQuit: boolean
      }
    }

export type AxCodeRuntimeNetworkScope = "fixture" | "loopback" | "remote" | "invalid"

const RUNTIME_CONFIG_STORAGE_KEY = "ax-code:runtime-config"

declare global {
  interface Window {
    __AX_CODE_APP_CONFIG__?: AxCodeAppRuntimeConfig
    axCodeDesktop?: {
      invoke(name: "external.open", payload: { url: string }): Promise<unknown>
      invoke(name: "path.reveal", payload: { path: string }): Promise<unknown>
      invoke(name: "editor.open", payload: { path: string; line?: number; column?: number }): Promise<unknown>
      invoke(
        name: "notification.show",
        payload: { title: string; body?: string; source?: "scheduled-task"; silent?: boolean },
      ): Promise<unknown>
      invoke(name: "diagnostics.read", payload: Record<string, never>): Promise<unknown>
      invoke(name: "diagnostics.exportLogs", payload: { includeBackendLogs?: boolean }): Promise<unknown>
      invoke(name: "platform.capabilities", payload: Record<string, never>): Promise<unknown>
      invoke(name: "release.checkUpdate", payload: Record<string, never>): Promise<unknown>
      invoke(name: "release.downloadUpdate", payload: Record<string, never>): Promise<unknown>
      invoke(name: "release.openDownloadedUpdate", payload: { artifactPath: string }): Promise<unknown>
      invoke(name: "dialog.chooseDirectory", payload: { title?: string }): Promise<unknown>
      invoke(name: "backend.attach", payload: { baseUrl: string; authHeader?: string }): Promise<unknown>
      invoke(name: "backend.start", payload: { directory: string; port?: number }): Promise<unknown>
      invoke(name: "app.config", payload: Record<string, never>): Promise<unknown>
      onMenuCommand?(
        callback: (
          command:
            | "session.new"
            | "composer.focus"
            | "composer.run"
            | "composer.queue"
            | "diagnostics.refresh"
            | "diagnostics.status",
        ) => void,
      ): () => void
    }
  }
}

export function getRuntimeConfig(globalScope: { window?: Window } | undefined = globalThis) {
  const fromWindow = globalScope?.window?.__AX_CODE_APP_CONFIG__
  if (fromWindow) return fromWindow
  const fromStorage = readStoredRuntimeConfig(globalScope?.window)
  if (fromStorage) return fromStorage

  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
  const baseUrl = env.VITE_AX_CODE_BACKEND_URL
  if (typeof baseUrl === "string" && baseUrl.length > 0) {
    return {
      mode: "live",
      baseUrl,
      directory: env.VITE_AX_CODE_DIRECTORY,
      features: runtimeFeatureConfig(env),
    } satisfies AxCodeAppRuntimeConfig
  }

  return { mode: "fixture" } satisfies AxCodeAppRuntimeConfig
}

export function storeRuntimeConfigForReload(
  config: AxCodeAppRuntimeConfig,
  globalScope: { window?: Window } | undefined = globalThis,
) {
  const window = globalScope?.window
  if (!window) return
  window.__AX_CODE_APP_CONFIG__ = config
  try {
    window.sessionStorage?.setItem(RUNTIME_CONFIG_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Reload still works for the current page through __AX_CODE_APP_CONFIG__.
  }
}

export function isAppFeatureEnabled(config: AxCodeAppRuntimeConfig, feature: keyof AxCodeAppFeatureConfig) {
  return config.features?.[feature] !== false
}

export function runtimeNetworkScope(config: AxCodeAppRuntimeConfig): AxCodeRuntimeNetworkScope {
  if (config.mode === "fixture") return "fixture"
  try {
    const url = new URL(config.baseUrl)
    if ((url.protocol === "http:" || url.protocol === "https:") && isLoopbackHost(url.hostname)) return "loopback"
    return "remote"
  } catch {
    return "invalid"
  }
}

function runtimeFeatureConfig(env: Record<string, string | undefined>): AxCodeAppFeatureConfig | undefined {
  const features: AxCodeAppFeatureConfig = {}
  setBooleanEnvFeature(features, "terminalPane", env.VITE_AX_CODE_TERMINAL_PANE)
  setBooleanEnvFeature(features, "browserPane", env.VITE_AX_CODE_BROWSER_PANE)
  setBooleanEnvFeature(features, "filePane", env.VITE_AX_CODE_FILE_PANE)
  return Object.keys(features).length > 0 ? features : undefined
}

function readStoredRuntimeConfig(window: Window | undefined) {
  try {
    const raw = window?.sessionStorage?.getItem(RUNTIME_CONFIG_STORAGE_KEY)
    if (!raw) return undefined
    return normalizeStoredRuntimeConfig(JSON.parse(raw))
  } catch {
    return undefined
  }
}

function normalizeStoredRuntimeConfig(value: unknown): AxCodeAppRuntimeConfig | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (record.mode === "fixture") return { mode: "fixture" }
  if (record.mode !== "live" || typeof record.baseUrl !== "string" || record.baseUrl.length === 0) return undefined
  return {
    mode: "live",
    baseUrl: record.baseUrl,
    ...(stringRecord(record.headers) ? { headers: stringRecord(record.headers) } : {}),
    ...(typeof record.directory === "string" ? { directory: record.directory } : {}),
    ...(featureRecord(record.features) ? { features: featureRecord(record.features) } : {}),
    ...(typeof record.sessionLimit === "number" ? { sessionLimit: record.sessionLimit } : {}),
    ...(scheduledTaskExecutionRecord(record.scheduledTaskExecution)
      ? { scheduledTaskExecution: scheduledTaskExecutionRecord(record.scheduledTaskExecution) }
      : {}),
  }
}

function stringRecord(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function featureRecord(value: unknown): AxCodeAppFeatureConfig | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const features: AxCodeAppFeatureConfig = {}
  if (typeof record.terminalPane === "boolean") features.terminalPane = record.terminalPane
  if (typeof record.browserPane === "boolean") features.browserPane = record.browserPane
  if (typeof record.filePane === "boolean") features.filePane = record.filePane
  return Object.keys(features).length > 0 ? features : undefined
}

function scheduledTaskExecutionRecord(value: unknown): Extract<
  AxCodeAppRuntimeConfig,
  { mode: "live" }
>["scheduledTaskExecution"] {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (
    (record.owner === "desktop-sidecar" || record.owner === "attached-backend" || record.owner === "external") &&
    typeof record.stopsOnAppQuit === "boolean"
  ) {
    return { owner: record.owner, stopsOnAppQuit: record.stopsOnAppQuit }
  }
  return undefined
}

function setBooleanEnvFeature(
  features: AxCodeAppFeatureConfig,
  key: keyof AxCodeAppFeatureConfig,
  value: string | undefined,
) {
  const parsed = parseBooleanFeature(value)
  if (parsed !== undefined) features[key] = parsed
}

function parseBooleanFeature(value: string | undefined) {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false
  return undefined
}

function isLoopbackHost(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]"
}
