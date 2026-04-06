/**
 * Context breakdown calculator
 * Estimates token usage by category
 */

import type { ContextBreakdown, ContextStatus } from "./types"

// Model context window sizes (tokens)
const MODEL_LIMITS: Record<string, number> = {
  // Google Gemini
  "gemini-3-pro": 1000000,
  "gemini-3-flash": 1000000,
  // xAI Grok
  "grok-4": 131072,
  // Groq models
  "llama-3.3-70b-versatile": 32768,
  "llama-3.1-8b-instant": 8192,
  "llama-4-scout-17b-16e-instruct": 131072,
  // Z.AI / GLM
  "glm-5": 32768,
  "glm-4.6": 128000,
  // Default
  "default": 128000,
}

// Approximate token count from text (1 token ≈ 4 characters)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function getModelLimit(modelID: string): number {
  // Check exact match first
  if (MODEL_LIMITS[modelID]) return MODEL_LIMITS[modelID]

  // Check partial match
  for (const [key, limit] of Object.entries(MODEL_LIMITS)) {
    if (key === "default") continue
    if (modelID.includes(key)) return limit
  }

  return MODEL_LIMITS["default"]
}

export function calculateBreakdown(input: {
  modelID: string
  systemPromptLength: number
  toolCount: number
  memoryTokens: number
  historyTokens: number
}): ContextBreakdown {
  const modelLimit = getModelLimit(input.modelID)

  // Estimate tokens per category
  const systemPrompt = estimateTokens(" ".repeat(input.systemPromptLength))
  const toolDefinitions = input.toolCount * 800 // ~800 tokens per tool definition
  const memory = input.memoryTokens
  const conversationHistory = input.historyTokens

  const total = systemPrompt + toolDefinitions + memory + conversationHistory
  const available = Math.max(0, modelLimit - total)

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
  const usagePercent = Math.round((breakdown.total / breakdown.modelLimit) * 100)
  const status = getStatus(usagePercent)

  const statusColors: Record<ContextStatus, string> = {
    good: "\x1b[32m",      // green
    moderate: "\x1b[33m",   // yellow
    high: "\x1b[38;5;208m", // orange
    critical: "\x1b[31m",   // red
  }
  const reset = "\x1b[0m"
  const dim = "\x1b[2m"
  const bold = "\x1b[1m"

  function bar(tokens: number, label: string): string {
    const percent = breakdown.modelLimit > 0 ? tokens / breakdown.modelLimit : 0
    const filled = Math.round(percent * barWidth)
    const empty = barWidth - filled
    const bar = "\u2588".repeat(filled) + dim + "\u2591".repeat(empty) + reset
    return `  ${bar}  ${label.padEnd(22)} ${tokens.toLocaleString().padStart(8)}`
  }

  const lines = [
    "",
    `${bold}Context Window Usage${reset}`,
    "",
    `  Model limit:  ${breakdown.modelLimit.toLocaleString()} tokens`,
    `  Used:         ${breakdown.total.toLocaleString()} tokens (${usagePercent}%)`,
    `  Available:    ${breakdown.available.toLocaleString()} tokens`,
    `  Status:       ${statusColors[status]}${status.toUpperCase()}${reset}`,
    "",
    `${bold}Breakdown:${reset}`,
    bar(breakdown.systemPrompt, "System prompt"),
    bar(breakdown.toolDefinitions, "Tool definitions"),
    bar(breakdown.memory, "Memory / AX.md"),
    bar(breakdown.conversationHistory, "Conversation history"),
    "",
  ]

  if (status === "critical") {
    lines.push(`  ${statusColors.critical}WARNING: Context almost full. Use /clear or start a new session.${reset}`)
    lines.push("")
  } else if (status === "high") {
    lines.push(`  ${statusColors.high}Note: Context usage is high. Consider /clear if responses degrade.${reset}`)
    lines.push("")
  }

  return lines.join("\n")
}
