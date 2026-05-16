/**
 * LLM-backed replanner factory.
 *
 * Two layers so the executor stays decoupled from the AI SDK:
 *   - `llmReplanner(generator)` wraps any generator into a `Replanner`.
 *   - `providerReplanGenerator(opts)` is the standard Provider-backed
 *     generator using `generateObject`.
 *
 * Tests pass an in-memory generator. Production code typically writes
 * `Planner.llmReplanner(Planner.providerReplanGenerator())`.
 */

import z from "zod"
import type { ModelID, ProviderID } from "../provider/schema"
import { Log } from "../util/log"
import type { Replanner, TaskPhase } from "./types"

// Provider + AI SDK are imported lazily inside `providerReplanGenerator` so
// callers using only the in-memory `llmReplanner(fakeGenerator)` or
// `withApproval` paths never pay the Provider module-init cost — and tests
// don't need the optional Provider deps installed.

const log = Log.create({ service: "planner.replan-llm" })

export type ReplanPhase = Partial<TaskPhase> & { name: string }

export interface ReplanContext {
  goal: string
  failed: TaskPhase
  error: string
  depth: number
  constraints?: string[]
}

export type ReplanGenerator = (ctx: ReplanContext) => Promise<ReplanPhase[]>

export interface LlmReplannerWrapOptions {
  /** Soft cap on phases returned to the executor. */
  maxPhases?: number
}

/**
 * Wrap a generator into a `Replanner`. Empty/throwing generators map to
 * `null` so the executor falls back to abort gracefully.
 */
export function llmReplanner(generator: ReplanGenerator, opts: LlmReplannerWrapOptions = {}): Replanner {
  const cap = opts.maxPhases ?? 4
  return async ({ failed, plan, error, depth }) => {
    try {
      const phases = await generator({
        goal: plan.originalPrompt,
        failed,
        error,
        depth,
        constraints: plan.constraints,
      })
      if (!phases || phases.length === 0) return null
      return phases.slice(0, cap)
    } catch (err) {
      log.warn("replan generator failed", { failedId: failed.id, error: String(err) })
      return null
    }
  }
}

const PHASE_SCHEMA = z.object({
  name: z.string(),
  description: z.string().optional(),
  objectives: z.array(z.string()).optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  fallbackStrategy: z.enum(["retry", "skip", "abort", "replan"]).optional(),
  canRunInParallel: z.boolean().optional(),
})

const REPLAN_SCHEMA = z.object({
  reasoning: z.string().optional(),
  phases: z.array(PHASE_SCHEMA).min(1).max(8),
})

const REPLAN_SYSTEM = `You are a planning assistant. A phase of a multi-step plan just failed.
Propose 1–4 replacement phases that work around the failure and still achieve the original goal.
Prefer the simplest decomposition. Avoid over-engineering and new abstractions.
Each phase must have a clear name and concrete objectives. Respect any listed constraints.`

export interface ProviderReplanOptions {
  /** Override the model — defaults to Provider.defaultModel(). */
  model?: { providerID: ProviderID; modelID: ModelID }
  /** Abort the LLM call after this many ms. */
  timeoutMs?: number
  /**
   * When true (default), and `model` is unset, look up the architect model
   * from config (`experimental.planner_architect_model: "providerID/modelID"`).
   * When the config field is unset or malformed, falls back to the executor's
   * default model.
   */
  useArchitectModel?: boolean
}

/**
 * Resolve the architect model from config. Returns null when no architect
 * is configured or the config string can't be parsed. Format: "providerID/modelID".
 *
 * The Config module is imported lazily so callers using only the in-memory
 * `llmReplanner(fakeGenerator)` path don't pay the Config init cost.
 */
export async function configuredArchitectModel(): Promise<{ providerID: ProviderID; modelID: ModelID } | null> {
  const { Config } = await import("../config/config")
  const ref = (await Config.get()).experimental?.planner_architect_model
  if (!ref) return null
  const slash = ref.indexOf("/")
  if (slash <= 0 || slash === ref.length - 1) {
    log.warn("ignoring malformed planner_architect_model", { value: ref })
    return null
  }
  return {
    providerID: ref.slice(0, slash) as ProviderID,
    modelID: ref.slice(slash + 1) as ModelID,
  }
}

/**
 * Provider-backed `ReplanGenerator`. Uses the AI SDK's `generateObject` with
 * a structured schema. Aborts on timeout; throws on schema mismatch (the
 * wrapper translates that to `null`).
 */
export function providerReplanGenerator(opts: ProviderReplanOptions = {}): ReplanGenerator {
  return async (ctx) => {
    const { Provider } = await import("../provider/provider")
    const { generateObject } = await import("ai")
    let modelRef: { providerID: ProviderID; modelID: ModelID } | undefined = opts.model
    if (!modelRef && opts.useArchitectModel !== false) {
      const architect = await configuredArchitectModel()
      if (architect) modelRef = architect
    }
    if (!modelRef) modelRef = await Provider.defaultModel()
    const resolved = await Provider.getModel(modelRef.providerID, modelRef.modelID)
    const language = await Provider.getLanguage(resolved)

    const userPrompt = buildUserPrompt(ctx)
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? 30_000)
    try {
      const result = await generateObject({
        model: language,
        schema: REPLAN_SCHEMA,
        abortSignal: abort.signal,
        messages: [
          { role: "system", content: REPLAN_SYSTEM },
          { role: "user", content: userPrompt },
        ],
      }).then((r: { object: z.infer<typeof REPLAN_SCHEMA> }) => r.object)
      return result.phases as ReplanPhase[]
    } finally {
      clearTimeout(timer)
    }
  }
}

export interface ApprovalInput {
  proposed: ReplanPhase[]
  ctx: ReplanContext
}

/**
 * Approver receives the LLM-proposed phases and returns the (possibly
 * filtered or edited) phases to execute. Returning null/[] aborts gracefully.
 */
export type Approver = (input: ApprovalInput) => Promise<ReplanPhase[] | null>

/**
 * Higher-order generator that runs `generator`, then asks `approve` to
 * filter/edit/reject the proposed phases. Useful for human-in-the-loop or
 * Question-mediated approval before executing replan output.
 *
 * If `generator` returns nothing, `approve` is not called.
 */
export function withApproval(generator: ReplanGenerator, approve: Approver): ReplanGenerator {
  return async (ctx) => {
    const proposed = await generator(ctx)
    if (!proposed || proposed.length === 0) return []
    const approved = await approve({ proposed, ctx })
    if (!approved || approved.length === 0) return []
    return approved
  }
}

export function buildUserPrompt(ctx: ReplanContext): string {
  const lines = [`Original goal: ${ctx.goal}`, "", `Failed phase: "${ctx.failed.name}"`]
  if (ctx.failed.description) lines.push(`Description: ${ctx.failed.description}`)
  if (ctx.failed.objectives?.length) {
    lines.push("Original objectives:")
    for (const o of ctx.failed.objectives) lines.push(`  - ${o}`)
  }
  lines.push(`Error: ${ctx.error}`)
  lines.push(`Replan depth: ${ctx.depth}`)
  if (ctx.constraints?.length) {
    lines.push("Constraints:")
    for (const c of ctx.constraints) lines.push(`  - ${c}`)
  }
  lines.push("")
  lines.push("Propose 1–4 replacement phases.")
  return lines.join("\n")
}
