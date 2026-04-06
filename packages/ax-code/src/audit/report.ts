import { EventQuery } from "../replay/query"
import type { ReplayEvent } from "../replay/event"
import { Session } from "../session"
import type { SessionID } from "../session/schema"
import path from "path"

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 3) + "..."
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "")
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  if (s === 0) return `${ms}ms`
  return `${s}.${Math.floor((ms % 1000) / 100)}s`
}

function extractTarget(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case "bash":
      return truncate(String(input.command ?? input.description ?? ""), 50)
    case "read":
    case "edit":
    case "write":
      return input.file_path ? path.basename(String(input.file_path)) : ""
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
    const validations: Array<{ command: string; passed: boolean }> = []
    let seq = 0

    for (const row of rows) {
      const event = row.event_data as ReplayEvent
      const ts = row.time_created

      switch (event.type) {
        case "session.start":
          startTime = ts
          break
        case "session.end":
          endTime = ts
          endReason = event.reason
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
              result: event.status,
              duration: formatDuration(event.durationMs),
            })
            // Check for validation commands
            if (call.tool === "bash") {
              const cmd = call.target.toLowerCase()
              if (/\b(bun test|npm test|vitest|jest|typecheck|tsc\b|eslint|biome check|lint)/.test(cmd)) {
                validations.push({
                  command: call.target,
                  passed: event.status === "completed",
                })
              }
            }
            pending.delete(event.callID)
          }
          break
        }
        case "llm.response":
          totalInput += event.tokens.input
          totalOutput += event.tokens.output
          totalReasoning += event.tokens.reasoning ?? 0
          break
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
    lines.push(`- **Started:** ${startTime ? formatTimestamp(startTime) : formatTimestamp(info.time.created)}`)
    if (endTime) {
      lines.push(`- **Ended:** ${formatTimestamp(endTime)}`)
      lines.push(`- **Duration:** ${formatDuration(endTime - (startTime ?? info.time.created))}`)
    } else {
      lines.push(`- **Ended:** *(session still in progress)*`)
      lines.push(`- **Duration:** ${formatDuration(info.time.updated - (startTime ?? info.time.created))}`)
    }
    if (endReason) {
      lines.push(`- **Reason:** ${endReason}`)
    }
    lines.push("")

    // Action Log
    lines.push("## Action Log")
    lines.push("")
    if (actions.length === 0) {
      lines.push("No tool calls recorded.")
    } else {
      lines.push("| # | Time | Tool | Target | Result | Duration |")
      lines.push("|---|------|------|--------|--------|----------|")
      for (const a of actions) {
        const time = formatTimestamp(a.time).split(" ")[1] ?? ""
        const result = a.result === "completed" ? "ok" : a.result === "error" ? "ERR" : a.result
        lines.push(
          `| ${a.seq} | ${time} | ${escapeCell(a.tool)} | ${escapeCell(a.target)} | ${result} | ${a.duration} |`,
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
