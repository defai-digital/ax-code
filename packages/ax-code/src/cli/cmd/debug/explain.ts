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

import { Global } from "../../../global"
import { Log } from "../../../util/log"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import path from "path"
import fs from "fs/promises"

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

interface DiagnosticIssue {
  severity: "critical" | "warning" | "info"
  category: string
  title: string
  rootCause: string
  impact: string
  suggestedFix: string
  riskLevel: "high" | "medium" | "low"
  occurrences: number
}

function classifyErrors(entries: DiagnosticEntry[]): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = []

  // Group by error pattern
  const byService = new Map<string, DiagnosticEntry[]>()
  for (const entry of entries) {
    const key = entry.service
    const list = byService.get(key) ?? []
    list.push(entry)
    byService.set(key, list)
  }

  // LSP issues
  const lspErrors = byService.get("lsp") ?? []
  if (lspErrors.length > 0) {
    const broken = lspErrors.filter(e => e.errorCode === "MARKED_BROKEN" || e.errorCode === "SPAWN_FAILED")
    if (broken.length > 0) {
      issues.push({
        severity: "warning",
        category: "LSP",
        title: "Language server failures detected",
        rootCause: `${broken.length} LSP server(s) marked broken or failed to spawn. Common causes: missing language server binary, incompatible version, or resource exhaustion.`,
        impact: "Code intelligence features (symbol lookup, references, diagnostics) may be degraded for affected languages.",
        suggestedFix: "Run `ax-code debug lsp` to check server status. Ensure language servers are installed (e.g., `npm i -g typescript-language-server`).",
        riskLevel: "medium",
        occurrences: broken.reduce((sum, e) => sum + e.count, 0),
      })
    }
  }

  // MCP issues
  const mcpErrors = byService.get("mcp") ?? []
  if (mcpErrors.length > 0) {
    const connectErrors = mcpErrors.filter(e => e.command?.includes("connect") || e.errorCode === "CREATE_FAILED")
    if (connectErrors.length > 0) {
      issues.push({
        severity: "warning",
        category: "MCP",
        title: "MCP server connection failures",
        rootCause: `${connectErrors.length} MCP server connection(s) failed. The server may be offline, misconfigured, or the transport type is incorrect.`,
        impact: "External tools and resources from affected MCP servers are unavailable.",
        suggestedFix: "Check MCP server configuration in ax-code.json. Verify the server is running with `ax-code debug config`.",
        riskLevel: "medium",
        occurrences: connectErrors.reduce((sum, e) => sum + e.count, 0),
      })
    }
  }

  // Tool execution issues
  const toolErrors = byService.get("tool") ?? []
  if (toolErrors.length > 0) {
    const timeouts = toolErrors.filter(e => e.errorCode === "TIMEOUT" || (e.durationMs && e.durationMs > 30000))
    if (timeouts.length > 0) {
      issues.push({
        severity: "warning",
        category: "Tool",
        title: "Tool execution timeouts",
        rootCause: `${timeouts.length} tool call(s) timed out or ran excessively long. Common causes: network issues, large file operations, or stuck processes.`,
        impact: "AI agent responses may be incomplete or delayed.",
        suggestedFix: "Check network connectivity. For bash tool timeouts, increase timeout with AX_CODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS.",
        riskLevel: "low",
        occurrences: timeouts.reduce((sum, e) => sum + e.count, 0),
      })
    }
    const otherToolErrors = toolErrors.filter(e => !timeouts.includes(e))
    if (otherToolErrors.length > 0) {
      issues.push({
        severity: "info",
        category: "Tool",
        title: `Tool errors (${otherToolErrors.map(e => e.errorCode).filter(Boolean).join(", ") || "various"})`,
        rootCause: `${otherToolErrors.length} tool error(s) detected. These may be transient or related to specific file/permission states.`,
        impact: "Individual tool calls failed but the session likely recovered via retry or alternative approach.",
        suggestedFix: "Review errors with `ax-code trace --errors`. Most tool errors are self-correcting.",
        riskLevel: "low",
        occurrences: otherToolErrors.reduce((sum, e) => sum + e.count, 0),
      })
    }
  }

  // Config issues
  const configErrors = byService.get("config") ?? []
  if (configErrors.length > 0) {
    issues.push({
      severity: configErrors.some(e => e.errorCode === "PARSE_FAILED") ? "critical" : "info",
      category: "Config",
      title: "Configuration loading issues",
      rootCause: `${configErrors.length} config-related error(s). May indicate malformed ax-code.json, missing plugin dependencies, or permission issues.`,
      impact: "Some features or plugins may not load correctly.",
      suggestedFix: "Run `ax-code doctor` to check config status. Validate ax-code.json syntax.",
      riskLevel: configErrors.some(e => e.errorCode === "PARSE_FAILED") ? "high" : "low",
      occurrences: configErrors.reduce((sum, e) => sum + e.count, 0),
    })
  }

  // Session issues
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

  // Provider issues
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

  return issues.sort((a, b) => {
    const sev = { critical: 0, warning: 1, info: 2 }
    return sev[a.severity] - sev[b.severity]
  })
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
    const logDir = Global.Path.log
    const files = await fs.readdir(logDir).catch(() => [] as string[])

    // Try JSON log first, fall back to text
    let logFile = files.filter(f => f.endsWith(".json.log")).sort().pop()
    const isJson = !!logFile
    if (!logFile) {
      logFile = files.filter(f => f.endsWith(".log") && !f.endsWith(".json.log")).sort().pop()
    }

    if (!logFile) {
      console.log("\n  No log files found. Run ax-code first to generate logs.\n")
      return
    }

    const content = await fs.readFile(path.join(logDir, logFile), "utf8")
    const lines = content.split("\n").filter(Boolean)

    // Parse entries
    const errorEntries: DiagnosticEntry[] = []
    let totalErrors = 0
    let totalWarnings = 0
    const sessionIds = new Set<string>()
    const errorMap = new Map<string, DiagnosticEntry>()

    for (const line of lines) {
      let parsed: any
      if (isJson) {
        try { parsed = JSON.parse(line) } catch { continue }
      } else {
        const match = line.match(/^(\w+)\s+/)
        if (!match) continue
        parsed = { level: match[1] === "ERROR" ? 50 : match[1] === "WARN" ? 40 : 30 }
        // Extract key=value pairs
        const pairs = line.matchAll(/(\w+)=(\S+)/g)
        for (const [, key, val] of pairs) {
          parsed[key] = val
        }
        parsed.msg = line.slice(line.indexOf(match[0]) + match[0].length)
      }

      const level = typeof parsed.level === "number" ? parsed.level : parsed.level === "ERROR" ? 50 : parsed.level === "WARN" ? 40 : 30
      if (level >= 50) totalErrors++
      if (level >= 40 && level < 50) totalWarnings++
      if (parsed.sessionId) sessionIds.add(parsed.sessionId)

      // Filter by session if specified
      if (args.session && parsed.sessionId !== args.session) continue

      if (level >= 50 || parsed.status === "error") {
        const key = `${parsed.service || "unknown"}:${parsed.errorCode || parsed.command || "general"}`
        const existing = errorMap.get(key)
        if (existing) {
          existing.count++
          existing.lastSeen = parsed.time ? new Date(parsed.time).toISOString() : ""
        } else {
          errorMap.set(key, {
            service: parsed.service || "unknown",
            command: parsed.command || "",
            errorCode: parsed.errorCode || "",
            message: String(parsed.msg || "").slice(0, 200),
            count: 1,
            lastSeen: parsed.time ? new Date(parsed.time).toISOString() : "",
            durationMs: parsed.durationMs,
          })
        }
      }
    }

    const issues = classifyErrors([...errorMap.values()])
    const health = issues.some(i => i.severity === "critical") ? "unhealthy"
      : issues.some(i => i.severity === "warning") ? "degraded"
      : "healthy"

    const report: DiagnosticReport = {
      timestamp: new Date().toISOString(),
      version: "2.12.3",
      platform: `${process.platform} ${process.arch}`,
      sessionCount: sessionIds.size,
      errorCount: totalErrors,
      warningCount: totalWarnings,
      issues,
      health,
      summary: issues.length === 0
        ? "No issues detected. System is operating normally."
        : `${issues.length} issue(s) found: ${issues.filter(i => i.severity === "critical").length} critical, ${issues.filter(i => i.severity === "warning").length} warnings, ${issues.filter(i => i.severity === "info").length} info.`,
    }

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }

    // Pretty print
    const healthIcon = health === "healthy" ? "\x1b[32m●\x1b[0m" : health === "degraded" ? "\x1b[33m●\x1b[0m" : "\x1b[31m●\x1b[0m"
    const healthLabel = health === "healthy" ? "\x1b[32mhealthy\x1b[0m" : health === "degraded" ? "\x1b[33mdegraded\x1b[0m" : "\x1b[31munhealthy\x1b[0m"

    console.log(`\n  ax-code debug explain\n`)
    console.log(`  ${healthIcon}  System health: ${healthLabel}`)
    console.log(`  \x1b[90m${report.sessionCount} sessions | ${report.errorCount} errors | ${report.warningCount} warnings\x1b[0m\n`)

    if (issues.length === 0) {
      console.log(`  \x1b[32mNo issues detected. System is operating normally.\x1b[0m\n`)
      return
    }

    for (const issue of issues) {
      const icon = issue.severity === "critical" ? "\x1b[31m✗\x1b[0m"
        : issue.severity === "warning" ? "\x1b[33m△\x1b[0m"
        : "\x1b[36mℹ\x1b[0m"
      const risk = issue.riskLevel === "high" ? "\x1b[31mHIGH\x1b[0m"
        : issue.riskLevel === "medium" ? "\x1b[33mMED\x1b[0m"
        : "\x1b[90mLOW\x1b[0m"

      console.log(`  ${icon}  [${issue.category}] ${issue.title} (${issue.occurrences}x, risk: ${risk})`)
      console.log(`     \x1b[90mCause:\x1b[0m ${issue.rootCause}`)
      console.log(`     \x1b[90mImpact:\x1b[0m ${issue.impact}`)
      console.log(`     \x1b[90mFix:\x1b[0m ${issue.suggestedFix}`)
      console.log("")
    }
  },
})
