import { EventQuery } from "../replay/query"
import type { ReplayEvent } from "../replay/event"
import type { AuditRecord } from "./index"
import type { SessionID } from "../session/schema"
import { Filesystem } from "@/util/filesystem"

interface ExportContext {
  policy?: { name: string; version: string }
}

function summarizeText(text: string | undefined, max: number): string {
  if (!text) return ""
  if (text.length <= max) return text
  return text.slice(0, max - 3) + "..."
}

export function formatAuditTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString()
}

function toAuditRecord(sessionID: string, event: ReplayEvent, timestamp: number, ctx?: ExportContext): AuditRecord {
  const toolId = "callID" in event ? (event as { callID: string }).callID : undefined
  const base: AuditRecord = {
    trace_id: sessionID,
    session_id: sessionID,
    step_id: event.stepIndex?.toString(),
    tool_id: toolId,
    timestamp: formatAuditTimestamp(timestamp),
    event_type: event.type,
    policy: ctx?.policy,
  }

  switch (event.type) {
    case "session.start":
      return { ...base, agent: event.agent, action: "start", target: event.directory }
    case "session.end":
      return { ...base, action: "end", result: event.reason }
    case "agent.route":
      const confidence = event.confidence ?? 0
      return {
        ...base,
        agent: event.toAgent,
        action: "route",
        result: `${event.routeMode ?? "switch"} from ${event.fromAgent} (${confidence.toFixed(2)})`,
      }
    case "llm.request":
      return { ...base, action: "request", target: event.model }
    case "llm.response":
      return {
        ...base,
        action: "response",
        result: event.finishReason,
        duration_ms: event.latencyMs,
        token_usage: { input: event.tokens.input, output: event.tokens.output },
      }
    case "tool.call":
      return { ...base, tool: event.tool, action: "call", target: event.callID }
    case "tool.result":
      return {
        ...base,
        tool: event.tool,
        action: "result",
        result: event.error
          ? `error: ${summarizeText(event.error, 500)}`
          : event.output
            ? summarizeText(event.output, 500)
            : event.status,
        metadata: event.metadata,
        duration_ms: event.durationMs,
      }
    case "step.start":
      return { ...base, action: "step.start" }
    case "step.finish":
      return {
        ...base,
        action: "step.finish",
        result: event.finishReason,
        token_usage: { input: event.tokens.input, output: event.tokens.output },
      }
    case "permission.ask":
      return { ...base, action: "permission.ask", target: event.permission, tool: event.tool }
    case "permission.reply":
      return { ...base, action: "permission.reply", result: event.reply }
    case "llm.output":
      return { ...base, action: "output", result: `${event.parts.length} parts` }
    case "error":
      return { ...base, action: "error", result: `${event.errorType}: ${event.message}` }
    case "code.graph.snapshot":
      return {
        ...base,
        action: "snapshot",
        target: event.projectID,
        result: `nodes=${event.nodeCount} edges=${event.edgeCount}${event.commitSha ? ` sha=${event.commitSha}` : ""}`,
      }
    default:
      return base
  }
}

export namespace AuditExport {
  export function* stream(sessionID: SessionID, ctx?: ExportContext): Generator<string> {
    const rows = EventQuery.bySessionWithTimestamp(sessionID)
    for (const row of rows) {
      yield JSON.stringify(toAuditRecord(sessionID, row.event_data, row.time_created, ctx))
    }
  }

  export function* streamAll(options: { since?: number }, ctx?: ExportContext): Generator<string> {
    const since = options.since ?? 0
    let cursor:
      | {
          time_created: number
          session_id: SessionID
          sequence: number
        }
      | undefined

    while (true) {
      const rows = EventQuery.allSince({ since, cursor })
      if (rows.length === 0) return
      for (const row of rows) {
        yield JSON.stringify(toAuditRecord(row.session_id, row.event_data, row.time_created, ctx))
      }
      const last = rows[rows.length - 1]
      if (!last) return
      cursor = {
        time_created: last.time_created,
        session_id: last.session_id,
        sequence: last.sequence,
      }
    }
  }

  /** Load policy context from the current directory's .ax-code/policy.json */
  export async function policyContext(directory: string): Promise<ExportContext> {
    try {
      const raw = await Filesystem.readJson<Record<string, unknown>>(`${directory}/.ax-code/policy.json`)
      return {
        policy: {
          name: typeof raw.name === "string" ? raw.name : "unknown",
          version: typeof raw.version === "string" ? raw.version : "1",
        },
      }
    } catch (error) {
      const code = errnoCode(error)
      if (code !== undefined && code !== "ENOENT") throw error
      return {}
    }
  }

  function errnoCode(error: unknown) {
    if (typeof error !== "object" || error === null) return undefined
    const code = (error as { code?: unknown }).code
    return typeof code === "string" ? code : undefined
  }
}
