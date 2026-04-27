/**
 * Message complexity classifier — used to pick a small/fast model for simple
 * queries. Keyword-based agent auto-routing was removed (2026-04-27); specialist
 * agents are invoked via @-mention only. The complexity tier survived because
 * it's a model-selection signal, not an agent swap, so being wrong costs at
 * most a slightly larger model — not a context hijack.
 */

import { generateObject } from "ai"
import { Log } from "../util/log"
import { Provider } from "../provider/provider"
import z from "zod"

const log = Log.create({ service: "agent.router" })

const LLM_TIMEOUT = 1500
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
