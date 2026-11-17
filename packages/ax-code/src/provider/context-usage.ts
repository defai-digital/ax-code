import { isCliProviderID } from "./cli/ids"
import { effectiveTokenTotal, type CompactionTokenUsage } from "../session/compaction-budget"

type ContextModel = { providerID: string; api?: { npm?: string } }

export function isCliUsageModel(model: ContextModel): boolean {
  return model.api?.npm === "cli" || isCliProviderID(model.providerID)
}

/** Current outer context, never cumulative consumption from a native agent loop. */
export function modelContextTokens(tokens: CompactionTokenUsage, model?: ContextModel | string): number | undefined {
  const cli = typeof model === "string" ? isCliProviderID(model) : model !== undefined && isCliUsageModel(model)
  if (tokens.scope === "run" || (tokens.scope === undefined && cli)) {
    const context = tokens.context
    if (!context || !Number.isFinite(context.input) || !Number.isFinite(context.output)) return undefined
    if (context.input < 0 || context.output < 0) return undefined
    return context.input + context.output
  }
  return effectiveTokenTotal(tokens)
}
