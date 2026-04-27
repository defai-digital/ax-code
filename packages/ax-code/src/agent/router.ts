/**
 * Message complexity classifier — picks small/big model based on message difficulty.
 *
 * The previous keyword/intent agent auto-router was removed: even after rule loosening
 * and visibility fixes it produced more user confusion than discovery (read-only
 * specialists hijacking action requests, primary-agent swaps surprising users mid-task).
 * Specialist agents stay reachable via @-mention; only the cost-saving fast-model
 * selection survives because its effect is invisible and the trade-off is unambiguous.
 */

import { generateObject } from "ai"
import { Log } from "../util/log"
import { Provider } from "../provider/provider"
import z from "zod"

const log = Log.create({ service: "agent.router" })

const LLM_TIMEOUT = 1500

/** Max characters sent for classification. ~125 tokens is sufficient for complexity detection. */
const CLASSIFY_MAX_CHARS = 500

const COMPLEXITY_PROMPT = `You are a message complexity classifier for a coding assistant. Given a user message, estimate how much reasoning the answer needs.

Levels:
- low: Simple lookup, one-liner explanation, or basic question — minimal reasoning required
- medium: Moderate reasoning, multi-file analysis, or standard debugging
- high: Complex architecture decisions, deep investigation, or large-scale changes

Respond with the complexity level only.`

const complexitySchema = z.object({
  complexity: z.enum(["low", "medium", "high"]),
})

export interface MessageAnalysis {
  complexity: "low" | "medium" | "high" | null
}

/**
 * Classify message complexity. Returns `low` for trivially short messages without
 * an LLM call; otherwise asks the provider's small model for a low/medium/high
 * verdict so the caller can swap to a fast model on simple queries.
 *
 * Activation:
 * - `AX_CODE_SMART_LLM=true` (set by `/smart-llm` route from `routing.llm` config)
 * - A small model must exist for the active provider (see Provider.getSmallModel)
 *
 * Returns `{ complexity: null }` whenever activation conditions fail or the LLM
 * call errors — caller should treat null as "no opinion" and use the default model.
 */
export async function classifyComplexity(message: string): Promise<MessageAnalysis> {
  if (process.env["AX_CODE_SMART_LLM"] !== "true") return { complexity: null }
  if (message.length < 30) return { complexity: "low" }

  const defaultModel = await Provider.defaultModel().catch(() => undefined)
  if (!defaultModel) return { complexity: null }
  const small = await Provider.getSmallModel(defaultModel.providerID)
  if (!small) {
    log.info("complexity-skipped", { reason: "no-small-model" })
    return { complexity: null }
  }
  const language = await Provider.getLanguage(small)

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), LLM_TIMEOUT)
  try {
    const result = await generateObject({
      model: language,
      temperature: 0,
      schema: complexitySchema,
      abortSignal: abort.signal,
      messages: [
        { role: "system" as const, content: COMPLEXITY_PROMPT },
        { role: "user" as const, content: message.slice(0, CLASSIFY_MAX_CHARS) },
      ],
    }).then((r) => r.object)

    log.info("complexity-classify", { complexity: result.complexity })
    return { complexity: result.complexity }
  } catch (err) {
    log.info("complexity-failed", { error: String(err) })
    return { complexity: null }
  } finally {
    clearTimeout(timer)
  }
}
