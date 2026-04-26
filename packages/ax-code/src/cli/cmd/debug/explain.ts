/**
 * debug explain — AI-readable diagnostic report
 *
 * Analyzes recent session errors and produces a structured report with:
 * - Root cause analysis
 * - Impact scope
 * - Suggested fix
 * - Risk level
 *
 * This is the product surface that turns structured logging into
 * actionable debugging intelligence.
 */

import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Dirent } from "fs"
import { Global } from "../../../global"
import { cmd } from "../cmd"

interface DiagnosticEntry {
  service: string
  command: string
  errorCode: string
  message: string
  count: number
  lastSeen: string
  durationMs?: number
}

interface DiagnosticReport {
  timestamp: string
  version: string
  platform: string
  sessionCount: number
  errorCount: number
  warningCount: number
  issues: DiagnosticIssue[]
  health: "healthy" | "degraded" | "unhealthy"
  summary: string
}

export interface DiagnosticIssue {
  severity: "critical" | "warning" | "info"
  category: string
  title: string
  rootCause: string
  impact: string
  suggestedFix: string
  riskLevel: "high" | "medium" | "low"
  occurrences: number
}

export interface ReplayDebugRecord {
  time: string
  sessionID: string
  eventType: string
  event: Record<string, unknown>
}

export interface ProcessDebugRecord {
  time: string
  pid?: number
  eventType: string
  data: Record<string, unknown>
}

type StandardLogScan = {
  errorEntries: DiagnosticEntry[]
  totalErrors: number
  totalWarnings: number
  sessionIDs: Set<string>
}

const HANG_STALL_THRESHOLD_MS = 30_000
const TUI_STARTUP_STALL_THRESHOLD_MS = 15_000

function sortIssues(issues: DiagnosticIssue[]) {
  const sev = { critical: 0, warning: 1, info: 2 }
  return [...issues].sort((a, b) => sev[a.severity] - sev[b.severity])
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1_000)
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  return input as Record<string, unknown>
}

function asString(input: unknown): string | undefined {
  return typeof input === "string" ? input : undefined
}

function asNumber(input: unknown): number | undefined {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined
}

function asBoolean(input: unknown): boolean | undefined {
  return typeof input === "boolean" ? input : undefined
}

function toISOTime(input: unknown): string {
  if (input == null) return ""
  const date = typeof input === "number" ? new Date(input) : new Date(String(input))
  return Number.isFinite(date.getTime()) ? date.toISOString() : ""
}

function explainErrorText(error: unknown) {
  if (!error) return "Unknown error"
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object") {
    const record = error as Record<string, unknown>
    return (
      asString(record.message) ??
      asString(asRecord(record.error)?.message) ??
      asString(record.reason) ??
      JSON.stringify(error)
    )
  }
  return String(error)
}

function summarizeCounts(entries: Array<{ label: string; count: number }>, limit = 3) {
  const top = [...entries]
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit)
  if (top.length === 0) return "unknown"
  return top.map((entry) => `${entry.label} (${entry.count}x)`).join(", ")
}

export function classifyErrors(entries: DiagnosticEntry[]): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = []

  const byService = new Map<string, DiagnosticEntry[]>()
  for (const entry of entries) {
    const key = entry.service
    const list = byService.get(key) ?? []
    list.push(entry)
    byService.set(key, list)
  }

  const lspErrors = byService.get("lsp") ?? []
  if (lspErrors.length > 0) {
    const broken = lspErrors.filter((e) => e.errorCode === "MARKED_BROKEN" || e.errorCode === "SPAWN_FAILED")
    if (broken.length > 0) {
      issues.push({
        severity: "warning",
        category: "LSP",
        title: "Language server failures detected",
        rootCause: `${broken.length} LSP server(s) marked broken or failed to spawn. Common causes: missing language server binary, incompatible version, or resource exhaustion.`,
        impact:
          "Code intelligence features (symbol lookup, references, diagnostics) may be degraded for affected languages.",
        suggestedFix:
          "Run `ax-code debug lsp` to check server status. Ensure language servers are installed (for example `npm i -g typescript-language-server`).",
        riskLevel: "medium",
        occurrences: broken.reduce((sum, e) => sum + e.count, 0),
      })
    }
  }

  const mcpErrors = byService.get("mcp") ?? []
  if (mcpErrors.length > 0) {
    const connectErrors = mcpErrors.filter((e) => e.command?.includes("connect") || e.errorCode === "CREATE_FAILED")
    if (connectErrors.length > 0) {
      issues.push({
        severity: "warning",
        category: "MCP",
        title: "MCP server connection failures",
        rootCause: `${connectErrors.length} MCP server connection(s) failed. The server may be offline, misconfigured, or the transport type is incorrect.`,
        impact: "External tools and resources from affected MCP servers are unavailable.",
        suggestedFix:
          "Check MCP server configuration in ax-code.json. Verify the server is running with `ax-code debug config`.",
        riskLevel: "medium",
        occurrences: connectErrors.reduce((sum, e) => sum + e.count, 0),
      })
    }
  }

  const toolErrors = byService.get("tool") ?? []
  if (toolErrors.length > 0) {
    const timeouts = toolErrors.filter((e) => e.errorCode === "TIMEOUT" || (e.durationMs && e.durationMs > 30_000))
    if (timeouts.length > 0) {
      issues.push({
        severity: "warning",
        category: "Tool",
        title: "Tool execution timeouts",
        rootCause: `${timeouts.length} tool call(s) timed out or ran excessively long. Common causes: network issues, large file operations, or stuck processes.`,
        impact: "AI agent responses may be incomplete or delayed.",
        suggestedFix:
          "Check network connectivity. For bash tool timeouts, inspect the structured hang metadata or increase AX_CODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS.",
        riskLevel: "low",
        occurrences: timeouts.reduce((sum, e) => sum + e.count, 0),
      })
    }
    const otherToolErrors = toolErrors.filter((e) => !timeouts.includes(e))
    if (otherToolErrors.length > 0) {
      const topToolProblems = summarizeCounts(
        otherToolErrors.map((entry) => ({
          label: entry.command ? `${entry.command}: ${entry.message || entry.errorCode || "unknown"}` : entry.message || entry.errorCode || "unknown",
          count: entry.count,
        })),
        2,
      )
      issues.push({
        severity: "info",
        category: "Tool",
        title: `Tool errors (${
          otherToolErrors
            .map((e) => e.errorCode)
            .filter(Boolean)
            .join(", ") || "various"
        })`,
        rootCause: `${otherToolErrors.length} tool error(s) detected. Most frequent: ${topToolProblems}. These may be transient or related to specific file or permission states.`,
        impact: "Individual tool calls failed but the session likely recovered via retry or an alternative approach.",
        suggestedFix: "Review errors with `ax-code trace --errors`. Most tool errors are self-correcting.",
        riskLevel: "low",
        occurrences: otherToolErrors.reduce((sum, e) => sum + e.count, 0),
      })
    }
  }

  const configErrors = byService.get("config") ?? []
  if (configErrors.length > 0) {
    issues.push({
      severity: configErrors.some((e) => e.errorCode === "PARSE_FAILED") ? "critical" : "info",
      category: "Config",
      title: "Configuration loading issues",
      rootCause: `${configErrors.length} config-related error(s). May indicate malformed ax-code.json, missing plugin dependencies, or permission issues.`,
      impact: "Some features or plugins may not load correctly.",
      suggestedFix: "Run `ax-code doctor` to check config status. Validate ax-code.json syntax.",
      riskLevel: configErrors.some((e) => e.errorCode === "PARSE_FAILED") ? "high" : "low",
      occurrences: configErrors.reduce((sum, e) => sum + e.count, 0),
    })
  }

  const sessionErrors = byService.get("session") ?? []
  if (sessionErrors.length > 0) {
    issues.push({
      severity: "warning",
      category: "Session",
      title: "Session processing errors",
      rootCause: `${sessionErrors.length} session error(s). May indicate LLM provider issues, context overflow, or processing failures.`,
      impact: "One or more AI interactions may have failed or produced incomplete results.",
      suggestedFix: "Check provider status with `ax-code providers`. Review session with `ax-code replay <sessionID>`.",
      riskLevel: "medium",
      occurrences: sessionErrors.reduce((sum, e) => sum + e.count, 0),
    })
  }

  const providerErrors = byService.get("provider") ?? []
  if (providerErrors.length > 0) {
    issues.push({
      severity: "critical",
      category: "Provider",
      title: "LLM provider errors",
      rootCause: `${providerErrors.length} provider error(s). Common causes: invalid API key, rate limiting, network issues, or provider outage.`,
      impact: "AI capabilities are degraded or unavailable.",
      suggestedFix: "Check API key with `ax-code doctor`. Verify provider status at the provider's status page.",
      riskLevel: "high",
      occurrences: providerErrors.reduce((sum, e) => sum + e.count, 0),
    })
  }

  return sortIssues(issues)
}

export function scanStandardLogLines(lines: string[], isJson: boolean, session?: string): StandardLogScan {
  const errorEntries: DiagnosticEntry[] = []
  let totalErrors = 0
  let totalWarnings = 0
  const sessionIDs = new Set<string>()
  const errorMap = new Map<string, DiagnosticEntry>()

  for (const line of lines) {
    let parsed: Record<string, unknown>
    if (isJson) {
      try {
        parsed = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
    } else {
      const match = line.match(/^(\w+)\s+/)
      if (!match) continue
      parsed = { level: match[1] === "ERROR" ? 50 : match[1] === "WARN" ? 40 : 30 }
      const pairs = line.matchAll(/(\w+)=(\S+)/g)
      for (const [, key, val] of pairs) {
        parsed[key] = val
      }
      parsed.msg = line.slice(line.indexOf(match[0]) + match[0].length)
    }

    const level =
      typeof parsed.level === "number"
        ? parsed.level
        : parsed.level === "ERROR"
          ? 50
          : parsed.level === "WARN"
            ? 40
            : 30

    if (level >= 50) totalErrors++
    if (level >= 40 && level < 50) totalWarnings++

    const sessionID = asString(parsed.sessionId) ?? asString(parsed.sessionID)
    if (sessionID) sessionIDs.add(sessionID)

    if (session && sessionID !== session) continue

    if (level >= 50 || parsed.status === "error") {
      const service = asString(parsed.service) || "unknown"
      const command = asString(parsed.command) || asString(parsed.toolName) || ""
      const errorCode = asString(parsed.errorCode) || ""
      const message = (asString(parsed.errorMessage) || String(parsed.msg || "")).slice(0, 200)
      const key = `${service}:${command || "general"}:${errorCode || "general"}`
      const existing = errorMap.get(key)
      if (existing) {
        existing.count++
        existing.lastSeen = toISOTime(parsed.time)
        continue
      }
      errorMap.set(key, {
        service,
        command,
        errorCode,
        message,
        count: 1,
        lastSeen: toISOTime(parsed.time),
        durationMs: asNumber(parsed.durationMs),
      })
    }
  }

  errorEntries.push(...errorMap.values())
  return { errorEntries, totalErrors, totalWarnings, sessionIDs }
}

export function parseReplayEventLines(lines: string[], session?: string): ReplayDebugRecord[] {
  const records: ReplayDebugRecord[] = []
  for (const line of lines) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (parsed.kind !== "replay.event") continue
    const event = asRecord(parsed.event)
    if (!event) continue
    const sessionID = asString(parsed.sessionID) ?? asString(event.sessionID)
    if (!sessionID) continue
    if (session && sessionID !== session) continue
    const eventType = asString(parsed.eventType) ?? asString(event.type) ?? "unknown"
    records.push({
      time: asString(parsed.time) ?? new Date(0).toISOString(),
      sessionID,
      eventType,
      event,
    })
  }
  return records.sort((a, b) => a.time.localeCompare(b.time))
}

export function parseProcessEventLines(lines: string[], session?: string): ProcessDebugRecord[] {
  const records: ProcessDebugRecord[] = []
  for (const line of lines) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (parsed.kind !== "process.event") continue
    const data = asRecord(parsed.data)
    if (!data) continue
    const sessionID = asString(data.sessionID)
    if (session && sessionID && sessionID !== session) continue
    records.push({
      time: asString(parsed.time) ?? new Date(0).toISOString(),
      pid: asNumber(parsed.pid),
      eventType: asString(parsed.eventType) ?? "unknown",
      data,
    })
  }
  return records.sort((a, b) => a.time.localeCompare(b.time))
}

export function classifyReplayIssues(records: ReplayDebugRecord[], now = Date.now()): DiagnosticIssue[] {
  if (records.length === 0) return []

  const bySession = new Map<string, ReplayDebugRecord[]>()
  for (const record of records) {
    const list = bySession.get(record.sessionID) ?? []
    list.push(record)
    bySession.set(record.sessionID, list)
  }

  const issues: DiagnosticIssue[] = []

  for (const [sessionID, sessionRecords] of bySession) {
    let ended = false
    const activeCalls = new Map<string, { tool: string; timeMs: number }>()
    const bashTimeouts: Array<{ timeoutMs?: number; idleSinceOutputMs?: number; signal?: string }> = []

    for (const record of sessionRecords) {
      const timeMs = Date.parse(record.time)
      if (record.eventType === "session.end") {
        ended = true
        continue
      }
      if (record.eventType === "tool.call") {
        const callID = asString(record.event.callID)
        if (!callID) continue
        activeCalls.set(callID, {
          tool: asString(record.event.tool) || "unknown",
          timeMs,
        })
        continue
      }
      if (record.eventType !== "tool.result") continue

      const callID = asString(record.event.callID)
      if (callID) activeCalls.delete(callID)

      if (asString(record.event.tool) !== "bash") continue
      const metadata = asRecord(record.event.metadata)
      const hang = asRecord(metadata?.hang)
      if (asBoolean(hang?.timedOut) !== true) continue

      const lastOutputAt = asNumber(hang?.lastOutputAt)
      bashTimeouts.push({
        timeoutMs: asNumber(hang?.timeoutMs),
        idleSinceOutputMs:
          lastOutputAt !== undefined && Number.isFinite(timeMs) ? Math.max(0, timeMs - lastOutputAt) : undefined,
        signal: asString(hang?.signal),
      })
    }

    if (bashTimeouts.length > 0) {
      const latest = bashTimeouts[bashTimeouts.length - 1]!
      const timeoutLabel = latest.timeoutMs !== undefined ? formatDuration(latest.timeoutMs) : "the configured timeout"
      const idleLabel =
        latest.idleSinceOutputMs !== undefined
          ? ` Last output arrived ${formatDuration(latest.idleSinceOutputMs)} before termination.`
          : ""
      const signalLabel = latest.signal ? ` Final signal: ${latest.signal}.` : ""
      issues.push({
        severity: "warning",
        category: "Hang",
        title: "Bash command timed out during a session",
        rootCause: `Session ${sessionID} recorded ${bashTimeouts.length} bash timeout${bashTimeouts.length === 1 ? "" : "s"}. The latest command exceeded ${timeoutLabel}.${idleLabel}${signalLabel}`,
        impact: "The session can look hung even though the runtime eventually killed the command.",
        suggestedFix:
          "Inspect the bash command and its timeout budget first. If the stall repeats in the same module, run `race_scan` and `lifecycle_scan` to look for leaked listeners, timers, or conflicting mutations.",
        riskLevel: "medium",
        occurrences: bashTimeouts.length,
      })
    }

    const lastRecord = sessionRecords[sessionRecords.length - 1]
    const lastEventMs = Date.parse(lastRecord?.time ?? "")
    if (!ended && Number.isFinite(lastEventMs)) {
      const idleMs = Math.max(0, now - lastEventMs)
      if (idleMs >= HANG_STALL_THRESHOLD_MS) {
        if (activeCalls.size > 0) {
          const [active] = [...activeCalls.values()].sort((a, b) => a.timeMs - b.timeMs)
          issues.push({
            severity: "warning",
            category: "Hang",
            title: `Session appears stalled in ${active.tool}`,
            rootCause: `Session ${sessionID} has no terminal session.end event, and tool ${active.tool} has been active without a matching tool.result for ${formatDuration(idleMs)}.`,
            impact: "The agent likely stopped making progress while waiting on that tool call.",
            suggestedFix:
              active.tool === "bash"
                ? "Inspect the child command, confirm it exits under the current timeout, and use the structured bash hang metadata to see whether output stopped before kill."
                : "Inspect the last tool call in the session replay and confirm the tool emits a matching result or error on every path.",
            riskLevel: active.tool === "bash" ? "high" : "medium",
            occurrences: 1,
          })
        } else {
          issues.push({
            severity: "info",
            category: "Hang",
            title: "Session appears idle without a terminal event",
            rootCause: `Session ${sessionID} has no session.end event and has emitted no replay activity for ${formatDuration(idleMs)}.`,
            impact: "The session may have stalled between steps or while waiting on the provider stream.",
            suggestedFix:
              "Inspect the final replay events for that session. If the same workflow repeatedly idles between steps, check provider latency and add narrower reproduction around the last successful step.",
            riskLevel: "low",
            occurrences: 1,
          })
        }
      }
    }
  }

  return sortIssues(issues)
}

function summarizeProcessFailures(records: ProcessDebugRecord[]) {
  const counts = new Map<string, number>()
  for (const record of records) {
    const method = asString(record.data.method)
    const pathname = asString(record.data.pathname)
    const status = asNumber(record.data.status)
    const statusLabel =
      status !== undefined ? ` ${status}` : record.eventType === "tui.native.httpException" ? " exception" : ""
    const label = [method, pathname].filter(Boolean).join(" ") + statusLabel
    counts.set(label.trim() || record.eventType, (counts.get(label.trim() || record.eventType) ?? 0) + 1)
  }
  return summarizeCounts([...counts.entries()].map(([label, count]) => ({ label, count })))
}

export function classifyProcessIssues(records: ProcessDebugRecord[], now = Date.now()): DiagnosticIssue[] {
  if (records.length === 0) return []

  const issues: DiagnosticIssue[] = []
  const startupFailures: ProcessDebugRecord[] = []
  const promptFailures: ProcessDebugRecord[] = []
  const sessionErrors: ProcessDebugRecord[] = []
  const runtimeErrors: ProcessDebugRecord[] = []
  const httpFailures: ProcessDebugRecord[] = []
  const stateBursts: ProcessDebugRecord[] = []
  const effectLoops: ProcessDebugRecord[] = []
  const workerStalls: ProcessDebugRecord[] = []
  const renderLoops: ProcessDebugRecord[] = []

  let threadStartedAt: number | undefined
  let workerSpawnedAt: number | undefined
  let startupBeginAt: number | undefined
  let renderDispatchedAt: number | undefined
  let appMountedAt: number | undefined
  let bootstrapStartedAt: number | undefined
  let bootstrapCoreReadyAt: number | undefined
  let bootstrapReadyAt: number | undefined
  let nativeStartedAt: number | undefined
  let firstPaintAt: number | undefined
  let startupResolvedAt: number | undefined
  let stoppedAt: number | undefined
  let transportMode: string | undefined
  let lastPromptSubmittedAt: number | undefined
  let lastHeartbeatMs: number | undefined
  let rendererProfile:
    | {
        profile?: string
        testing?: boolean
        screenMode?: string
        exitOnCtrlC?: boolean
        useThread?: boolean
      }
    | undefined

  for (const record of records) {
    const timeMs = Date.parse(record.time)
    switch (record.eventType) {
      case "tui.threadStarted":
        if (threadStartedAt === undefined && Number.isFinite(timeMs)) threadStartedAt = timeMs
        break
      case "tui.workerSpawned":
        if (workerSpawnedAt === undefined && Number.isFinite(timeMs)) workerSpawnedAt = timeMs
        break
      case "tui.startup.begin":
        if (startupBeginAt === undefined && Number.isFinite(timeMs)) startupBeginAt = timeMs
        break
      case "tui.startup.rendererProfile":
        rendererProfile = {
          profile: asString(record.data.profile),
          testing: asBoolean(record.data.testing),
          screenMode: asString(record.data.screenMode),
          exitOnCtrlC: asBoolean(record.data.exitOnCtrlC),
          useThread: asBoolean(record.data.useThread),
        }
        break
      case "tui.startup.renderDispatched":
        if (renderDispatchedAt === undefined && Number.isFinite(timeMs)) renderDispatchedAt = timeMs
        break
      case "tui.startup.appMounted":
        if (appMountedAt === undefined && Number.isFinite(timeMs)) appMountedAt = timeMs
        break
      case "tui.startup.bootstrap.start":
        if (bootstrapStartedAt === undefined && Number.isFinite(timeMs)) bootstrapStartedAt = timeMs
        break
      case "tui.startup.bootstrapCoreReady":
        if (bootstrapCoreReadyAt === undefined && Number.isFinite(timeMs)) bootstrapCoreReadyAt = timeMs
        break
      case "tui.startup.bootstrap.end":
        if (bootstrapReadyAt === undefined && Number.isFinite(timeMs)) bootstrapReadyAt = timeMs
        break
      case "tui.threadTransportSelected":
        transportMode = asString(record.data.mode) ?? transportMode
        break
      case "tui.native.started":
        if (nativeStartedAt === undefined && Number.isFinite(timeMs)) nativeStartedAt = timeMs
        break
      case "tui.native.firstPaint":
        if (firstPaintAt === undefined && Number.isFinite(timeMs)) firstPaintAt = timeMs
        break
      case "tui.native.startupResolved":
        if (startupResolvedAt === undefined && Number.isFinite(timeMs)) startupResolvedAt = timeMs
        break
      case "tui.native.startupFailed":
        startupFailures.push(record)
        break
      case "tui.native.promptSubmitted":
        if (Number.isFinite(timeMs)) lastPromptSubmittedAt = timeMs
        break
      case "tui.native.promptAccepted":
        lastPromptSubmittedAt = undefined
        break
      case "tui.native.promptFailed":
        promptFailures.push(record)
        lastPromptSubmittedAt = undefined
        break
      case "tui.native.sessionError":
        sessionErrors.push(record)
        lastPromptSubmittedAt = undefined
        break
      case "tui.native.stopped":
        lastPromptSubmittedAt = undefined
        if (Number.isFinite(timeMs)) stoppedAt = timeMs
        break
      case "tui.native.httpError":
      case "tui.native.httpException":
        httpFailures.push(record)
        break
      case "tui.threadError":
      case "tui.workerError":
      case "tui.workerHandshakeFailed":
      case "tui.workerMessageError":
      case "tui.appImportFailed":
      case "worker.eventStreamError":
      case "worker.unhandledRejection":
      case "worker.uncaughtException":
      case "uncaughtException":
      case "unhandledRejection":
        runtimeErrors.push(record)
        break
      case "tui.state.heartbeat":
      case "tui.state.final":
        if (Number.isFinite(timeMs)) lastHeartbeatMs = timeMs
        break
      case "tui.state.burstDetected":
        stateBursts.push(record)
        break
      case "tui.effect.loopDetected":
        effectLoops.push(record)
        break
      case "tui.worker.mainStalled":
        workerStalls.push(record)
        break
      case "tui.render.loopDetected":
        renderLoops.push(record)
        break
    }
  }

  if (rendererProfile?.testing) {
    issues.push({
      severity: "critical",
      category: "TUI",
      title: "TUI renderer is misconfigured in testing mode",
      rootCause: `Renderer profile \`${rendererProfile.profile ?? "unknown"}\` recorded \`testing: true\` with screen mode \`${rendererProfile.screenMode ?? "unknown"}\`. OpenTUI testing mode is not a production compatibility setting and can suppress real terminal output entirely.`,
      impact: "The process can finish startup work normally while the user sees a blank or apparently hung terminal because no real frame is painted.",
      suggestedFix:
        "Disable OpenTUI testing mode in production renderer options. Keep compatibility changes scoped to screen mode, input features, or threading instead of using the test harness.",
      riskLevel: "high",
      occurrences: 1,
    })
  }

  if (startupFailures.length > 0) {
    const latest = startupFailures[startupFailures.length - 1]
    issues.push({
      severity: "critical",
      category: "TUI",
      title: "TUI startup failed before reaching a usable session",
      rootCause: explainErrorText(latest?.data.error),
      impact: "The TUI can open to a blank or partial frame and never reach a stable interactive state.",
      suggestedFix:
        "Run the same flow with `--debug`, then inspect `process.jsonl` around `tui.native.startupFailed` and the preceding `tui.native.http*` events to see which request or state transition failed first.",
      riskLevel: "high",
      occurrences: startupFailures.length,
    })
  }

  if (runtimeErrors.length > 0) {
    const counts = new Map<string, number>()
    for (const record of runtimeErrors) {
      counts.set(record.eventType, (counts.get(record.eventType) ?? 0) + 1)
    }
    issues.push({
      severity: "critical",
      category: "TUI",
      title: "TUI thread or worker reported runtime errors",
      rootCause: `Structured process diagnostics recorded ${summarizeCounts([...counts.entries()].map(([label, count]) => ({ label, count })))}.`,
      impact: "The renderer, worker bridge, or event stream may have stopped processing input and updates reliably.",
      suggestedFix:
        "Inspect the matching worker/thread events in `process.jsonl`. Start with `tui.workerHandshakeFailed`, `worker.eventStreamError`, `tui.threadError`, or `tui.workerError`, then trace backward to the last successful startup marker.",
      riskLevel: "high",
      occurrences: runtimeErrors.length,
    })
  }

  if (httpFailures.length > 0) {
    issues.push({
      severity: "warning",
      category: "TUI",
      title: "TUI backend requests failed",
      rootCause: `TUI requests recorded ${httpFailures.length} backend failure${httpFailures.length === 1 ? "" : "s"} across ${summarizeProcessFailures(httpFailures)}.`,
      impact:
        "Session loading, workspace switching, dialogs, or prompt submission can look empty, stale, or stuck even when the renderer itself is still running.",
      suggestedFix:
        transportMode === "external"
          ? "Check the external server path first: confirm the chosen host/port is reachable and the debug log contains a matching `worker.serverStarted` or upstream server start."
          : "Check the internal worker transport first: confirm the worker stayed alive, then inspect the first failing pathname in `process.jsonl` and reproduce that endpoint outside the renderer.",
      riskLevel: "medium",
      occurrences: httpFailures.length,
    })
  }

  if (promptFailures.length > 0) {
    issues.push({
      severity: "warning",
      category: "TUI",
      title: "TUI prompt submission failed",
      rootCause: `The native renderer recorded ${promptFailures.length} prompt failure${promptFailures.length === 1 ? "" : "s"} after local input was accepted.`,
      impact:
        "From the user's perspective, Enter appears to work, but the prompt never reaches a live session or returns a backend error.",
      suggestedFix:
        "Inspect `tui.native.promptFailed` together with nearby `tui.native.http*` events. That will tell you whether session creation, prompt_async, or a follow-up session refresh failed.",
      riskLevel: "medium",
      occurrences: promptFailures.length,
    })
  }

  if (sessionErrors.length > 0) {
    issues.push({
      severity: "warning",
      category: "TUI",
      title: "TUI received session error events",
      rootCause: `The renderer observed ${sessionErrors.length} session.error event${sessionErrors.length === 1 ? "" : "s"} from the backend.`,
      impact:
        "The transcript can stop updating and the UI falls back to a system notice instead of normal assistant progress.",
      suggestedFix:
        "Correlate the `session.error` event with replay logs for the same session, then inspect the last successful tool or provider event before the error surfaced in the TUI.",
      riskLevel: "medium",
      occurrences: sessionErrors.length,
    })
  }

  if (!startupFailures.length && !stoppedAt) {
    const startupAnchorAt = threadStartedAt ?? workerSpawnedAt ?? startupBeginAt
    if (
      threadStartedAt !== undefined &&
      nativeStartedAt === undefined &&
      now - threadStartedAt >= TUI_STARTUP_STALL_THRESHOLD_MS
    ) {
      issues.push({
        severity: "warning",
        category: "TUI",
        title: "TUI never reached renderer startup",
        rootCause: `The thread started, but no matching \`tui.native.started\` event arrived within ${formatDuration(TUI_STARTUP_STALL_THRESHOLD_MS)}.`,
        impact:
          "The process likely stalled before the renderer booted, often in worker startup, transport setup, or renderer dispatch.",
        suggestedFix:
          "Inspect the gap between `tui.threadStarted`, `tui.workerTargetResolved`, `tui.workerSpawned`, `tui.workerReady`, `tui.threadTransportSelected`, and any `tui.startup.*` events. The first missing transition marks the failing startup boundary.",
        riskLevel: "medium",
        occurrences: 1,
      })
    } else if (
      nativeStartedAt !== undefined &&
      firstPaintAt === undefined &&
      now - nativeStartedAt >= TUI_STARTUP_STALL_THRESHOLD_MS
    ) {
      issues.push({
        severity: "critical",
        category: "TUI",
        title: "TUI started but never painted a first frame",
        rootCause: `The native renderer emitted \`tui.native.started\` but no \`tui.native.firstPaint\` within ${formatDuration(TUI_STARTUP_STALL_THRESHOLD_MS)}.`,
        impact: "Users can see a blank or frozen terminal before any visible UI is rendered.",
        suggestedFix:
          "Inspect the renderer bootstrap path around `runNativeTuiSlice`, especially terminal initialization and any synchronous work before the first `paint()` call.",
        riskLevel: "high",
        occurrences: 1,
      })
    } else if (
      nativeStartedAt !== undefined &&
      startupResolvedAt === undefined &&
      now - nativeStartedAt >= HANG_STALL_THRESHOLD_MS
    ) {
      issues.push({
        severity: "warning",
        category: "TUI",
        title: "TUI startup never resolved",
        rootCause: `The native renderer started but did not reach \`tui.native.startupResolved\` within ${formatDuration(HANG_STALL_THRESHOLD_MS)}.`,
        impact:
          "The app can stay stuck in startup state with missing transcript, session metadata, or blocking overlays.",
        suggestedFix:
          "Inspect startup-related `tui.native.http*` failures first. If none exist, trace the async startup path for session resolution, transcript loading, and blocking-state hydration.",
        riskLevel: "medium",
        occurrences: 1,
      })
    } else if (
      startupAnchorAt !== undefined &&
      renderDispatchedAt === undefined &&
      now - startupAnchorAt >= TUI_STARTUP_STALL_THRESHOLD_MS
    ) {
      issues.push({
        severity: "warning",
        category: "TUI",
        title: "TUI never reached renderer dispatch",
        rootCause: `Startup began, but no matching \`tui.startup.renderDispatched\` event arrived within ${formatDuration(TUI_STARTUP_STALL_THRESHOLD_MS)}.`,
        impact:
          "The process likely stalled before the Solid/OpenTUI render tree was handed to the renderer, often in worker startup, config resolution, or renderer setup.",
        suggestedFix:
          "Inspect the gap between `tui.workerSpawned`, `tui.startup.begin`, and `tui.startup.renderDispatched`. The first missing transition marks the failing startup boundary.",
        riskLevel: "medium",
        occurrences: 1,
      })
    } else if (renderDispatchedAt !== undefined && appMountedAt === undefined && now - renderDispatchedAt >= TUI_STARTUP_STALL_THRESHOLD_MS) {
      issues.push({
        severity: "warning",
        category: "TUI",
        title: "TUI render dispatched but app never mounted",
        rootCause: `The renderer dispatch path started, but no matching \`tui.startup.appMounted\` event arrived within ${formatDuration(TUI_STARTUP_STALL_THRESHOLD_MS)}.`,
        impact:
          "The renderer accepted the root, but the app tree never reached its first mounted lifecycle, which can leave the terminal blank or partially initialized.",
        suggestedFix:
          "Inspect synchronous work between `renderTui(...)` and the first app mount, including lazy route imports, provider initialization, and any renderer bootstrap hooks.",
        riskLevel: "medium",
        occurrences: 1,
      })
    } else if (
      bootstrapStartedAt !== undefined &&
      bootstrapReadyAt === undefined &&
      now - bootstrapStartedAt >= HANG_STALL_THRESHOLD_MS
    ) {
      issues.push({
        severity: "warning",
        category: "TUI",
        title: "TUI startup bootstrap never completed",
        rootCause: `The app mounted, but \`tui.startup.bootstrap.end\` never arrived within ${formatDuration(HANG_STALL_THRESHOLD_MS)}.`,
        impact:
          "The shell can render, but startup state stays incomplete, leaving session lists, route hydration, or provider-backed UI in a half-ready state.",
        suggestedFix:
          "Inspect the gap between `tui.startup.bootstrap.start`, `tui.startup.bootstrapCoreReady`, and `tui.startup.bootstrap.end` together with nearby worker request failures.",
        riskLevel: "medium",
        occurrences: 1,
      })
    }
  }

  if (lastPromptSubmittedAt !== undefined && !stoppedAt && now - lastPromptSubmittedAt >= HANG_STALL_THRESHOLD_MS) {
    issues.push({
      severity: "warning",
      category: "TUI",
      title: "TUI prompt submission appears stalled",
      rootCause: `A prompt was submitted, but no matching accept/fail terminal event arrived for ${formatDuration(now - lastPromptSubmittedAt)}.`,
      impact:
        "Users can believe the model is thinking while the prompt is actually wedged between the renderer and backend.",
      suggestedFix:
        "Inspect the `tui.native.promptSubmitted` event together with nearby `tui.native.http*`, `session.status`, and replay events to see whether the stall happened before or after the backend accepted the prompt.",
      riskLevel: "medium",
      occurrences: 1,
    })
  }

  if (stateBursts.length > 0) {
    const latest = stateBursts[stateBursts.length - 1]
    const data = latest?.data ?? {}
    const action = asString(data.topAction) ?? "unknown"
    const commits = asNumber(data.topCount) ?? asNumber(data.commits) ?? 0
    const windowMs = asNumber(data.windowMs) ?? 500
    issues.push({
      severity: "critical",
      category: "TUI",
      title: "TUI reducer is cycling on a single action",
      rootCause: `The state store recorded ${stateBursts.length} burst event${stateBursts.length === 1 ? "" : "s"}; the latest shows action \`${action}\` committed ${commits} times in ${windowMs}ms. That rate is only reachable from a reactive-loop (an effect dispatches the same action that triggered it).`,
      impact:
        "The main thread spins in a synchronous reducer→listener→dispatch loop. The UI appears frozen even after the backend session has finished, because the event loop never yields.",
      suggestedFix: `Look at the \`tui.state.heartbeat\` record immediately before the first burst — its \`entries\` ring buffer shows the last ~500 actions and whether each actually changed state. If the burst action keeps producing \`changed: true\` but the payload is structurally identical, stabilize the reducer branch for \`${action}\` so it returns the prior reference when nothing meaningful changed.`,
      riskLevel: "high",
      occurrences: stateBursts.length,
    })
  }

  if (effectLoops.length > 0) {
    const byLabel = new Map<string, { runs: number; count: number }>()
    for (const record of effectLoops) {
      const label = asString(record.data.label) ?? "unknown"
      const runs = asNumber(record.data.runs) ?? 0
      const entry = byLabel.get(label) ?? { runs: 0, count: 0 }
      entry.runs = Math.max(entry.runs, runs)
      entry.count++
      byLabel.set(label, entry)
    }
    const worst = [...byLabel.entries()].sort((a, b) => b[1].runs - a[1].runs)[0]
    const worstLabel = worst?.[0] ?? "unknown"
    const worstRuns = worst?.[1].runs ?? 0
    issues.push({
      severity: "critical",
      category: "TUI",
      title: "TUI reactive effect is cycling",
      rootCause: `Effect \`${worstLabel}\` ran ${worstRuns} times inside a 1s window. Tracer alerts fired ${effectLoops.length} time${effectLoops.length === 1 ? "" : "s"} across ${byLabel.size} label${byLabel.size === 1 ? "" : "s"}. A reactive effect executing that fast is only reachable from a feedback loop — the effect writes (directly or indirectly) to a signal it reads.`,
      impact:
        "The main thread spins in a synchronous Solid effect→signal→effect chain. The event loop never yields, so input, rendering, and IPC are all frozen even while the backend session may be running normally.",
      suggestedFix: `Open the label \`${worstLabel}\` — it matches a \`tracedEffect(label, fn)\` call site in the TUI source. Audit what the effect writes and which of its reads are derived from those writes. Stabilize the write (skip if value is deep-equal to prior) or narrow the dependency.`,
      riskLevel: "high",
      occurrences: effectLoops.length,
    })
  }

  if (renderLoops.length > 0) {
    const latest = renderLoops[renderLoops.length - 1]
    const renders = asNumber(latest?.data.renders) ?? 0
    const windowMs = asNumber(latest?.data.windowMs) ?? 1_000
    const stack = Array.isArray(latest?.data.stack)
      ? (latest!.data.stack as unknown[]).filter((line): line is string => typeof line === "string").slice(0, 8)
      : []
    const stackBlock =
      stack.length > 0 ? `\n\nCaller stack at first burst:\n${stack.map((line) => `    ${line}`).join("\n")}` : ""
    issues.push({
      severity: "critical",
      category: "TUI",
      title: "TUI renderer is repainting in a tight loop",
      rootCause: `opentui's renderer.requestRender() was called ${renders} times in ${windowMs}ms (recorded ${renderLoops.length} time${renderLoops.length === 1 ? "" : "s"}). A render rate that high implies a callback above the renderer is requesting paints synchronously without yielding — likely a SolidJS render-side effect that mutates a signal it depends on, or a hot loop inside opentui's own event pipeline.${stackBlock}`,
      impact:
        "The main thread spins inside the render→paint→render path. Solid effects, store dispatches, and IPC are all starved.",
      suggestedFix:
        stack.length > 0
          ? "Read the caller stack above — the topmost user frame names the component or render path that's spawning the bursts. Stabilize that callsite (memoize, narrow dependencies, or move work out of render) and re-test."
          : "If a `tui.effect.loopDetected` record appears alongside, the labeled effect is the trigger. Otherwise the loop is below SolidJS — sample the process and trace what's calling `requestRender` synchronously, or temporarily wrap more components' render bodies with diagnostic logging.",
      riskLevel: "high",
      occurrences: renderLoops.length,
    })
  }

  if (workerStalls.length > 0) {
    const latest = workerStalls[workerStalls.length - 1]
    const gap = asNumber(latest?.data.gapMs) ?? 0
    const lastPing = asString(latest?.data.lastPingAt)
    issues.push({
      severity: "critical",
      category: "TUI",
      title: "TUI main thread stalled (worker watchdog)",
      rootCause: `The worker thread's liveness check missed ${workerStalls.length} main-thread ping${workerStalls.length === 1 ? "" : "s"}; the latest gap was ${formatDuration(gap)}${lastPing ? ` since the last ping at ${lastPing}` : ""}. Worker timers kept firing, so the main thread event loop is the one blocked.`,
      impact:
        "The TUI renderer cannot process input, paint frames, or consume backend events. User sees a frozen UI.",
      suggestedFix:
        "Correlate the first `tui.worker.mainStalled` record with the preceding `tui.state.heartbeat` ring buffer and any `tui.effect.loopDetected` entries to name the stuck path. If no effect label triggered, the loop is outside the Solid reactive system (likely opentui's render layer).",
      riskLevel: "high",
      occurrences: workerStalls.length,
    })
  }

  if (
    lastHeartbeatMs !== undefined &&
    !stoppedAt &&
    now - lastHeartbeatMs >= HANG_STALL_THRESHOLD_MS
  ) {
    issues.push({
      severity: "critical",
      category: "TUI",
      title: "TUI state heartbeat stopped",
      rootCause: `The state store heartbeat last landed ${formatDuration(now - lastHeartbeatMs)} ago. Heartbeats run on a 1s interval timer; a missing heartbeat means the TUI event loop is blocked.`,
      impact:
        "The TUI is unresponsive to input, rendering, and IPC. Either the main thread is in a sync JS loop or it has crashed without emitting an exit record.",
      suggestedFix:
        "Correlate with nearby `tui.state.burstDetected` records to name the guilty action. If no burst record exists, the loop bypasses the store (likely an unhooked SolidJS effect) — sample the process and compare the frame-pattern to the store's reducer path.",
      riskLevel: "high",
      occurrences: 1,
    })
  }

  return sortIssues(issues)
}

async function latestFileInDirs(dirs: string[], matcher: (name: string) => boolean): Promise<string | undefined> {
  let best: { path: string; mtimeMs: number } | undefined
  for (const dir of dirs) {
    const entries = await fs.readdir(dir).catch(() => [] as string[])
    for (const entry of entries) {
      if (!matcher(entry)) continue
      const file = path.join(dir, entry)
      const stat = await fs.stat(file).catch(() => undefined)
      if (!stat?.isFile()) continue
      if (!best || stat.mtimeMs > best.mtimeMs) best = { path: file, mtimeMs: stat.mtimeMs }
    }
  }
  return best?.path
}

async function latestDebugDirs(): Promise<string[]> {
  const out = new Map<string, number>()
  const addDir = async (dir: string | undefined) => {
    if (!dir) return
    const resolved = path.resolve(dir)
    const stat = await fs.stat(resolved).catch(() => undefined)
    if (!stat?.isDirectory()) return
    out.set(resolved, stat.mtimeMs)
  }

  await addDir(process.env["AX_CODE_DEBUG_DIR"])

  const defaultBase = path.join(os.tmpdir(), "ax-code-log")
  const entries = await fs.readdir(defaultBase, { withFileTypes: true }).catch(() => [] as Array<Dirent>)
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    await addDir(path.join(defaultBase, entry.name))
  }

  return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([dir]) => dir)
}

async function loadStandardLogs(session?: string): Promise<StandardLogScan> {
  const debugDirs = await latestDebugDirs()
  const logDirs = [
    ...new Set([process.env["AX_CODE_DEBUG_DIR"], Global.Path.log, ...debugDirs].filter(Boolean) as string[]),
  ]
  const logFile =
    (await latestFileInDirs(logDirs, (name) => name.endsWith(".json.log"))) ??
    (await latestFileInDirs(logDirs, (name) => name.endsWith(".log") && !name.endsWith(".json.log")))

  if (!logFile) {
    return {
      errorEntries: [],
      totalErrors: 0,
      totalWarnings: 0,
      sessionIDs: new Set<string>(),
    }
  }

  const content = await fs.readFile(logFile, "utf8").catch(() => "")
  if (!content) {
    return {
      errorEntries: [],
      totalErrors: 0,
      totalWarnings: 0,
      sessionIDs: new Set<string>(),
    }
  }

  return scanStandardLogLines(content.split("\n").filter(Boolean), logFile.endsWith(".json.log"), session)
}

async function loadReplayRecords(session?: string): Promise<ReplayDebugRecord[]> {
  const dirs = await latestDebugDirs()
  for (const dir of dirs) {
    const file = path.join(dir, "events.jsonl")
    const content = await fs.readFile(file, "utf8").catch(() => "")
    if (!content) continue
    const records = parseReplayEventLines(content.split("\n").filter(Boolean), session)
    if (records.length > 0) return records
  }
  return []
}

async function loadProcessRecords(session?: string): Promise<ProcessDebugRecord[]> {
  const dirs = await latestDebugDirs()
  for (const dir of dirs) {
    const file = path.join(dir, "process.jsonl")
    const content = await fs.readFile(file, "utf8").catch(() => "")
    if (!content) continue
    const records = parseProcessEventLines(content.split("\n").filter(Boolean), session)
    if (records.length > 0) return records
  }
  return []
}

export const ExplainCommand = cmd({
  command: "explain",
  describe: "generate AI-readable diagnostic report from recent logs",
  builder: (yargs) =>
    yargs
      .option("json", {
        describe: "output as JSON for machine consumption",
        type: "boolean",
        default: false,
      })
      .option("session", {
        describe: "analyze a specific session",
        type: "string",
      }),
  handler: async (args) => {
    const [standard, replayRecords, processRecords] = await Promise.all([
      loadStandardLogs(args.session),
      loadReplayRecords(args.session),
      loadProcessRecords(args.session),
    ])
    const replayIssues = classifyReplayIssues(replayRecords)
    const processIssues = classifyProcessIssues(processRecords)
    const issues = sortIssues([...processIssues, ...replayIssues, ...classifyErrors(standard.errorEntries)])

    const processSessionIDs = processRecords
      .map((record) => asString(record.data.sessionID))
      .filter((value): value is string => Boolean(value))
    const sessionIDs = new Set<string>([
      ...standard.sessionIDs,
      ...replayRecords.map((record) => record.sessionID),
      ...processSessionIDs,
    ])
    const health = issues.some((i) => i.severity === "critical")
      ? "unhealthy"
      : issues.some((i) => i.severity === "warning")
        ? "degraded"
        : "healthy"

    const report: DiagnosticReport = {
      timestamp: new Date().toISOString(),
      version: "2.12.3",
      platform: `${process.platform} ${process.arch}`,
      sessionCount: sessionIDs.size,
      errorCount: standard.totalErrors,
      warningCount: standard.totalWarnings,
      issues,
      health,
      summary:
        issues.length === 0
          ? "No issues detected. System is operating normally."
          : `${issues.length} issue(s) found: ${issues.filter((i) => i.severity === "critical").length} critical, ${issues.filter((i) => i.severity === "warning").length} warnings, ${issues.filter((i) => i.severity === "info").length} info.`,
    }

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }

    const healthIcon =
      health === "healthy" ? "\x1b[32m●\x1b[0m" : health === "degraded" ? "\x1b[33m●\x1b[0m" : "\x1b[31m●\x1b[0m"
    const healthLabel =
      health === "healthy"
        ? "\x1b[32mhealthy\x1b[0m"
        : health === "degraded"
          ? "\x1b[33mdegraded\x1b[0m"
          : "\x1b[31munhealthy\x1b[0m"

    console.log(`\n  ax-code debug explain\n`)
    console.log(`  ${healthIcon}  System health: ${healthLabel}`)
    console.log(
      `  \x1b[90m${report.sessionCount} sessions | ${report.errorCount} errors | ${report.warningCount} warnings\x1b[0m\n`,
    )

    if (issues.length === 0) {
      console.log(`  \x1b[32mNo issues detected. System is operating normally.\x1b[0m\n`)
      return
    }

    for (const issue of issues) {
      const icon =
        issue.severity === "critical"
          ? "\x1b[31m✗\x1b[0m"
          : issue.severity === "warning"
            ? "\x1b[33m△\x1b[0m"
            : "\x1b[36mℹ\x1b[0m"
      const risk =
        issue.riskLevel === "high"
          ? "\x1b[31mHIGH\x1b[0m"
          : issue.riskLevel === "medium"
            ? "\x1b[33mMED\x1b[0m"
            : "\x1b[90mLOW\x1b[0m"

      console.log(`  ${icon}  [${issue.category}] ${issue.title} (${issue.occurrences}x, risk: ${risk})`)
      console.log(`     \x1b[90mCause:\x1b[0m ${issue.rootCause}`)
      console.log(`     \x1b[90mImpact:\x1b[0m ${issue.impact}`)
      console.log(`     \x1b[90mFix:\x1b[0m ${issue.suggestedFix}`)
      console.log("")
    }
  },
})
