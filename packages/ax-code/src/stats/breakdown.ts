/**
 * Context breakdown calculator
 * Estimates token usage by category. Reads model context window from
 * the live Provider registry — no hardcoded model tables.
 */

import type { Provider } from "../provider/provider"
import type { ContextBreakdown, ContextStatus } from "./types"

// Approximate token count from text (1 token ≈ 4 characters)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function calculateBreakdown(input: {
  model: Provider.Model | undefined
  systemPromptLength: number
  toolCount: number
  memoryTokens: number
  historyTokens: number
}): ContextBreakdown {
  const modelLimit = input.model?.limit.context ?? 0

  const systemPrompt = estimateTokens(" ".repeat(input.systemPromptLength))
  const toolDefinitions = input.toolCount * 800 // ~800 tokens per tool definition
  const memory = input.memoryTokens
  const conversationHistory = input.historyTokens

  const total = systemPrompt + toolDefinitions + memory + conversationHistory
  const available = modelLimit > 0 ? Math.max(0, modelLimit - total) : 0

  return {
    systemPrompt,
    toolDefinitions,
    memory,
    conversationHistory,
    total,
    available,
    modelLimit,
  }
}

export function getStatus(usagePercent: number): ContextStatus {
  if (usagePercent >= 90) return "critical"
  if (usagePercent >= 75) return "high"
  if (usagePercent >= 50) return "moderate"
  return "good"
}

export function formatBreakdown(breakdown: ContextBreakdown): string {
  const barWidth = 30
  const knownLimit = breakdown.modelLimit > 0
  const usagePercent = knownLimit ? Math.round((breakdown.total / breakdown.modelLimit) * 100) : 0
  const status = getStatus(usagePercent)

  const statusColors: Record<ContextStatus, string> = {
    good: "\x1b[32m", // green
    moderate: "\x1b[33m", // yellow
    high: "\x1b[38;5;208m", // orange
    critical: "\x1b[31m", // red
  }
  const reset = "\x1b[0m"
  const dim = "\x1b[2m"
  const bold = "\x1b[1m"

  function bar(tokens: number, label: string): string {
    const percent = knownLimit ? tokens / breakdown.modelLimit : 0
    // Clamp: when tokens overflow the model limit (renders during error /
    // post-compaction states) `filled > barWidth` and `empty < 0`, which
    // makes String.repeat throw RangeError. Bound both ends.
    const filled = Math.max(0, Math.min(barWidth, Math.round(percent * barWidth)))
    const empty = barWidth - filled
    const bar = "\u2588".repeat(filled) + dim + "\u2591".repeat(empty) + reset
    return `  ${bar}  ${label.padEnd(22)} ${tokens.toLocaleString().padStart(8)}`
  }

  const limitLine = knownLimit
    ? `  Model limit:  ${breakdown.modelLimit.toLocaleString()} tokens`
    : `  Model limit:  ${dim}unknown${reset}`
  const usedLine = knownLimit
    ? `  Used:         ${breakdown.total.toLocaleString()} tokens (${usagePercent}%)`
    : `  Used:         ${breakdown.total.toLocaleString()} tokens`
  const availableLine = knownLimit
    ? `  Available:    ${breakdown.available.toLocaleString()} tokens`
    : `  Available:    ${dim}unknown${reset}`

  const lines = ["", `${bold}Context Window Usage${reset}`, "", limitLine, usedLine, availableLine]
  if (knownLimit) {
    lines.push(`  Status:       ${statusColors[status]}${status.toUpperCase()}${reset}`)
  }
  lines.push("")
  lines.push(`${bold}Breakdown:${reset}`)
  lines.push(bar(breakdown.systemPrompt, "System prompt"))
  lines.push(bar(breakdown.toolDefinitions, "Tool definitions"))
  lines.push(bar(breakdown.memory, "Memory / AGENTS.md"))
  lines.push(bar(breakdown.conversationHistory, "Conversation history"))
  lines.push("")

  if (knownLimit && status === "critical") {
    lines.push(`  ${statusColors.critical}WARNING: Context almost full. Use /clear or start a new session.${reset}`)
    lines.push("")
  } else if (knownLimit && status === "high") {
    lines.push(`  ${statusColors.high}Note: Context usage is high. Consider /clear if responses degrade.${reset}`)
    lines.push("")
  }

  return lines.join("\n")
}
