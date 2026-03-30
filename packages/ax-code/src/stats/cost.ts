/**
 * Cost estimation per provider
 * Prices in USD per 1,000 tokens
 */

import type { ProviderPricing, CostEstimate } from "./types"

const PRICING: Record<string, ProviderPricing> = {
  // Google Gemini
  "google": {
    inputPer1kTokens: 0.00025,
    outputPer1kTokens: 0.001,
    cachedPer1kTokens: 0.0000625,
  },
  // xAI Grok
  "xai": {
    inputPer1kTokens: 0.003,
    outputPer1kTokens: 0.015,
  },
  // Groq (free tier)
  "groq": {
    inputPer1kTokens: 0.0,
    outputPer1kTokens: 0.0,
  },
  // Z.AI / GLM
  "zai": {
    inputPer1kTokens: 0.001,
    outputPer1kTokens: 0.002,
  },
  "zai-coding-plan": {
    inputPer1kTokens: 0.001,
    outputPer1kTokens: 0.002,
  },
  // Default for unknown providers
  "default": {
    inputPer1kTokens: 0.002,
    outputPer1kTokens: 0.006,
  },
}

export function getPricing(providerID: string): ProviderPricing {
  return PRICING[providerID] ?? PRICING["default"]
}

export function estimateCost(
  providerID: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number = 0,
): CostEstimate {
  const pricing = getPricing(providerID)
  const nonCachedInput = inputTokens - cachedTokens
  const inputCost = (nonCachedInput / 1000) * pricing.inputPer1kTokens
    + (cachedTokens / 1000) * (pricing.cachedPer1kTokens ?? pricing.inputPer1kTokens)
  const outputCost = (outputTokens / 1000) * pricing.outputPer1kTokens

  return {
    inputCost: Math.max(0, inputCost),
    outputCost: Math.max(0, outputCost),
    totalCost: Math.max(0, inputCost + outputCost),
    currency: "USD",
  }
}
