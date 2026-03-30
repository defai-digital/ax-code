/**
 * Context Stats Module
 *
 * Tracks token usage, calculates context breakdown, estimates costs.
 *
 * Usage:
 *   import { getCollector } from "../stats"
 *   const collector = getCollector()
 *   collector.record({ promptTokens: 100, completionTokens: 50, providerID: "xai", modelID: "grok-4" })
 *   console.log(collector.formatUsage())
 */

export { StatsCollector, getCollector, resetCollector } from "./collector"
export { calculateBreakdown, getModelLimit, estimateTokens, getStatus, formatBreakdown } from "./breakdown"
export { estimateCost, getPricing } from "./cost"
export type { TokenUsage, ContextBreakdown, ContextStatus, ContextReport, CostEstimate, ProviderPricing } from "./types"
