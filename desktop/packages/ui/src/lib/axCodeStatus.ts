import { useSessionUIStore } from "@/sync/session-ui-store"
import { getSyncSessions } from "@/sync/sync-refs"
import { useUIStore } from "@/stores/useUIStore"
import { API_ENDPOINTS, HTTP_DEFAULTS, API_PATHS } from "./http"
import { isPlainRecord } from "./record"

declare const __APP_VERSION__: string | undefined

type ProbeResult = {
  ok: boolean
  status: number
  elapsedMs: number
  summary: string
}

type OpenChamberHealthSnapshot = {
  axCodePort?: unknown
  axCodeRunning?: unknown
  axCodeSecureConnection?: unknown
  axCodeAuthSource?: unknown
  isAxCodeReady?: unknown
  lastAxCodeError?: unknown
  lastAxCodeLaunchDiagnostics?: unknown
  axCodeBinaryResolved?: unknown
  axCodeBinarySource?: unknown
  axCodeLaunchBinary?: unknown
  axCodeLaunchArgs?: unknown
  axCodeLaunchWrapperType?: unknown
  nodeBinaryResolved?: unknown
  bunBinaryResolved?: unknown
}

type OpenChamberAxCodeResolution = {
  configured?: unknown
  resolved?: unknown
  resolvedDir?: unknown
  source?: unknown
  detectedNow?: unknown
  detectedSourceNow?: unknown
  launchBinary?: unknown
  launchArgs?: unknown
  launchWrapperType?: unknown
  node?: unknown
  bun?: unknown
}

const getCurrentDirectory = (): string => {
  const state = useSessionUIStore.getState()
  const currentSessionId = state.currentSessionId
  if (!currentSessionId) return ""
  const sessions = getSyncSessions()
  const session = sessions.find((s) => s.id === currentSessionId)
  return typeof session?.directory === "string" ? session.directory : ""
}

const safeFetch = async (input: string, timeoutMs = 6000): Promise<ProbeResult> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()

  try {
    const resp = await fetch(input, {
      method: HTTP_DEFAULTS.method.get,
      headers: HTTP_DEFAULTS.headers.acceptJson,
      signal: controller.signal,
    })

    const elapsedMs = Date.now() - startedAt
    const contentType = resp.headers.get("content-type") || ""
    const lower = contentType.toLowerCase()
    const isJson = lower.includes("json") && !lower.includes("text/html")

    let summary = ""
    if (isJson) {
      const json = await resp.json().catch(() => null)
      if (Array.isArray(json)) {
        summary = `json[array] len=${json.length}`
      } else if (json && typeof json === "object") {
        const keys = Object.keys(json).slice(0, 8)
        summary = `json[object] keys=${keys.join(",")}${Object.keys(json).length > keys.length ? ",…" : ""}`
      } else {
        summary = `json[${typeof json}]`
      }
    } else {
      summary = contentType ? `content-type=${contentType}` : "no content-type"
    }

    return { ok: resp.ok && isJson, status: resp.status, elapsedMs, summary }
  } catch (error) {
    const elapsedMs = Date.now() - startedAt
    const isAbort =
      controller.signal.aborted ||
      (error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted")))
    const message = isAbort ? `timeout after ${timeoutMs}ms` : error instanceof Error ? error.message : String(error)
    return { ok: false, status: 0, elapsedMs, summary: `error=${message}` }
  } finally {
    clearTimeout(timeout)
  }
}

const formatIso = (timestamp: number | null | undefined): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return "(n/a)"
  try {
    return new Date(timestamp).toISOString()
  } catch {
    return "(invalid)"
  }
}

const normalizePort = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value)
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === "string")
}

const formatUnknown = (value: unknown, fallback = "(n/a)"): string => {
  if (typeof value === "string") return value.trim() || fallback
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  return fallback
}

const formatLaunchRuntime = (wrapperType: string, node: string, bun: string): string => {
  if (wrapperType === "node-shebang" || wrapperType === "node-launcher") {
    return node ? `node (${node})` : "node"
  }
  if (wrapperType === "bun-shebang") {
    return bun ? `bun (${bun})` : "bun"
  }
  if (wrapperType) {
    return wrapperType
  }
  return "direct executable"
}

export const buildAxCodeStatusReport = async (): Promise<string> => {
  const now = new Date()
  const appVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "(unknown)"
  const platform = typeof navigator !== "undefined" ? navigator.userAgent : "(no navigator)"
  const directory = getCurrentDirectory()
  const eventStreamStatus = useUIStore.getState().eventStreamStatus
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const apiBase = origin ? `${origin.replace(/\/+$/, "")}${API_PATHS.base}/` : ""

  const openChamberHealth: OpenChamberHealthSnapshot | null = await (async () => {
    if (!origin) return null
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      const resp = await fetch(`${origin.replace(/\/+$/, "")}${API_ENDPOINTS.debug.rootHealth}`, {
        method: HTTP_DEFAULTS.method.get,
        headers: HTTP_DEFAULTS.headers.acceptJson,
        signal: controller.signal,
      })
      if (!resp.ok) return null
      const json = (await resp.json().catch(() => null)) as unknown
      if (!json || typeof json !== "object" || Array.isArray(json)) return null
      return json as OpenChamberHealthSnapshot
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  })()

  const openChamberAxCodeResolutionResult: {
    data: OpenChamberAxCodeResolution | null
    status: number | null
    error: string | null
  } = (await (async () => {
    if (!origin) return null
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 7000)
    try {
      const resp = await fetch(`${origin.replace(/\/+$/, "")}${API_ENDPOINTS.config.axCodeResolution}`, {
        method: HTTP_DEFAULTS.method.get,
        headers: HTTP_DEFAULTS.headers.acceptJson,
        signal: controller.signal,
      })
      const contentType = resp.headers.get("content-type") || "(none)"
      if (!resp.ok) {
        return { data: null, status: resp.status, error: `http ${resp.status} content-type=${contentType}` }
      }
      const raw = await resp.text()
      let json: unknown = null
      try {
        json = JSON.parse(raw)
      } catch {
        const snippet = raw.replace(/\s+/g, " ").slice(0, 120)
        return {
          data: null,
          status: resp.status,
          error: `invalid json content-type=${contentType} body=${snippet || "(empty)"}`,
        }
      }
      if (!json || typeof json !== "object" || Array.isArray(json)) {
        return { data: null, status: resp.status, error: `invalid json-shape content-type=${contentType}` }
      }
      return { data: json as OpenChamberAxCodeResolution, status: resp.status, error: null }
    } catch (error) {
      return {
        data: null,
        status: null,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      clearTimeout(timeout)
    }
  })()) || { data: null, status: null, error: null }

  const buildProbeUrl = (pathname: string, includeDirectory = true): string | null => {
    if (!apiBase) return null
    const url = new URL(pathname.replace(/^\/+/, ""), apiBase)
    if (includeDirectory && directory) {
      url.searchParams.set("directory", directory)
    }
    return url.toString()
  }

  const probeTargets: Array<{ label: string; path: string; includeDirectory?: boolean; timeoutMs?: number }> = [
    { label: "health", path: API_ENDPOINTS.debug.globalHealth, includeDirectory: false },
    { label: "config", path: API_ENDPOINTS.debug.config, includeDirectory: true },
    { label: "providers", path: API_ENDPOINTS.debug.configProviders, includeDirectory: true },
    { label: "agents", path: API_ENDPOINTS.debug.agent, includeDirectory: true, timeoutMs: 12000 },
    { label: "commands", path: API_ENDPOINTS.debug.command, includeDirectory: true, timeoutMs: 10000 },
    { label: "project", path: API_ENDPOINTS.debug.projectCurrent, includeDirectory: true },
    { label: "path", path: API_ENDPOINTS.debug.path, includeDirectory: true },
    { label: "sessions", path: API_ENDPOINTS.debug.session, includeDirectory: true, timeoutMs: 12000 },
    { label: "sessionStatus", path: API_ENDPOINTS.debug.sessionStatus, includeDirectory: true },
  ]

  const probes = apiBase
    ? await Promise.all(
        probeTargets.map(async (entry) => {
          const url = buildProbeUrl(entry.path, entry.includeDirectory !== false)
          if (!url) return { label: entry.label, url: "(none)", result: null as ProbeResult | null }
          const result = await safeFetch(url, typeof entry.timeoutMs === "number" ? entry.timeoutMs : undefined)
          return { label: entry.label, url, result }
        }),
      )
    : []

  const lines: string[] = []
  lines.push(`Time: ${now.toISOString()}`)
  lines.push(`AX Code version: ${appVersion}`)
  lines.push(`Runtime: ${origin || "(unknown)"} (api=${origin ? `${origin}${API_PATHS.base}` : "(unknown)"})`)
  lines.push(`Event stream: ${eventStreamStatus}`)
  lines.push(`Directory: ${directory || "(none)"}`)
  lines.push(`Platform: ${platform}`)

  const runtimeAxCodePort = normalizePort(openChamberHealth?.axCodePort)
  lines.push(`ax-code runtime port: ${runtimeAxCodePort ?? "(unknown)"}`)
  if (typeof openChamberHealth?.axCodeRunning === "boolean") {
    lines.push(`ax-code runtime running: ${openChamberHealth.axCodeRunning ? "yes" : "no"}`)
  }
  if (typeof openChamberHealth?.axCodeSecureConnection === "boolean") {
    lines.push(`Secure ax-code connection: ${openChamberHealth.axCodeSecureConnection ? "true" : "false"}`)
  }
  if (typeof openChamberHealth?.axCodeAuthSource === "string" && openChamberHealth.axCodeAuthSource.trim()) {
    lines.push(`ax-code auth source: ${openChamberHealth.axCodeAuthSource}`)
  }

  if (typeof window !== "undefined") {
    const injected = (window as unknown as { __AX_CODE_DESKTOP_MACOS_MAJOR__?: unknown })
      .__AX_CODE_DESKTOP_MACOS_MAJOR__
    if (typeof injected === "number" && Number.isFinite(injected) && injected > 0) {
      lines.push(`macOS major: ${injected}`)
    }
  }

  const isLikelyMac = /Mac OS X|Macintosh/.test(platform)
  if (isLikelyMac) {
    lines.push("")
    lines.push("ax-code CLI resolution:")

    const launchDiagnostics = isPlainRecord(openChamberHealth?.lastAxCodeLaunchDiagnostics)
      ? openChamberHealth.lastAxCodeLaunchDiagnostics
      : null
    const actualLaunchArgs = normalizeStringArray(launchDiagnostics?.args)
    const openChamberAxCodeResolution = openChamberAxCodeResolutionResult.data
    const configured =
      openChamberAxCodeResolution && typeof openChamberAxCodeResolution.configured === "string"
        ? openChamberAxCodeResolution.configured
        : null
    const resolved =
      openChamberAxCodeResolution && typeof openChamberAxCodeResolution.resolved === "string"
        ? openChamberAxCodeResolution.resolved
        : openChamberHealth && typeof openChamberHealth.axCodeBinaryResolved === "string"
          ? openChamberHealth.axCodeBinaryResolved
          : ""
    const resolvedDir =
      openChamberAxCodeResolution && typeof openChamberAxCodeResolution.resolvedDir === "string"
        ? openChamberAxCodeResolution.resolvedDir
        : ""
    const source =
      openChamberAxCodeResolution && typeof openChamberAxCodeResolution.source === "string"
        ? openChamberAxCodeResolution.source
        : openChamberHealth && typeof openChamberHealth.axCodeBinarySource === "string"
          ? openChamberHealth.axCodeBinarySource
          : ""
    const configuredLaunchBinary =
      openChamberAxCodeResolution && typeof openChamberAxCodeResolution.launchBinary === "string"
        ? openChamberAxCodeResolution.launchBinary
        : openChamberHealth && typeof openChamberHealth.axCodeLaunchBinary === "string"
          ? openChamberHealth.axCodeLaunchBinary
          : ""
    const configuredLaunchWrapperType =
      openChamberAxCodeResolution && typeof openChamberAxCodeResolution.launchWrapperType === "string"
        ? openChamberAxCodeResolution.launchWrapperType
        : openChamberHealth && typeof openChamberHealth.axCodeLaunchWrapperType === "string"
          ? openChamberHealth.axCodeLaunchWrapperType
          : ""
    const configuredLaunchArgs =
      openChamberAxCodeResolution && Array.isArray(openChamberAxCodeResolution.launchArgs)
        ? normalizeStringArray(openChamberAxCodeResolution.launchArgs)
        : normalizeStringArray(openChamberHealth?.axCodeLaunchArgs)
    const node =
      openChamberAxCodeResolution && typeof openChamberAxCodeResolution.node === "string"
        ? openChamberAxCodeResolution.node
        : openChamberHealth && typeof openChamberHealth.nodeBinaryResolved === "string"
          ? openChamberHealth.nodeBinaryResolved
          : ""
    const bun =
      openChamberAxCodeResolution && typeof openChamberAxCodeResolution.bun === "string"
        ? openChamberAxCodeResolution.bun
        : openChamberHealth && typeof openChamberHealth.bunBinaryResolved === "string"
          ? openChamberHealth.bunBinaryResolved
          : ""
    const detectedNow =
      openChamberAxCodeResolution && typeof openChamberAxCodeResolution.detectedNow === "string"
        ? openChamberAxCodeResolution.detectedNow
        : ""
    const detectedSourceNow =
      openChamberAxCodeResolution && typeof openChamberAxCodeResolution.detectedSourceNow === "string"
        ? openChamberAxCodeResolution.detectedSourceNow
        : ""

    if (configured !== null) {
      lines.push(`- configured: ${configured.trim().length === 0 ? "(cleared)" : configured}`)
    }

    if (resolved) {
      const dir = resolvedDir || (resolved.includes("/") ? resolved.split("/").slice(0, -1).join("/") || "/" : "")
      lines.push(`- ax-code: ${resolved}${dir ? ` (dir=${dir})` : ""}`)
    } else {
      lines.push("- ax-code: (n/a)")
    }

    lines.push(`- source: ${source || "(n/a)"}`)
    if (detectedNow) {
      lines.push(`- detected-now: ${detectedNow}`)
      lines.push(`- detected-source: ${detectedSourceNow || "(n/a)"}`)
    }
    if (launchDiagnostics) {
      lines.push(`- launched-at: ${formatUnknown(launchDiagnostics.launchedAt)}`)
      lines.push(`- launch: ${formatUnknown(launchDiagnostics.binary)} ${actualLaunchArgs.join(" ")}`.trim())
      lines.push(`- cwd: ${formatUnknown(launchDiagnostics.cwd)}`)
      lines.push(`- wrapper: ${formatUnknown(launchDiagnostics.wrapperType)}`)
      lines.push(`- runtime: ${formatLaunchRuntime(formatUnknown(launchDiagnostics.wrapperType, ""), node, bun)}`)
      lines.push(`- PATH entries: ${formatUnknown(launchDiagnostics.pathEntryCount, "(unknown)")}`)
      lines.push(
        `- shell env: ${formatUnknown(launchDiagnostics.hasShellEnv, "(unknown)")} (${formatUnknown(launchDiagnostics.shellEnvKeysCount, "?")} keys)`,
      )
    } else {
      lines.push(`- launch-binary: ${configuredLaunchBinary || "(n/a)"}`)
      lines.push(`- launch-wrapper: ${configuredLaunchWrapperType || "(n/a)"}`)
      lines.push(`- launch-args: ${configuredLaunchArgs.length ? configuredLaunchArgs.join(" ") : "(none)"}`)
      lines.push(`- runtime: ${formatLaunchRuntime(configuredLaunchWrapperType || "", node, bun)}`)
    }
    if (!openChamberAxCodeResolution && openChamberAxCodeResolutionResult.error) {
      lines.push(`- resolution-endpoint: ${openChamberAxCodeResolutionResult.error}`)
    }
  }

  lines.push("")
  if (probes.length) {
    lines.push("ax-code API probes:")
    for (const probe of probes) {
      if (!probe.result) {
        lines.push(`- ${probe.label}: (no url)`)
        continue
      }
      const { ok, status, elapsedMs, summary } = probe.result
      const suffix = ok ? "" : ` url=${probe.url}`
      lines.push(`- ${probe.label}: ${ok ? "ok" : "fail"} status=${status} time=${elapsedMs}ms ${summary}${suffix}`)
    }
  } else {
    lines.push("ax-code API probes: (skipped)")
  }

  lines.push("")
  lines.push(`Generated: ${formatIso(Date.now())}`)
  return lines.join("\n")
}

export const showAxCodeStatus = async (): Promise<void> => {
  const text = await buildAxCodeStatusReport()
  const ui = useUIStore.getState()
  ui.setAxCodeStatusText(text)
  ui.setAxCodeStatusDialogOpen(true)
}
