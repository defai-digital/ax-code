import { EventQuery } from "../replay/query"
import type { ReplayEvent } from "../replay/event"
import { Session } from "../session"
import type { SessionID } from "../session/schema"
import { SessionVerifications } from "../session/verifications"
import type { VerificationEnvelope } from "../quality/verification-envelope"
import { Risk } from "../risk/score"
import { truncate } from "../util/format"
import path from "path"

const MS_PER_SECOND = 1000
const SECONDS_PER_HOUR = 3600
const TENTH_SECOND_UNIT_MS = 100

export function formatAuditReportTimestamp(ms: number): string {
  const d = new Date(ms)
  const safe = Number.isFinite(d.getTime()) ? d : new Date(0)
  return safe
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "")
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / MS_PER_SECOND)
  const h = Math.floor(total / SECONDS_PER_HOUR)
  const m = Math.floor((total % SECONDS_PER_HOUR) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  if (s === 0) return `${ms}ms`
  return `${s}.${Math.floor((ms % MS_PER_SECOND) / TENTH_SECOND_UNIT_MS)}s`
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function eventTokens(value: unknown): { input: number; output: number; reasoning: number } {
  if (!value || typeof value !== "object") {
    return { input: 0, output: 0, reasoning: 0 }
  }
  const tokens = value as { input?: unknown; output?: unknown; reasoning?: unknown }
  return {
    input: finiteNumber(tokens.input),
    output: finiteNumber(tokens.output),
    reasoning: finiteNumber(tokens.reasoning),
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function summarize(s: string | undefined, max: number): string {
  if (!s) return ""
  const flat = s.replace(/\s+/g, " ").trim()
  if (flat.length <= max) return flat
  return flat.slice(0, max - 3) + "..."
}

function firstText(v: unknown): string {
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (Array.isArray(v)) return summarize(v.map(firstText).filter(Boolean).join(", "), 50)
  if (!v || typeof v !== "object") return ""
  for (const next of Object.values(v)) {
    const text = firstText(next)
    if (text) return text
  }
  return ""
}

export function extractTarget(tool: string, input: Record<string, unknown>): string {
  if (tool === "impact_analyze") {
    if (Array.isArray(input.changes) && input.changes.length > 0) {
      const first = input.changes[0]
      if (first && typeof first === "object") {
        const firstObj = first as { kind?: string; path?: string; id?: string; patch?: string }
        if (firstObj.kind === "file") return truncate(firstObj.path ?? "", 40)
        if (firstObj.kind === "symbol") return truncate(firstObj.id ?? "", 40)
        if (firstObj.kind === "diff") return "diff"
      }
    }
    return "impact"
  }

  if (tool === "debug_analyze") {
    return truncate(String(input.error ?? input.entrySymbol ?? ""), 50)
  }

  if (tool === "refactor_plan") {
    if (typeof input.intent === "string") return truncate(input.intent, 50)
    return truncate(String(input.targets ?? ""), 50)
  }

  if (tool === "refactor_apply") {
    return truncate(String(input.planId ?? input.mode ?? ""), 40)
  }

  if (tool === "dedup_scan") {
    return truncate(firstText(input.kinds) || "dedup", 40)
  }

  if (tool === "hardcode_scan") {
    return truncate(firstText(input.patterns) || firstText(input.include) || "hardcode", 40)
  }

  if (tool === "race_scan") {
    return truncate(firstText(input.patterns) || firstText(input.include) || "race", 40)
  }

  if (tool === "lifecycle_scan") {
    return truncate(firstText(input.resourceTypes) || firstText(input.include) || "lifecycle", 40)
  }

  if (tool === "security_scan") {
    return truncate(firstText(input.patterns) || firstText(input.include) || "security", 40)
  }

  switch (tool) {
    case "bash":
      return truncate(String(input.command ?? input.description ?? ""), 50)
    case "read":
    case "edit":
    case "write":
      return (input.filePath ?? input.file_path) ? path.basename(String(input.filePath ?? input.file_path)) : ""
    case "glob":
      return truncate(String(input.pattern ?? ""), 40)
    case "grep":
      return truncate(String(input.pattern ?? ""), 40)
    case "webfetch":
      return truncate(String(input.url ?? ""), 50)
    case "websearch":
      return truncate(String(input.query ?? ""), 50)
    case "codesearch":
      return truncate(String(input.query ?? ""), 50)
    case "task":
      return truncate(String(input.description ?? ""), 50)
    default: {
      const first = Object.values(input)[0]
      return first ? truncate(String(first), 40) : ""
    }
  }
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ")
}

function formatResult(event: Extract<ReplayEvent, { type: "tool.result" }>): string {
  if (event.status === "completed") {
    const text = summarize(event.output, 60)
    return text ? `ok: ${text}` : "ok"
  }
  const text = summarize(event.error, 60)
  return text ? `ERR: ${text}` : "ERR"
}

function formatVerificationCommand(envelope: VerificationEnvelope): string {
  const command = envelope.command.argv.length > 0 ? envelope.command.argv.join(" ") : envelope.command.runner
  return `${envelope.result.name}: ${command}`
}

export namespace AuditReport {
  export async function generate(sessionID: SessionID): Promise<string> {
    const info = await Session.get(sessionID)
    const rows = EventQuery.bySessionWithTimestamp(sessionID)

    // Extract goal from first user message.
    // Session.messages streams newest-first then reverses, so we stream
    // all messages and pick the first user message from the result.
    let goal = "No user prompt recorded."
    try {
      const msgs = await Session.messages({ sessionID })
      for (const msg of msgs) {
        if (msg.info.role === "user") {
          const text = msg.parts.find((p) => p.type === "text")
          if (text && "text" in text) {
            goal = truncate(text.text, 500)
          }
          break
        }
      }
    } catch {
      // Session may have no messages
    }

    // Extract file diffs
    const diffs = await Session.diff(sessionID)

    // Process events
    let startTime: number | undefined
    let endTime: number | undefined
    let endReason: string | undefined
    const pending = new Map<string, { tool: string; target: string; time: number }>()
    const actions: Array<{
      seq: number
      time: number
      tool: string
      target: string
      result: string
      duration: string
    }> = []
    let totalInput = 0
    let totalOutput = 0
    let totalReasoning = 0
    const routes: Array<{
      time: number
      from: string
      to: string
      mode: string
      conf: number
      matched: string[]
    }> = []
    let seq = 0

    for (const row of rows) {
      const event = row.event_data as ReplayEvent
      const ts = row.time_created

      switch (event.type) {
        case "session.start":
          if (startTime === undefined) startTime = ts
          break
        case "session.end":
          endTime = ts
          endReason = event.reason
          break
        case "agent.route":
          routes.push({
            time: ts,
            from: event.fromAgent,
            to: event.toAgent,
            mode: event.routeMode ?? "switch",
            conf: finiteNumber(event.confidence),
            matched: stringList(event.matched),
          })
          break
        case "tool.call": {
          const target = extractTarget(event.tool, event.input as Record<string, unknown>)
          pending.set(event.callID, { tool: event.tool, target, time: ts })
          break
        }
        case "tool.result": {
          const call = pending.get(event.callID)
          if (call) {
            seq++
            actions.push({
              seq,
              time: call.time,
              tool: call.tool,
              target: call.target,
              result: formatResult(event),
              duration: formatDuration(finiteNumber(event.durationMs)),
            })
            pending.delete(event.callID)
          }
          break
        }
        case "llm.response": {
          const tokens = eventTokens(event.tokens)
          totalInput += tokens.input
          totalOutput += tokens.output
          totalReasoning += tokens.reasoning
          break
        }
      }
    }

    // Handle interrupted calls (no matching result)
    for (const [, call] of pending) {
      seq++
      actions.push({
        seq,
        time: call.time,
        tool: call.tool,
        target: call.target,
        result: "interrupted",
        duration: "-",
      })
    }

    const validations = SessionVerifications.loadRunsWithIds(sessionID).flatMap((run) => {
      const policyFailed = SessionVerifications.runPolicyFailed(run)
      return run.envelopes.map(({ envelope }) => ({
        command: formatVerificationCommand(envelope),
        passed: envelope.result.passed && !policyFailed,
      }))
    })

    // Build markdown
    const lines: string[] = []

    lines.push(`# Audit Report: ${info.title}`)
    lines.push("")

    // Goal
    lines.push("## Goal")
    lines.push("")
    lines.push(goal)
    lines.push("")

    // Session Info
    lines.push("## Session Info")
    lines.push("")
    lines.push(`- **Session ID:** \`${sessionID}\``)
    lines.push(`- **Directory:** ${info.directory}`)
    lines.push(
      `- **Started:** ${startTime ? formatAuditReportTimestamp(startTime) : formatAuditReportTimestamp(info.time.created)}`,
    )
    if (endTime) {
      lines.push(`- **Ended:** ${formatAuditReportTimestamp(endTime)}`)
      lines.push(`- **Duration:** ${formatDuration(endTime - (startTime ?? info.time.created))}`)
    } else {
      lines.push(`- **Ended:** *(session still in progress)*`)
      lines.push(`- **Duration:** ${formatDuration(info.time.updated - (startTime ?? info.time.created))}`)
    }
    if (endReason) {
      lines.push(`- **Reason:** ${endReason}`)
    }
    lines.push("")

    if (routes.length > 0) {
      lines.push("## Routing")
      lines.push("")
      for (const route of routes) {
        const time = formatAuditReportTimestamp(route.time).split(" ")[1] ?? ""
        const matched = route.matched.length > 0 ? ` [${route.matched.join(", ")}]` : ""
        lines.push(`- ${time} ${route.mode} \`${route.from}\` -> \`${route.to}\` (${route.conf.toFixed(2)})${matched}`)
      }
      lines.push("")
    }

    // Action Log
    lines.push("## Action Log")
    lines.push("")
    if (actions.length === 0) {
      lines.push("No tool calls recorded.")
    } else {
      lines.push("| # | Time | Tool | Target | Result | Duration |")
      lines.push("|---|------|------|--------|--------|----------|")
      for (const a of actions) {
        const time = formatAuditReportTimestamp(a.time).split(" ")[1] ?? ""
        lines.push(
          `| ${a.seq} | ${time} | ${escapeCell(a.tool)} | ${escapeCell(a.target)} | ${escapeCell(a.result)} | ${a.duration} |`,
        )
      }
    }
    lines.push("")

    // Files Modified
    lines.push("## Files Modified")
    lines.push("")
    if (diffs.length === 0) {
      lines.push("No files modified.")
    } else {
      for (const d of diffs) {
        const status = d.status === "added" ? "new" : d.status === "deleted" ? "deleted" : "modified"
        lines.push(`- \`${d.file}\` (${status}, +${d.additions} -${d.deletions})`)
      }
    }
    lines.push("")

    // Validation
    if (validations.length > 0) {
      lines.push("## Validation")
      lines.push("")
      for (const v of validations) {
        const icon = v.passed ? "PASS" : "FAIL"
        lines.push(`- **${icon}:** ${v.command}`)
      }
      lines.push("")
    }

    // Risk Assessment
    const risk = Risk.fromSession(sessionID)
    lines.push("## Risk Assessment")
    lines.push("")
    lines.push(`- **Level:** ${risk.level} (${risk.score}/100)`)
    lines.push(`- **Summary:** ${risk.summary}`)
    const s = risk.signals
    if (s.filesChanged > 0) lines.push(`- **Files changed:** ${s.filesChanged}`)
    if (s.securityRelated) lines.push(`- **Security-related:** yes`)
    if (s.crossModule) lines.push(`- **Cross-module:** yes`)
    if (s.validationPassed !== undefined) lines.push(`- **Validation:** ${s.validationPassed ? "passed" : "failed"}`)
    if (s.toolFailures > 0) lines.push(`- **Tool failures:** ${s.toolFailures}/${s.totalTools}`)
    lines.push("")

    // Token Usage
    lines.push("## Token Usage")
    lines.push("")
    lines.push(`- **Input:** ${totalInput.toLocaleString()}`)
    lines.push(`- **Output:** ${totalOutput.toLocaleString()}`)
    if (totalReasoning > 0) {
      lines.push(`- **Reasoning:** ${totalReasoning.toLocaleString()}`)
    }
    lines.push(`- **Total:** ${(totalInput + totalOutput + totalReasoning).toLocaleString()}`)
    lines.push("")

    return lines.join("\n")
  }
}
