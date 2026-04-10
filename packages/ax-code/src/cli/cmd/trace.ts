/**
 * Trace command — execution trace with risk assessment
 *
 * Two modes:
 * - Default: replay event stream with risk scoring (DRE v3.0)
 * - --logs: legacy structured log analysis from log files
 */

import type { CommandModule } from "yargs"
import { Global } from "../../global"
import { Instance } from "../../project/instance"
import { EventQuery } from "../../replay/query"
import { Risk } from "../../risk/score"
import { Session } from "../../session"
import { SessionID } from "../../session/schema"
import type { ReplayEvent } from "../../replay/event"
import path from "path"
import fs from "fs/promises"

interface LogEntry {
  level: string
  time: string
  service: string
  command?: string
  toolName?: string
  status?: string
  durationMs?: number
  errorCode?: string
  sessionId?: string
  msg: string
  [key: string]: unknown
}

export const TraceCommand: CommandModule = {
  command: "trace [sessionID]",
  describe: "analyze execution trace from structured logs",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "filter to a specific session",
        type: "string",
      })
      .option("errors", {
        describe: "show only errors",
        type: "boolean",
        default: false,
      })
      .option("slow", {
        describe: "show only slow operations (ms threshold)",
        type: "number",
      })
      .option("service", {
        describe: "filter by service name",
        type: "string",
      })
      .option("limit", {
        describe: "max entries to show",
        type: "number",
        default: 50,
      })
      .option("json", {
        describe: "output raw JSON entries",
        type: "boolean",
        default: false,
      })
      .option("logs", {
        describe: "use legacy log file analysis instead of replay events",
        type: "boolean",
        default: false,
      })
      .option("risk", {
        describe: "show risk assessment only",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    // DRE v3.0: replay-based trace with risk scoring
    if (!args.logs) {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          let sessionID: SessionID
          if (args.sessionID) {
            sessionID = SessionID.make(args.sessionID as string)
          } else {
            let latest: Awaited<ReturnType<typeof Session.get>> | undefined
            for await (const s of Session.list({ limit: 1 })) {
              latest = s
            }
            if (!latest) {
              console.log("No sessions found. Run ax-code first.")
              return
            }
            sessionID = latest.id
          }

          const events = EventQuery.bySessionWithTimestamp(sessionID)
          if (events.length === 0) {
            console.log(`No events for session ${sessionID}. Try --logs for log file analysis.`)
            return
          }

          const session = await Session.get(sessionID)
          const risk = Risk.fromSession(sessionID)

          if (args.risk) {
            if (args.json) {
              console.log(JSON.stringify(risk, null, 2))
            } else {
              console.log(Risk.render(risk))
            }
            return
          }

          if (args.json) {
            console.log(JSON.stringify({ sessionID, title: session.title, risk, eventCount: events.length }, null, 2))
            return
          }

          const startTime = events[0].time_created
          const endTime = events[events.length - 1].time_created
          const duration = formatTraceDuration(endTime - startTime)

          console.log(`\n  Session: ${sessionID} (${duration})`)
          console.log(`  Title: ${session.title}`)
          console.log(`  Risk: ${risk.level} (${risk.score}/100) — ${risk.summary}`)
          console.log("")

          for (const { event_data: event, time_created } of events) {
            const offset = formatTraceOffset(time_created - startTime)
            const e = event as ReplayEvent & Record<string, unknown>

            switch (e.type) {
              case "session.start":
                console.log(`  [${offset}] START  agent=${e.agent}`)
                break
              case "session.end":
                console.log(`  [${offset}] END    reason=${e.reason} steps=${e.totalSteps}`)
                break
              case "agent.route":
                console.log(`  [${offset}] ROUTE  ${e.fromAgent} \u2192 ${e.toAgent} (confidence: ${e.confidence})`)
                break
              case "tool.call":
                console.log(`  [${offset}] TOOL   ${e.tool} ${formatTraceTarget(e)}`)
                break
              case "tool.result": {
                const status = e.status === "error" ? "\x1b[31mFAILED\x1b[0m" : "\x1b[32mOK\x1b[0m"
                const dur = e.durationMs ? ` (${e.durationMs}ms)` : ""
                console.log(`  [${offset}]        \u2192 ${status}${dur}`)
                break
              }
              case "llm.response": {
                const tokens = e.tokens as { input?: number; output?: number } | undefined
                const usage = tokens ? ` tokens=${tokens.input ?? 0}/${tokens.output ?? 0}` : ""
                console.log(`  [${offset}] LLM    ${e.finishReason}${usage} (${e.latencyMs}ms)`)
                break
              }
              case "error":
                console.log(`  [${offset}] \x1b[31mERROR\x1b[0m  ${e.errorType}: ${String(e.message).slice(0, 100)}`)
                break
              case "step.start":
                console.log(`  [${offset}] STEP   #${e.stepIndex}`)
                break
            }
          }

          console.log("")
          console.log(`  ${Risk.render(risk)}`)
          console.log("")
        },
      })
      return
    }

    // Legacy: log file analysis
    const logDir = Global.Path.log

    // Find the most recent .json.log file (Pino output)
    const files = await fs.readdir(logDir).catch(() => [] as string[])
    let logFile = files.filter((f) => f.endsWith(".json.log")).sort().pop()

    // Fall back to text log if no JSON log
    if (!logFile) {
      logFile = files.filter((f) => f.endsWith(".log") && !f.endsWith(".json.log")).sort().pop()
    }

    if (!logFile) {
      console.log("\n  No log files found. Run ax-code first to generate logs.\n")
      return
    }

    const logPath = path.join(logDir, logFile)
    const MAX_LOG_SIZE = 50 * 1024 * 1024 // 50 MB
    const stat = await fs.stat(logPath).catch(() => null)
    if (stat && stat.size > MAX_LOG_SIZE) {
      console.log(`\n  Log file too large (${Math.round(stat.size / 1024 / 1024)}MB). Use --limit or filter with --service/--errors.\n`)
      return
    }
    const content = await fs.readFile(logPath, "utf8")
    const lines = content.split("\n").filter(Boolean)

    // Parse entries
    const isJson = logFile.endsWith(".json.log")
    let entries: LogEntry[] = []

    if (isJson) {
      entries = lines
        .map((line) => {
          try {
            return JSON.parse(line) as LogEntry
          } catch {
            return null
          }
        })
        .filter((e): e is LogEntry => e !== null)
    } else {
      // Parse text format: "LEVEL YYYY-MM-DDTHH:MM:SS +Nms key=value key=value message"
      entries = lines.map((line) => {
        const match = line.match(/^(\w+)\s+(\S+)\s+\+(\d+)ms\s+(.*)$/)
        if (!match) return null
        const [, level, time, , rest] = match
        const parts = rest.split(" ")
        const entry: LogEntry = { level, time, service: "", msg: "" }
        for (const part of parts) {
          const eq = part.indexOf("=")
          if (eq > 0) {
            const key = part.slice(0, eq)
            const val = part.slice(eq + 1)
            if (key === "service") entry.service = val
            else if (key === "command") entry.command = val
            else if (key === "toolName") entry.toolName = val
            else if (key === "status") entry.status = val
            else if (key === "durationMs") entry.durationMs = parseInt(val, 10)
            else if (key === "errorCode") entry.errorCode = val
            else if (key === "sessionId") entry.sessionId = val
            else entry[key] = val
          } else {
            entry.msg = entry.msg ? entry.msg + " " + part : part
          }
        }
        return entry
      }).filter((e): e is LogEntry => e !== null)
    }

    // Apply filters
    const sessionID = args.sessionID as string | undefined
    const errorsOnly = args.errors as boolean
    const slowThreshold = args.slow as number | undefined
    const serviceFilter = args.service as string | undefined
    const limit = args.limit as number
    const jsonOutput = args.json as boolean

    let filtered = entries

    if (sessionID) {
      filtered = filtered.filter((e) => e.sessionId === sessionID)
    }
    if (errorsOnly) {
      filtered = filtered.filter((e) =>
        e.status === "error" || e.errorCode || (typeof e.level === "number" ? e.level >= 50 : e.level === "ERROR"),
      )
    }
    if (slowThreshold) {
      filtered = filtered.filter((e) => e.durationMs && e.durationMs >= slowThreshold)
    }
    if (serviceFilter) {
      filtered = filtered.filter((e) => e.service === serviceFilter)
    }

    // Take last N entries
    filtered = filtered.slice(-limit)

    if (filtered.length === 0) {
      console.log("\n  No matching log entries found.\n")
      return
    }

    if (jsonOutput) {
      for (const entry of filtered) {
        console.log(JSON.stringify(entry))
      }
      return
    }

    // Pretty print timeline
    console.log(`\n  ax-code trace (${logFile}, ${filtered.length} entries)\n`)

    for (const entry of filtered) {
      const level = typeof entry.level === "number"
        ? entry.level >= 50 ? "ERROR" : entry.level >= 40 ? "WARN" : "INFO"
        : entry.level

      const icon = level === "ERROR" ? "\x1b[31m✗\x1b[0m"
        : level === "WARN" ? "\x1b[33m△\x1b[0m"
        : entry.status === "ok" ? "\x1b[32m✓\x1b[0m"
        : "\x1b[90m·\x1b[0m"

      const time = typeof entry.time === "number"
        ? new Date(entry.time).toISOString().split("T")[1].split(".")[0]
        : entry.time?.split("T")[1]?.split(".")[0] ?? ""

      const service = entry.service ? `\x1b[36m${entry.service}\x1b[0m` : ""
      const command = entry.command || entry.toolName || ""
      const duration = entry.durationMs ? `\x1b[90m${entry.durationMs}ms\x1b[0m` : ""
      const status = entry.status === "error" ? `\x1b[31m${entry.errorCode || "error"}\x1b[0m`
        : entry.status === "ok" ? "\x1b[32mok\x1b[0m"
        : entry.status ? `\x1b[90m${entry.status}\x1b[0m`
        : ""
      const msg = entry.msg || ""

      const parts = [time, icon, service, command, msg, duration, status].filter(Boolean)
      console.log(`  ${parts.join("  ")}`)
    }

    // Summary
    const errors = filtered.filter((e) =>
      e.status === "error" || (typeof e.level === "number" ? e.level >= 50 : e.level === "ERROR"),
    )
    const withDuration = filtered.filter((e) => e.durationMs)
    const avgDuration = withDuration.length > 0
      ? Math.round(withDuration.reduce((sum, e) => sum + (e.durationMs ?? 0), 0) / withDuration.length)
      : 0

    console.log("")
    console.log(`  \x1b[90m${filtered.length} entries | ${errors.length} errors | avg ${avgDuration}ms\x1b[0m`)
    if (errors.length > 0) {
      const codes = [...new Set(errors.map((e) => e.errorCode).filter(Boolean))]
      if (codes.length > 0) {
        console.log(`  \x1b[31mError codes: ${codes.join(", ")}\x1b[0m`)
      }
    }
    console.log("")
  },
}

function formatTraceOffset(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}

function formatTraceDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function formatTraceTarget(event: Record<string, unknown>): string {
  const input = (event.input ?? {}) as Record<string, unknown>
  const fp = input.filePath ?? input.file_path ?? input.command ?? input.pattern ?? input.url
  if (typeof fp === "string") return fp.length > 80 ? fp.slice(0, 77) + "..." : fp
  return ""
}
