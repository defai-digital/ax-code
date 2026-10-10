import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Session } from "../../session"
import { bootstrapReadonly } from "../bootstrap"
import { Database } from "../../storage/db"
import type { SessionID } from "../../session/schema"
import { SessionTable } from "../../session/session.sql"
import { SessionShard } from "../../session/shard"
import { SessionUsageStats } from "../../session/usage-stats"
import type { ProjectID } from "../../project/schema"
import { Project } from "../../project/project"
import { Instance } from "../../project/instance"
import { isNonEmptyRecord } from "../../util/record"
import { toErrorMessage } from "../../util/error-message"
import { Locale } from "../../util/locale"
import { EOL } from "os"

interface SessionStats {
  totalSessions: number
  totalMessages: number
  totalTokens: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  toolUsage: Record<string, number>
  modelUsage: Record<
    string,
    {
      messages: number
      tokens: {
        input: number
        output: number
        cache: {
          read: number
          write: number
        }
      }
    }
  >
  dateRange: {
    earliest: number
    latest: number
  }
  days: number
  tokensPerSession: number
  medianTokensPerSession: number
}

export const StatsCommand = cmd({
  command: "stats",
  describe: "show token usage statistics",
  builder: (yargs: Argv) => {
    return yargs
      .option("days", {
        describe: "show stats for the last N days (default: all time)",
        type: "number",
      })
      .option("tools", {
        describe: "number of tools to show (default: all)",
        type: "number",
      })
      .option("models", {
        describe: "show model statistics (default: hidden). Pass a number to show top N, otherwise shows all",
      })
      .option("project", {
        describe: "filter by project (default: all projects, empty string: current project)",
        type: "string",
      })
      .option("json", {
        describe: "output machine-readable JSON",
        type: "boolean",
        default: false,
      })
      .check((argv) => {
        validateStatsDays(argv.days)
        validateStatsDisplayLimit(argv.tools, "--tools")
        if (typeof argv.models === "number") validateStatsDisplayLimit(argv.models, "--models")
        return true
      })
  },
  handler: async (args) => {
    await bootstrapReadonly(process.cwd(), async () => {
      try {
        const stats = await aggregateSessionStats(args.days, args.project, { json: args.json === true })

        if (args.json) {
          process.stdout.write(JSON.stringify(buildStatsDocument(stats), null, 2) + EOL)
          return
        }

        let modelLimit: number | undefined
        if (args.models === true) {
          modelLimit = Infinity
        } else if (typeof args.models === "number") {
          modelLimit = validateStatsDisplayLimit(args.models, "--models")
        }

        displayStats(stats, validateStatsDisplayLimit(args.tools, "--tools"), modelLimit)
      } catch (error) {
        if (args.json) {
          process.stderr.write(
            JSON.stringify({ error: { code: "stats-error", message: toErrorMessage(error) } }, null, 2) + EOL,
          )
          process.exitCode = 1
          return
        }
        throw error
      }
    })
  },
})

export type StatsJSONDocument = {
  sessions: number
  messages: number
  days: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  }
  tokensPerSession: number
  medianTokensPerSession: number
  models: Record<string, { messages: number; input: number; output: number; cacheRead: number; cacheWrite: number }>
  tools: Record<string, number>
}

export function buildStatsDocument(stats: SessionStats): StatsJSONDocument {
  const models: StatsJSONDocument["models"] = {}
  for (const [model, usage] of Object.entries(stats.modelUsage)) {
    models[model] = {
      messages: usage.messages,
      input: usage.tokens.input,
      output: usage.tokens.output,
      cacheRead: usage.tokens.cache.read,
      cacheWrite: usage.tokens.cache.write,
    }
  }
  return {
    sessions: stats.totalSessions,
    messages: stats.totalMessages,
    days: stats.days,
    tokens: {
      input: stats.totalTokens.input,
      output: stats.totalTokens.output,
      reasoning: stats.totalTokens.reasoning,
      cacheRead: stats.totalTokens.cache.read,
      cacheWrite: stats.totalTokens.cache.write,
    },
    tokensPerSession: stats.tokensPerSession,
    medianTokensPerSession: stats.medianTokensPerSession,
    models,
    tools: { ...stats.toolUsage },
  }
}

export function validateStatsDays(days: unknown): number | undefined {
  if (days === undefined) return undefined
  if (typeof days !== "number" || !Number.isInteger(days) || days < 0) {
    throw new Error("--days must be a non-negative integer")
  }
  return days
}

export function validateStatsDisplayLimit(limit: unknown, option: "--tools" | "--models"): number | undefined {
  if (limit === undefined) return undefined
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0) {
    throw new Error(`${option} must be a non-negative integer`)
  }
  return limit
}

/**
 * The large-dataset notice text, or undefined below the threshold. Under
 * `--json` the notice must go to stderr (never stdout) so the JSON document
 * stays the only stdout content; text mode keeps the stdout behavior.
 */
export function statsLargeDatasetNotice(sessionCount: number): string | undefined {
  if (sessionCount <= 1000) return undefined
  return `Large dataset detected (${sessionCount} sessions). This may take a while...`
}

async function getCurrentProject(): Promise<Project.Info> {
  return Instance.project
}

async function getAllSessions(): Promise<Session.Info[]> {
  const rows = Database.use((db) => db.select().from(SessionTable).all())
  return rows.flatMap((row) => {
    const next = Session.safe(row)
    return next ? [next] : []
  })
}

export async function aggregateSessionStats(
  days?: number,
  projectFilter?: string,
  options?: { json?: boolean },
): Promise<SessionStats> {
  days = validateStatsDays(days)
  const sessions = await getAllSessions()
  const MS_IN_DAY = 24 * 60 * 60 * 1000

  const cutoffTime = (() => {
    if (days === undefined) return 0
    if (days === 0) {
      const now = new Date()
      now.setHours(0, 0, 0, 0)
      return now.getTime()
    }
    return Date.now() - days * MS_IN_DAY
  })()

  const windowDays = (() => {
    if (days === undefined) return
    if (days === 0) return 1
    return days
  })()

  let filteredSessions = cutoffTime > 0 ? sessions.filter((session) => session.time.updated >= cutoffTime) : sessions

  if (projectFilter !== undefined) {
    if (projectFilter === "") {
      const currentProject = await getCurrentProject()
      filteredSessions = filteredSessions.filter((session) => session.projectID === currentProject.id)
    } else {
      filteredSessions = filteredSessions.filter((session) => session.projectID === projectFilter)
    }
  }

  const stats: SessionStats = {
    totalSessions: filteredSessions.length,
    totalMessages: 0,
    totalTokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    toolUsage: {},
    modelUsage: {},
    dateRange: {
      earliest: Date.now(),
      latest: Date.now(),
    },
    days: 0,
    tokensPerSession: 0,
    medianTokensPerSession: 0,
  }

  const notice = statsLargeDatasetNotice(filteredSessions.length)
  if (notice !== undefined) {
    // G7: under --json the notice goes to stderr so stdout stays a single
    // JSON document; text mode keeps the previous stdout notice.
    if (options?.json) process.stderr.write(notice + EOL)
    else console.log(notice)
  }

  if (filteredSessions.length === 0) {
    stats.days = windowDays ?? 0
    return stats
  }

  let earliestTime = Date.now()
  let latestTime = 0

  const sessionTotalTokens: number[] = []

  // Aggregate inside SQLite, one pass per store (a shared registry store, or
  // one shard per project). A store that fails is skipped with a warning, the
  // same way a failing session batch used to be.
  const usage = new Map<SessionID, SessionUsageStats.Aggregate>()
  const failed = new Set<SessionID>()
  const byStore = new Map<SessionShard.Store, SessionID[]>()
  const storeByProject = new Map<ProjectID, SessionShard.Store>()
  for (const session of filteredSessions) {
    let store = storeByProject.get(session.projectID)
    if (!store) {
      store = SessionShard.storeForProject(session.projectID)
      storeByProject.set(session.projectID, store)
    }
    const ids = byStore.get(store)
    if (ids) ids.push(session.id)
    else byStore.set(store, [session.id])
  }
  for (const [store, ids] of byStore) {
    try {
      for (const [sessionID, aggregate] of SessionUsageStats.load(store, ids)) usage.set(sessionID, aggregate)
    } catch (error) {
      console.warn("Warning: stats batch failed:", toErrorMessage(error))
      for (const id of ids) failed.add(id)
    }
  }

  for (const session of filteredSessions) {
    if (failed.has(session.id)) continue
    const aggregate = usage.get(session.id)
    const sessionTokens = SessionUsageStats.emptyTokens()
    for (const [model, modelUsage] of aggregate?.models ?? []) {
      sessionTokens.input += modelUsage.tokens.input
      sessionTokens.output += modelUsage.tokens.output
      sessionTokens.reasoning += modelUsage.tokens.reasoning
      sessionTokens.cache.read += modelUsage.tokens.cache.read
      sessionTokens.cache.write += modelUsage.tokens.cache.write

      const total = (stats.modelUsage[model] ??= {
        messages: 0,
        tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      })
      total.messages += modelUsage.messages
      total.tokens.input += modelUsage.tokens.input
      // Model rows report reasoning together with output.
      total.tokens.output += modelUsage.tokens.output + modelUsage.tokens.reasoning
      total.tokens.cache.read += modelUsage.tokens.cache.read
      total.tokens.cache.write += modelUsage.tokens.cache.write
    }
    for (const [tool, count] of aggregate?.tools ?? []) {
      stats.toolUsage[tool] = (stats.toolUsage[tool] ?? 0) + count
    }

    earliestTime = Math.min(earliestTime, cutoffTime > 0 ? session.time.updated : session.time.created)
    latestTime = Math.max(latestTime, session.time.updated)
    sessionTotalTokens.push(
      sessionTokens.input +
        sessionTokens.output +
        sessionTokens.reasoning +
        sessionTokens.cache.read +
        sessionTokens.cache.write,
    )
    stats.totalMessages += aggregate?.messageCount ?? 0
    stats.totalTokens.input += sessionTokens.input
    stats.totalTokens.output += sessionTokens.output
    stats.totalTokens.reasoning += sessionTokens.reasoning
    stats.totalTokens.cache.read += sessionTokens.cache.read
    stats.totalTokens.cache.write += sessionTokens.cache.write
  }

  // When every store failed, earliest/latest never moved off their sentinels:
  // report the requested window (or 0) instead of an inverted range.
  if (sessionTotalTokens.length === 0) {
    stats.days = windowDays ?? 0
    return stats
  }

  const rangeDays = Math.max(1, Math.ceil((latestTime - earliestTime) / MS_IN_DAY))
  const effectiveDays = windowDays ?? rangeDays
  stats.dateRange = {
    earliest: earliestTime,
    latest: latestTime,
  }
  stats.days = effectiveDays
  const totalTokens =
    stats.totalTokens.input +
    stats.totalTokens.output +
    stats.totalTokens.reasoning +
    stats.totalTokens.cache.read +
    stats.totalTokens.cache.write
  // Average over the sessions that actually loaded — the same population the
  // median uses — so a failed store does not drag the mean toward zero.
  stats.tokensPerSession = totalTokens / sessionTotalTokens.length
  sessionTotalTokens.sort((a, b) => a - b)
  const mid = Math.floor(sessionTotalTokens.length / 2)
  stats.medianTokensPerSession =
    sessionTotalTokens.length === 0
      ? 0
      : sessionTotalTokens.length % 2 === 0
        ? (sessionTotalTokens[mid - 1] + sessionTotalTokens[mid]) / 2
        : sessionTotalTokens[mid]

  return stats
}

export function displayStats(stats: SessionStats, toolLimit?: number, modelLimit?: number) {
  const width = 56

  function renderRow(label: string, value: string): string {
    const availableWidth = width - 1
    const paddingNeeded = availableWidth - label.length - value.length
    const padding = Math.max(0, paddingNeeded)
    return `│${label}${" ".repeat(padding)}${value} │`
  }

  // Overview section
  console.log("┌────────────────────────────────────────────────────────┐")
  console.log("│                       OVERVIEW                         │")
  console.log("├────────────────────────────────────────────────────────┤")
  console.log(renderRow("Sessions", formatCount(stats.totalSessions)))
  console.log(renderRow("Messages", formatCount(stats.totalMessages)))
  console.log(renderRow("Days", formatCount(stats.days)))
  console.log("└────────────────────────────────────────────────────────┘")
  console.log()

  // Token Usage section
  console.log("┌────────────────────────────────────────────────────────┐")
  console.log("│                      TOKEN USAGE                       │")
  console.log("├────────────────────────────────────────────────────────┤")
  const tokensPerSession = finiteNumber(stats.tokensPerSession)
  console.log(renderRow("Avg Tokens/Session", formatNumber(Math.round(tokensPerSession))))
  const medianTokensPerSession = finiteNumber(stats.medianTokensPerSession)
  console.log(renderRow("Median Tokens/Session", formatNumber(Math.round(medianTokensPerSession))))
  console.log(renderRow("Input", formatNumber(stats.totalTokens.input)))
  console.log(renderRow("Output", formatNumber(stats.totalTokens.output)))
  console.log(renderRow("Cache Read", formatNumber(stats.totalTokens.cache.read)))
  console.log(renderRow("Cache Write", formatNumber(stats.totalTokens.cache.write)))
  console.log("└────────────────────────────────────────────────────────┘")
  console.log()

  // Model Usage section
  if (modelLimit !== undefined && isNonEmptyRecord(stats.modelUsage)) {
    const sortedModels = Object.entries(stats.modelUsage).sort(([, a], [, b]) => b.messages - a.messages)
    const modelsToDisplay = modelLimit === Infinity ? sortedModels : sortedModels.slice(0, modelLimit)

    console.log("┌────────────────────────────────────────────────────────┐")
    console.log("│                      MODEL USAGE                       │")
    console.log("├────────────────────────────────────────────────────────┤")

    for (const [model, usage] of modelsToDisplay) {
      console.log(`│ ${model.padEnd(54)} │`)
      console.log(renderRow("  Messages", formatCount(usage.messages)))
      console.log(renderRow("  Input Tokens", formatNumber(usage.tokens.input)))
      console.log(renderRow("  Output Tokens", formatNumber(usage.tokens.output)))
      console.log(renderRow("  Cache Read", formatNumber(usage.tokens.cache.read)))
      console.log(renderRow("  Cache Write", formatNumber(usage.tokens.cache.write)))
      console.log("├────────────────────────────────────────────────────────┤")
    }
    // Remove last separator and add bottom border
    process.stdout.write("\x1B[1A") // Move up one line
    console.log("└────────────────────────────────────────────────────────┘")
  }
  console.log()

  // Tool Usage section
  if (isNonEmptyRecord(stats.toolUsage)) {
    const sortedTools = Object.entries(stats.toolUsage).sort(([, a], [, b]) => b - a)
    const toolsToDisplay = toolLimit === undefined ? sortedTools : sortedTools.slice(0, toolLimit)

    console.log("┌────────────────────────────────────────────────────────┐")
    console.log("│                      TOOL USAGE                        │")
    console.log("├────────────────────────────────────────────────────────┤")

    const maxCount = Math.max(0, ...toolsToDisplay.map(([, count]) => finiteNumber(count)))
    const totalToolUsage = Object.values(stats.toolUsage).reduce((a, b) => a + finiteNumber(b), 0)

    for (const [tool, count] of toolsToDisplay) {
      const safeCount = finiteNumber(count)
      const barLength = maxCount > 0 ? Math.max(1, Math.floor((safeCount / maxCount) * 20)) : 1
      const bar = "█".repeat(barLength)
      const percentage = totalToolUsage > 0 ? ((safeCount / totalToolUsage) * 100).toFixed(1) : "0.0"

      const maxToolLength = 18
      const truncatedTool = tool.length > maxToolLength ? tool.substring(0, maxToolLength - 2) + ".." : tool
      const toolName = truncatedTool.padEnd(maxToolLength)

      const content = ` ${toolName} ${bar.padEnd(20)} ${formatCount(safeCount).padStart(3)} (${percentage.padStart(4)}%)`
      const padding = Math.max(0, width - content.length - 1)
      console.log(`│${content}${" ".repeat(padding)} │`)
    }
    console.log("└────────────────────────────────────────────────────────┘")
  }
  console.log()
}

function finiteNumber(num: number): number {
  return Number.isFinite(num) ? num : 0
}

function formatCount(num: number): string {
  return Math.round(finiteNumber(num)).toLocaleString()
}

function formatNumber(num: number): string {
  return Locale.number(finiteNumber(num))
}
