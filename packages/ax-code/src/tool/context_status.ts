import { Tool } from "./tool"
import DESCRIPTION from "./context_status.txt"
import z from "zod"
import { Config } from "../config/config"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { getModelCapabilities } from "../provider/model-capabilities"
import { SessionCompaction } from "../session/compaction"
import { calculateCompactionBudget, effectiveTokenTotal, type CompactionBudget } from "../session/compaction-budget"
import type { MessageV2 } from "../session/message-v2"

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
async function resolveBudget(model: Provider.Model): Promise<{ budget: CompactionBudget; auto: boolean }> {
  const auto = await SessionCompaction.budget(model)
  if (auto) return { budget: auto, auto: true }
  const config = await Config.get()
  const request = calculateCompactionBudget(model, config.compaction?.reserved)
  if (request) return { budget: request, auto: false }
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
  return { budget: fallback, auto: false }
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

const parameters = z.object({})

export const ContextStatusTool = Tool.define("context_status", async (initCtx) => {
  const initModel = initCtx?.model
  return {
    description: DESCRIPTION,
    parameters,
    async execute(_params, ctx) {
      const model = await resolveModel(initModel, ctx)
      const { budget, auto } = await resolveBudget(model)
      const used = lastUsedTokens(ctx.messages)
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
        },
        output: JSON.stringify(status, null, 2),
      }
    },
  }
})
