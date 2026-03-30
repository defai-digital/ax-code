/**
 * Token usage collector
 * Tracks cumulative token usage across a session
 */

import type { TokenUsage, ContextReport } from "./types"
import { calculateBreakdown, getStatus } from "./breakdown"
import { estimateCost } from "./cost"

export class StatsCollector {
  private usage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
  }
  private messageCount = 0
  private toolCallCount = 0
  private providerID = ""
  private modelID = ""

  /**
   * Record token usage from an API response
   */
  record(input: {
    promptTokens?: number
    completionTokens?: number
    reasoningTokens?: number
    cachedTokens?: number
    totalTokens?: number
    providerID?: string
    modelID?: string
    toolCalls?: number
  }) {
    this.usage.promptTokens += input.promptTokens ?? 0
    this.usage.completionTokens += input.completionTokens ?? 0
    this.usage.reasoningTokens += input.reasoningTokens ?? 0
    this.usage.cachedTokens += input.cachedTokens ?? 0
    this.usage.totalTokens += input.totalTokens ?? 0
    this.messageCount++
    this.toolCallCount += input.toolCalls ?? 0
    if (input.providerID) this.providerID = input.providerID
    if (input.modelID) this.modelID = input.modelID
  }

  /**
   * Get current cumulative usage
   */
  getUsage(): TokenUsage {
    return { ...this.usage }
  }

  /**
   * Generate a full context report
   */
  getReport(input?: {
    systemPromptLength?: number
    toolCount?: number
    memoryTokens?: number
  }): ContextReport {
    const breakdown = calculateBreakdown({
      modelID: this.modelID,
      systemPromptLength: input?.systemPromptLength ?? 5000,
      toolCount: input?.toolCount ?? 15,
      memoryTokens: input?.memoryTokens ?? 0,
      historyTokens: this.usage.promptTokens,
    })

    const usagePercent = breakdown.modelLimit > 0
      ? Math.round((breakdown.total / breakdown.modelLimit) * 100)
      : 0

    const cost = estimateCost(
      this.providerID,
      this.usage.promptTokens,
      this.usage.completionTokens,
      this.usage.cachedTokens,
    )

    return {
      breakdown,
      status: getStatus(usagePercent),
      usagePercent,
      sessionInfo: {
        messageCount: this.messageCount,
        toolCallCount: this.toolCallCount,
      },
      cost,
    }
  }

  /**
   * Format usage as readable string
   */
  formatUsage(): string {
    const dim = "\x1b[2m"
    const bold = "\x1b[1m"
    const reset = "\x1b[0m"

    const cost = estimateCost(
      this.providerID,
      this.usage.promptTokens,
      this.usage.completionTokens,
      this.usage.cachedTokens,
    )

    const lines = [
      "",
      `${bold}Session Token Usage${reset}`,
      "",
      `  Provider:     ${this.providerID || "unknown"}`,
      `  Model:        ${this.modelID || "unknown"}`,
      `  Messages:     ${this.messageCount}`,
      `  Tool calls:   ${this.toolCallCount}`,
      "",
      `  Input:        ${this.usage.promptTokens.toLocaleString()} tokens`,
      `  Output:       ${this.usage.completionTokens.toLocaleString()} tokens`,
      `  Reasoning:    ${this.usage.reasoningTokens.toLocaleString()} tokens`,
      `  Cached:       ${this.usage.cachedTokens.toLocaleString()} tokens`,
      `  Total:        ${this.usage.totalTokens.toLocaleString()} tokens`,
      "",
      `  ${bold}Estimated cost: $${cost.totalCost.toFixed(4)}${reset} ${dim}(input: $${cost.inputCost.toFixed(4)}, output: $${cost.outputCost.toFixed(4)})${reset}`,
      "",
    ]

    return lines.join("\n")
  }

  /**
   * Reset all stats
   */
  reset() {
    this.usage = {
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
    }
    this.messageCount = 0
    this.toolCallCount = 0
  }
}

// Global collector instance
let globalCollector: StatsCollector | undefined

export function getCollector(): StatsCollector {
  if (!globalCollector) globalCollector = new StatsCollector()
  return globalCollector
}

export function resetCollector() {
  globalCollector = new StatsCollector()
}
