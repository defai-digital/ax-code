import type { AxCodeAppRuntimeConfig } from "./config"
import type { AppEventStreamDiagnostics, AppDesktopDiagnostics } from "./diagnostics"

type ProbeResult = {
  ok: boolean
  status: number
  elapsedMs: number
  summary: string
}

const safeFetch = async (input: string, timeoutMs = 6000): Promise<ProbeResult> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()

  try {
    const resp = await fetch(input, {
      method: "GET",
      headers: { Accept: "application/json" },
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
        const keys = Object.keys(json as object).slice(0, 8)
        summary = `json[object] keys=${keys.join(",")}${Object.keys(json as object).length > keys.length ? ",…" : ""}`
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
    const message = isAbort
      ? `timeout after ${timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : String(error)
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

function appBuildVersion(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
  return env.VITE_AX_CODE_APP_VERSION ?? "0.0.0"
}

export const buildAxCodeStatusReport = async (input: {
  config: AxCodeAppRuntimeConfig
  eventStream: AppEventStreamDiagnostics
  desktop?: AppDesktopDiagnostics
}): Promise<string> => {
  const now = new Date()
  const appVersion = appBuildVersion()
  const platform = typeof navigator !== "undefined" ? navigator.userAgent : "(no navigator)"
  const directory = input.config.mode === "live" ? input.config.directory : undefined

  const apiBase = input.config.mode === "live" ? input.config.baseUrl.replace(/\/+$/, "") : null

  const buildProbeUrl = (pathname: string, includeDirectory = true): string | null => {
    if (!apiBase) return null
    try {
      const base = apiBase.endsWith("/") ? apiBase : `${apiBase}/`
      const url = new URL(pathname.replace(/^\/+/, ""), base)
      if (includeDirectory && directory) {
        url.searchParams.set("directory", directory)
      }
      return url.toString()
    } catch {
      return `${apiBase}/${pathname.replace(/^\/+/, "")}`
    }
  }

  const probeTargets: Array<{
    label: string
    path: string
    includeDirectory?: boolean
    timeoutMs?: number
  }> = [
    { label: "health", path: "/health", includeDirectory: false },
    { label: "config", path: "/config", includeDirectory: true },
    { label: "providers", path: "/config/providers", includeDirectory: true },
    { label: "session", path: "/session", includeDirectory: true, timeoutMs: 10000 },
    { label: "sessionStatus", path: "/session/status", includeDirectory: true },
    { label: "mcp", path: "/mcp/status", includeDirectory: true },
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
  lines.push(`ax-code version: ${appVersion}`)
  lines.push(
    `Runtime: ${input.config.mode === "live" ? (apiBase ?? "(unknown)") : "fixture"} (mode=${input.config.mode})`,
  )
  lines.push(`Event stream: ${input.eventStream.status}`)
  lines.push(`Event stream events applied: ${input.eventStream.appliedEvents}`)
  if (input.eventStream.lastEventAt) {
    lines.push(`Last event: ${formatIso(input.eventStream.lastEventAt)}`)
  }
  if (input.eventStream.error) {
    lines.push(`Event stream error: ${input.eventStream.error}`)
  }
  lines.push(`Directory: ${directory ?? "(none)"}`)
  lines.push(`Platform: ${platform}`)

  lines.push("")
  if (input.desktop?.available) {
    lines.push("Desktop backend:")
    const backend = input.desktop.backend
    if (backend) {
      lines.push(`- status: ${backend.status ?? "(unknown)"}`)
      lines.push(`- mode: ${backend.mode ?? "(unknown)"}`)
      if (backend.url) lines.push(`- url: ${backend.url}`)
      if (typeof backend.logLines === "number") lines.push(`- log lines: ${backend.logLines}`)
      if (backend.loopbackOnly !== undefined) lines.push(`- loopback-only: ${backend.loopbackOnly ? "yes" : "no"}`)
      if (backend.error) lines.push(`- error: ${backend.error}`)
    }
    const caps = input.desktop.capabilities
    if (caps) {
      if (caps.app?.version) lines.push(`- app version: ${caps.app.version}`)
      if (caps.platform) lines.push(`- platform: ${caps.platform}`)
      if (caps.arch) lines.push(`- arch: ${caps.arch}`)
      const rel = caps.release
      if (rel) {
        lines.push(`- release: ${rel.status ?? "unknown"} / ${rel.packageTarget ?? "dev"} / ${rel.version ?? "?"}`)
        if (rel.signed !== undefined) lines.push(`- signed: ${rel.signed ? "yes" : "no"}`)
        if (rel.notarized !== undefined) lines.push(`- notarized: ${rel.notarized ? "yes" : "no"}`)
      }
      const update = caps.update
      if (update) {
        lines.push(`- update status: ${update.status ?? "(none)"}`)
        if (update.latestVersion) lines.push(`- latest version: ${update.latestVersion}`)
      }
    }
    for (const err of input.desktop.errors) {
      lines.push(`- desktop-error: ${err}`)
    }
  } else {
    lines.push("Desktop backend: not available (browser mode)")
  }

  lines.push("")
  if (probes.length > 0) {
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
    lines.push("ax-code API probes: (skipped — fixture mode)")
  }

  lines.push("")
  lines.push(`Generated: ${formatIso(Date.now())}`)
  return lines.join("\n")
}
