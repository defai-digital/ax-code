import { modelIdFinalSegment } from "./model-id"
import { isMiniMaxM3ModelSegment } from "./protocol-profile"

// MiniMax serves M3-family models with a 1M window but ships 512k as the
// default in its own client (MiniMax Code), with 1M an opt-in marked as
// higher usage. AX Code sizes compaction from limit.context and resends the
// whole context every turn, so a 1M default lets sessions grow to twice the
// vendor default before compacting. Default to the vendor window on every
// route; an explicit `limit.context` in user config still wins.
export const MINIMAX_M3_DEFAULT_CONTEXT = 512_000

/** Vendor-default context window for a model whose catalog lists a larger optional one. */
export function defaultContextWindow(model: { id: string; api: { id: string } }): number | undefined {
  const ids = [model.api.id, model.id].map((id) => modelIdFinalSegment(id))
  if (ids.some(isMiniMaxM3ModelSegment)) return MINIMAX_M3_DEFAULT_CONTEXT
  return undefined
}

export function applyDefaultContextWindow(
  model: { id: string; api: { id: string }; limit: { context: number } },
  explicit: boolean,
): void {
  if (explicit) return
  const window = defaultContextWindow(model)
  if (window !== undefined && model.limit.context > window) model.limit = { ...model.limit, context: window }
}
