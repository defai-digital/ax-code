/**
 * Context Stats Types
 */

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cachedTokens: number
  totalTokens: number
}

export interface ContextBreakdown {
  systemPrompt: number
  toolDefinitions: number
  memory: number
  conversationHistory: number
  total: number
  available: number
  modelLimit: number
}

export type ContextStatus = "good" | "moderate" | "high" | "critical"

export interface ContextReport {
  breakdown: ContextBreakdown
  status: ContextStatus
  usagePercent: number
  sessionInfo: {
    messageCount: number
    toolCallCount: number
  }
}
