/**
 * Local token-cost estimation (ADR-084).
 *
 * A versioned, hand-curated USD-per-million-token table for the model
 * families this product is most commonly run on. Pricing is never fetched
 * at runtime: costs are computed at read time from already-recorded token
 * counts, so correcting a stale price fixes historical reports too.
 *
 * Honesty over coverage: a model with no matching entry estimates as
 * `undefined` and is excluded from dollar totals — an unpriced model must
 * never silently read as free. Surfaces that render estimates show a
 * coverage share so users can see how much of the usage is priced.
 *
 * Matching precedence:
 *   1. exact `providerID/modelID`
 *   2. exact `modelID`
 *   3. longest model-prefix entry (`claude-sonnet-4*` style family rules)
 *
 * Adding or changing prices is a table revision: bump PRICING_VERSION and
 * note the date in the changelog comment.
 */

export namespace Pricing {
  export const PRICING_VERSION = 1

  export type Rates = {
    /** USD per 1M input tokens */
    input: number
    /** USD per 1M output tokens (reasoning tokens price as output) */
    output: number
    /** USD per 1M cache-read tokens; defaults to `input` when omitted */
    cacheRead?: number
    /** USD per 1M cache-write tokens; defaults to `input` when omitted */
    cacheWrite?: number
  }

  type Entry = {
    /** optional provider constraint (`anthropic`, `openai`, …) */
    provider?: string
    /** exact model id, or a family prefix when `prefix: true` */
    model: string
    prefix?: boolean
    rates: Rates
  }

  // Snapshot: 2026-09 published list prices for common families. Values are
  // estimates for budgeting, not billing statements.
  const TABLE: readonly Entry[] = [
    // Anthropic
    {
      provider: "anthropic",
      model: "claude-opus-4",
      prefix: true,
      rates: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    },
    {
      provider: "anthropic",
      model: "claude-sonnet-4",
      prefix: true,
      rates: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    },
    {
      provider: "anthropic",
      model: "claude-haiku-4",
      prefix: true,
      rates: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    },
    {
      provider: "anthropic",
      model: "claude-3-7-sonnet",
      prefix: true,
      rates: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    },
    {
      provider: "anthropic",
      model: "claude-3-5-haiku",
      prefix: true,
      rates: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    },
    // OpenAI
    { provider: "openai", model: "gpt-5", prefix: true, rates: { input: 1.25, output: 10, cacheRead: 0.125 } },
    { provider: "openai", model: "gpt-4.1", prefix: true, rates: { input: 2, output: 8, cacheRead: 0.5 } },
    { provider: "openai", model: "gpt-4o", prefix: true, rates: { input: 2.5, output: 10, cacheRead: 1.25 } },
    { provider: "openai", model: "o3", prefix: true, rates: { input: 2, output: 8, cacheRead: 0.5 } },
    { provider: "openai", model: "o4-mini", prefix: true, rates: { input: 1.1, output: 4.4, cacheRead: 0.275 } },
    // Google
    { provider: "google", model: "gemini-3", prefix: true, rates: { input: 2, output: 12 } },
    { provider: "google", model: "gemini-2.5-pro", prefix: true, rates: { input: 1.25, output: 10 } },
    { provider: "google", model: "gemini-2.5-flash", prefix: true, rates: { input: 0.3, output: 2.5 } },
    // DeepSeek
    { model: "deepseek-chat", prefix: true, rates: { input: 0.27, output: 1.1, cacheRead: 0.07 } },
    { model: "deepseek-reasoner", prefix: true, rates: { input: 0.55, output: 2.19, cacheRead: 0.14 } },
    // xAI
    { model: "grok-4", prefix: true, rates: { input: 3, output: 15 } },
  ]

  export type TokenCounts = {
    input: number
    output: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }

  function specificity(entry: Entry, providerID: string | undefined, modelID: string): number {
    const providerBonus = entry.provider !== undefined && entry.provider === providerID ? 100_000 : 0
    if (!entry.prefix) {
      return providerBonus + (entry.model === modelID ? 10_000 : -1)
    }
    if (!modelID.startsWith(entry.model)) return -1
    return providerBonus + entry.model.length
  }

  /** Best-matching rates for a model, or undefined when nothing matches. */
  export function ratesFor(modelID: string, providerID?: string): Rates | undefined {
    let best: { score: number; rates: Rates } | undefined
    for (const entry of TABLE) {
      const score = specificity(entry, providerID, modelID)
      if (score < 0) continue
      if (!best || score > best.score) best = { score, rates: entry.rates }
    }
    return best?.rates
  }

  /**
   * Estimated USD cost for recorded token counts, or undefined when the
   * model has no pricing entry. Reasoning tokens are priced as output;
   * missing cache rates fall back to the input rate.
   */
  export function estimateCost(modelID: string, tokens: TokenCounts, providerID?: string): { usd: number } | undefined {
    const rates = ratesFor(modelID, providerID)
    if (!rates) return undefined
    const cacheRead = rates.cacheRead ?? rates.input
    const cacheWrite = rates.cacheWrite ?? rates.input
    const usd =
      (tokens.input / 1_000_000) * rates.input +
      ((tokens.output + (tokens.reasoning ?? 0)) / 1_000_000) * rates.output +
      ((tokens.cache?.read ?? 0) / 1_000_000) * cacheRead +
      ((tokens.cache?.write ?? 0) / 1_000_000) * cacheWrite
    return { usd }
  }
}
