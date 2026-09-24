import { Tool } from "./tool"
import DESCRIPTION from "./context_status.txt"
import z from "zod"
import { Config } from "../config/config"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { getModelCapabilities } from "../provider/model-capabilities"
import { SessionCompaction } from "../session/compaction"
import {
  calculateCompactionBudget,
  effectiveTokenTotal,
  type CompactionBudget,
  type CompactionWindowOptions,
} from "../session/compaction-budget"
import { MessageV2 } from "../session/message-v2"
import { ObservedWindow } from "../provider/observed-window"
import { TokenLedger } from "../provider/token-ledger"

// Resolve the model this tool was initialized for, falling back to the
// session's most recent user message model and finally the configured
// default model. Read-only: a model that cannot be resolved is a hard error,
// never a guessed one.
async function resolveModel(initModel: { providerID: string; modelID: string } | undefined, ctx: Tool.Context) {
  if (initModel) {
    const reference = await Provider.resolveRequestedModel({
      providerID: ProviderID.make(initModel.providerID),
      modelID: ModelID.make(initModel.modelID),
    })
    const model = await Provider.getModel(reference.providerID, reference.modelID).catch(() => undefined)
    if (model) return model
  }
  const user = ctx.messages.findLast((msg) => msg.info.role === "user")
  if (user && user.info.role === "user") {
    const reference = await Provider.resolveRequestedModel(user.info.model)
    const model = await Provider.getModel(reference.providerID, reference.modelID).catch(() => undefined)
    if (model) return model
  }
  const fallback = await Provider.defaultModel()
  return Provider.getModel(fallback.providerID, fallback.modelID)
}

// The budget the compactor measures against. SessionCompaction.budget() is
// the primary source; when auto-compaction is disabled it reports nothing,
// so fall back to the raw request budget (same math, ignoring `auto`) and
// flag auto-compaction as off in the metadata. When the model declares no
// context window at all (limit.context === 0), fall back to the capability
// registry's contextWindow so the tool still reports a meaningful status.
// Observed-window calibration (ADR-139 D3) feeds the cap: a shrunken
// deployment window replaces the catalog cap; an unknown window is reported
// as such and auto-compaction stays off for the route.
async function resolveBudget(model: Provider.Model): Promise<{
  budget: CompactionBudget
  auto: boolean
  windowSource: "catalog" | "observed" | "unknown"
  observedWindow?: number
}> {
  const resolution = await ObservedWindow.store().resolveWindow(ObservedWindow.routeKeyFor(model), model.limit.context)
  const windowOptions: CompactionWindowOptions | undefined =
    resolution.kind === "observed"
      ? { observedWindow: resolution.window }
      : resolution.kind === "unknown"
        ? { windowUnknown: true }
        : undefined
  const windowSource =
    resolution.kind === "observed" ? "observed" : resolution.kind === "unknown" ? "unknown" : "catalog"
  const observedWindow = resolution.kind === "observed" ? resolution.window : undefined

  const auto = await SessionCompaction.budget(model)
  if (auto) return { budget: auto, auto: true, windowSource, observedWindow }
  const config = await Config.get()
  const request = calculateCompactionBudget(model, config.compaction?.reserved, windowOptions)
  if (request) {
    return {
      budget: request,
      auto: false,
      windowSource,
      observedWindow,
    }
  }
  const capabilities = getModelCapabilities(model.id, model.providerID)
  const fallback = calculateCompactionBudget(
    {
      providerID: model.providerID,
      limit: { context: capabilities.contextWindow, output: model.limit.output },
    },
    config.compaction?.reserved,
  )
  if (!fallback) {
    throw new Error(
      `Cannot determine the context window for model ${model.providerID}/${model.id}; it declares no token limit.`,
    )
  }
  return { budget: fallback, auto: false, windowSource, observedWindow }
}

function lastUsedTokens(messages: MessageV2.WithParts[]) {
  const last = messages.findLast((msg) => {
    if (msg.info.role !== "assistant") return false
    const tokens = msg.info.tokens
    return (
      tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write > 0 ||
      (tokens.total ?? 0) > 0
    )
  })
  if (!last || last.info.role !== "assistant") return 0
  // The compactor measures the LATEST step's usage against the budget.
  // Message-level totals accumulate across every step of the turn (each
  // tool-calling loop re-sends the full context), so reporting them would
  // inflate "used" by roughly the step count and tell the model its context
  // is nearly full when it is not. Fall back to the message totals only when
  // no step-finish part exists (single-step turns, where they agree).
  const step = last.parts.findLast((part): part is MessageV2.StepFinishPart => part.type === "step-finish")
  return effectiveTokenTotal(step?.tokens ?? last.info.tokens)
}

/**
 * Ledger breakdown for the current request prefix (ADR-139 D2/D5). Returns
 * undefined when no anchor matches — callers then fall back to the
 * last-step usage snapshot. The tool cannot reconstruct the rendered system
 * prompt or tool surface, so anchor matching here is IDs + revision only.
 */
async function ledgerBreakdown(
  model: Provider.Model,
  ctx: Tool.Context,
): Promise<TokenLedger.LedgerBreakdown | undefined> {
  const messageIDs = ctx.messages.map((msg) => msg.info.id)
  if (messageIDs.length === 0) return undefined
  const ledger = TokenLedger.forSession(ctx.sessionID)
  // The tool cannot reconstruct the rendered system prompt or tool surface,
  // so anchor matching here is IDs + revision only (full-hash callers get
  // system/tool-change invalidation; see TokenLedger.findAnchor).
  const found = ledger.findAnchor({
    messageIDs,
    revision: TokenLedger.revisionFor(ctx.sessionID),
    routeKey: ObservedWindow.routeKeyFor(model),
  })
  if (!found) return undefined
  // Fresh conversion (no shared cache): transform plugins may mutate message
  // objects in place, and this tool runs outside the prompt loop's cache
  // policy. context_status is a diagnostic call, so the extra conversion cost
  // is acceptable.
  const modelMessages = await MessageV2.toModelMessages(ctx.messages, model)
  return ledger.current({
    messageIDs,
    revision: TokenLedger.revisionFor(ctx.sessionID),
    routeKey: ObservedWindow.routeKeyFor(model),
    tail: { system: [], messages: modelMessages },
  })
}

const parameters = z.object({})

export const ContextStatusTool = Tool.define("context_status", async (initCtx) => {
  const initModel = initCtx?.model
  return {
    description: DESCRIPTION,
    parameters,
    async execute(_params, ctx) {
      const model = await resolveModel(initModel, ctx)
      const { budget, auto, windowSource, observedWindow } = await resolveBudget(model)
      const breakdown = await ledgerBreakdown(model, ctx).catch(() => undefined)
      // The ledger total (measured anchor + drift-corrected tail estimate)
      // replaces the last-step usage snapshot only when a matching anchor
      // exists; otherwise the step usage is the freshest real evidence.
      const used = breakdown ? breakdown.total : lastUsedTokens(ctx.messages)
      const headroom = Math.max(0, budget.usable - used)
      const status = {
        cap: budget.cap,
        usable: budget.usable,
        used,
        headroom,
      }
      return {
        title: `${used}/${budget.usable} tokens used`,
        metadata: {
          ...status,
          reserved: budget.cap - budget.usable,
          autoCompaction: auto,
          providerID: model.providerID,
          modelID: model.id,
          windowSource,
          observedWindow,
          ledger: breakdown,
        },
        output: JSON.stringify(status, null, 2),
      }
    },
  }
})
