// Pure compaction-budget math shared by the server-side compactor
// (session/compaction.ts) and the TUI footer context gauge. Keep this file
// dependency-free: the TUI bundles it, so it must not pull in server-only
// modules (Database, Bus, Config, ...).

// Default headroom reserved for the next response: 10% of the input
// budget. Keeps compaction firing at ~90% of capacity across every model
// — small (8k) or large (1M / 2M) — without coupling to model.output,
// which is unreliable: some snapshot entries report output == context,
// which would zero out usable under any `context - output` formula.
// Users can override with an explicit `compaction.reserved` token count
// in ax-code.json.
export const DEFAULT_RESERVED_FRACTION = 0.1
export const MIN_USABLE_TOKENS = 1_000

// Super-Long runs compact earlier (~75% of the usable budget instead of
// 100%): nobody is watching to /compact manually, per-turn latency grows
// with history — which is the dominant cost on local inference — and a
// multi-day run otherwise spends its tail end permanently near the cap.
export const SUPER_LONG_USABLE_FRACTION = 0.75

// Structural subset of Provider.Model so the TUI (which only has the SDK
// model shape) and the server can share the math without importing the
// provider module.
export type CompactionBudgetModel = {
  providerID: string
  limit: { context: number; input?: number; output: number }
}

export type CompactionTokenUsage = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
  total?: number
}

export type CompactionBudget = { cap: number; reserved: number; usable: number }

export function componentTokenTotal(tokens: CompactionTokenUsage) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

// The token count the compactor actually compares against the budget: the
// provider-reported total when present, but never less than the sum of the
// components (some providers under-report `total`).
export function effectiveTokenTotal(tokens: CompactionTokenUsage) {
  const total = typeof tokens.total === "number" && Number.isFinite(tokens.total) ? tokens.total : 0
  return Math.max(total, componentTokenTotal(tokens))
}

export function calculateCompactionBudget(
  model: CompactionBudgetModel,
  configuredReserved?: number,
): CompactionBudget | undefined {
  const context = model.limit.context
  if (context === 0) return undefined

  // For prompt-cached providers (Claude) limit.input is the input cap and
  // is smaller than limit.context; otherwise context is the cap. Use `||`
  // so a stray `limit.input: 0` falls through to context — `??` would
  // treat 0 as a valid cap and never compact.
  const declaredInput = model.limit.input
  const cap = declaredInput || context
  // AX Engine rejects prompt + requested output above context. New model
  // cards expose an explicit input cap, but retain a safe fallback for older
  // config overrides that only declare context/output.
  const defaultReserved =
    model.providerID === "ax-engine" && !declaredInput
      ? Math.max(Math.ceil(cap * DEFAULT_RESERVED_FRACTION), model.limit.output)
      : Math.ceil(cap * DEFAULT_RESERVED_FRACTION)
  const reserved = configuredReserved ?? defaultReserved
  const usable = Math.max(0, cap - reserved)
  return { cap, reserved, usable }
}

// Denominator for the TUI footer context gauge. With auto-compaction on,
// 100% means "the next turn triggers compaction" (the usable budget). With
// auto-compaction disabled — or a degenerate budget the compactor would
// ignore (usable below MIN_USABLE_TOKENS, where compaction never fires) —
// the meaningful ceiling is the raw input cap.
export function compactionGaugeLimit(input: { budget?: CompactionBudget; auto?: boolean }): number | undefined {
  const budget = input.budget
  if (!budget) return undefined
  if (input.auto !== false && budget.usable >= MIN_USABLE_TOKENS) return budget.usable
  return budget.cap
}
