import { DiagnosticLog } from "@/debug/diagnostic-log"

type StartupTraceData = Record<string, unknown>
type StartupSpanEndData = Record<string, unknown> | undefined

let startupStartedAt: number | undefined
const startupOnceEvents = new Set<string>()

function startupElapsedMs() {
  if (startupStartedAt === undefined) return undefined
  return Math.max(0, Date.now() - startupStartedAt)
}

function withElapsed(data: StartupTraceData = {}) {
  const elapsedMs = startupElapsedMs()
  if (elapsedMs === undefined) return data
  return { ...data, elapsedMs }
}

export function beginTuiStartup(data: StartupTraceData = {}) {
  if (startupStartedAt !== undefined) return
  startupStartedAt = Date.now()
  DiagnosticLog.recordProcess("tui.startup.begin", withElapsed(data))
}

export function recordTuiStartup(eventType: string, data: StartupTraceData = {}) {
  DiagnosticLog.recordProcess(eventType, withElapsed(data))
}

export function recordTuiStartupOnce(eventType: string, data: StartupTraceData = {}) {
  if (startupOnceEvents.has(eventType)) return
  startupOnceEvents.add(eventType)
  recordTuiStartup(eventType, data)
}

export function createTuiStartupSpan(eventType: string, data: StartupTraceData = {}) {
  const startedAt = Date.now()
  let closed = false

  recordTuiStartup(`${eventType}.start`, data)

  return (endData: StartupSpanEndData = {}) => {
    if (closed) return
    closed = true
    recordTuiStartup(`${eventType}.end`, {
      ...data,
      ...endData,
      durationMs: Math.max(0, Date.now() - startedAt),
    })
  }
}
