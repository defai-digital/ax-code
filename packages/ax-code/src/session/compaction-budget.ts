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

// Observed-window (ADR-139 D3) budget options. `cap` replaces
// `limit.input || limit.context` when an observed window exists; an unknown
// window returns no budget at all — auto-compaction stays off for that route
// (same shape as `limit.context === 0`).
export type CompactionWindowOptions = {
  observedWindow?: number
  windowUnknown?: boolean
}

// Minimum max-output worth sending: below this the correct action is
// compaction, not a tiny max_tokens (ADR-139 D4).
export const OUTPUT_FLOOR = 1_024

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
  window?: CompactionWindowOptions,
): CompactionBudget | undefined {
  if (window?.windowUnknown) return undefined
  const context = model.limit.context
  if (context === 0) return undefined

  // For prompt-cached providers (Claude) limit.input is the input cap and
  // is smaller than limit.context; otherwise context is the cap. Use `||`
  // so a stray `limit.input: 0` falls through to context — `??` would
  // treat 0 as a valid cap and never compact. A calibrated observed window
  // (ADR-139 D3) replaces both: it is the deployment's real, possibly
  // shrunken, ceiling.
  const declaredInput = model.limit.input
  const observed =
    window?.observedWindow !== undefined && Number.isFinite(window.observedWindow) && window.observedWindow > 0
      ? Math.floor(window.observedWindow)
      : undefined
  const cap = observed ?? (declaredInput || context)
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

/**
 * Completion clamp against the TOTAL window (ADR-139 D4): cache reads occupy
 * the window, so the output budget is `context - used - reserve`, where
 * `reserve` is the same compaction reserve (one reserve pool, no
 * double-reserving). Static per-provider ceilings stay the outer bound —
 * callers pass them as `staticCeiling`. Returns undefined when the remaining
 * window is at or below the output floor: the correct action then is
 * compaction (existing preflight path), not a tiny max_tokens.
 *
 * The floor check runs against the FINAL clamped value, not just `remaining`:
 * a tiny `staticCeiling` (e.g. a provider cap below OUTPUT_FLOOR) would
 * otherwise leak through `min(staticCeiling, remaining)` and silently tell
 * the caller to send a max_tokens no model can usefully reply to.
 */
export function completionClamp(input: {
  context: number
  used: number
  reserve: number
  staticCeiling: number
}): number | undefined {
  const context = Math.floor(input.context)
  if (!Number.isFinite(context) || context <= 0) return undefined
  const remaining = context - Math.max(0, input.used) - Math.max(0, input.reserve)
  if (!Number.isFinite(remaining) || remaining <= OUTPUT_FLOOR) return undefined
  const clamped = Math.max(0, Math.min(Math.floor(input.staticCeiling), Math.floor(remaining)))
  if (clamped <= OUTPUT_FLOOR) return undefined
  return clamped
}

/**
 * The window the completion clamp measures against (ADR-139 D3/D4): a
 * calibrated observed window when one exists, otherwise the catalog limit.
 * Clamping against the catalog limit on a shrunken route re-opens the exact
 * overflow -> compact -> overflow loop the clamp exists to prevent, so the
 * observed window must win here exactly as it does in the compaction budget.
 */
export function effectiveClampWindow(input: { catalogLimit: number; observedWindow?: number }): number {
  if (input.observedWindow !== undefined && Number.isFinite(input.observedWindow) && input.observedWindow > 0) {
    return Math.floor(input.observedWindow)
  }
  return input.catalogLimit
}
