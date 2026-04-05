import { EventQuery } from "../replay/query"
import type { ReplayEvent } from "../replay/event"
import type { AuditRecord } from "./index"
import type { SessionID } from "../session/schema"

interface ExportContext {
  policy?: { name: string, version: string }
}

function toAuditRecord(sessionID: string, event: ReplayEvent, timestamp: number, ctx?: ExportContext): AuditRecord {
  const toolId = "callID" in event ? (event as { callID: string }).callID : undefined
  const base: AuditRecord = {
    trace_id: sessionID,
    session_id: sessionID,
    step_id: event.stepIndex?.toString(),
    tool_id: toolId,
    timestamp: new Date(timestamp).toISOString(),
    event_type: event.type,
    policy: ctx?.policy,
  }

  switch (event.type) {
    case "session.start":
      return { ...base, agent: event.agent, action: "start", target: event.directory }
    case "session.end":
      return { ...base, action: "end", result: event.reason }
    case "agent.route":
      return { ...base, agent: event.toAgent, action: "route", result: `from ${event.fromAgent} (${event.confidence.toFixed(2)})` }
    case "llm.request":
      return { ...base, action: "request", target: event.model }
    case "llm.response":
      return {
        ...base,
        action: "response",
        result: event.finishReason,
        duration_ms: event.latencyMs,
        token_usage: { input: event.tokens.input, output: event.tokens.output },
        cost: event.cost,
      }
    case "tool.call":
      return { ...base, tool: event.tool, action: "call", target: event.callID }
    case "tool.result":
      return {
        ...base,
        tool: event.tool,
        action: "result",
        result: event.status,
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
        cost: event.cost,
      }
    case "permission.ask":
      return { ...base, action: "permission.ask", target: event.permission, tool: event.tool }
    case "permission.reply":
      return { ...base, action: "permission.reply", result: event.reply }
    case "llm.output":
      return { ...base, action: "output", result: `${event.parts.length} parts` }
    case "error":
      return { ...base, action: "error", result: `${event.errorType}: ${event.message}` }
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
    const rows = EventQuery.allSince(since)
    for (const row of rows) {
      yield JSON.stringify(toAuditRecord(row.session_id, row.event_data, row.time_created, ctx))
    }
  }

  /** Load policy context from the current directory's .ax-code/policy.json */
  export async function policyContext(directory: string): Promise<ExportContext> {
    try {
      const file = Bun.file(`${directory}/.ax-code/policy.json`)
      if (!(await file.exists())) return {}
      const raw = await file.json()
      return { policy: { name: raw.name ?? "unknown", version: raw.version ?? "1" } }
    } catch {
      return {}
    }
  }
}
