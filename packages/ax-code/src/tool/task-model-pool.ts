import z from "zod"
import type { ModelPool } from "../config/schema-impl"
import type { ModelID, ProviderID } from "../provider/schema"

// ADR-218: resolve the task/task_parallel `model` parameter against the
// user-configured agents.model_pool. Arbitrary model strings are rejected so
// the caller cannot route a subagent to a provider the user never listed;
// only pool aliases and the literal "primary" are accepted.

export type ModelPoolLike = ModelPool | undefined

export type PooledModelRef = { modelID: ModelID; providerID: ProviderID }

/** Parse "provider/model" at the first slash; providers cannot contain one but models may. */
export function parseModelRef(model: string): PooledModelRef {
  const slash = model.indexOf("/")
  if (slash <= 0 || slash === model.length - 1) {
    throw new Error(`Model pool entries must be "provider/model", got "${model}"`)
  }
  return { providerID: model.slice(0, slash) as ProviderID, modelID: model.slice(slash + 1) as ModelID }
}

function entriesByAlias(pool: ModelPoolLike): Map<string, { model: string }> {
  const map = new Map<string, { model: string }>()
  for (const entry of pool?.models ?? []) map.set(entry.alias, entry)
  return map
}

function unknownAliasError(pool: ModelPoolLike, requested: string): Error {
  const aliases = [...entriesByAlias(pool).keys()].sort((a, b) => a.localeCompare(b))
  const listing = aliases.length ? [...aliases, "primary"].join(", ") : "primary"
  return new Error(
    `Unknown model alias "${requested}". Valid aliases: ${listing}. Add the alias to agents.model_pool in config to use it.`,
  )
}

/**
 * The zod `model` parameter advertised when a pool exists. Returns undefined
 * without a pool so the tool parameter schemas stay byte-identical to the
 * pre-pool shape (ADR-218 requirement).
 */
export function modelPoolParameter(pool: ModelPoolLike): z.ZodOptional<z.ZodString> | undefined {
  if (!pool || pool.models.length === 0) return undefined
  const listing = pool.models
    .map((entry) => `- ${entry.alias}: ${entry.hint ?? entry.model}`)
    .sort((a, b) => a.localeCompare(b))
  const defaultNote = pool.default ? ` Default when omitted: ${pool.default}.` : ""
  return z
    .string()
    .optional()
    .describe(
      [
        `Model alias for this subagent, from agents.model_pool, or "primary" to keep the parent's model.${defaultNote}`,
        "Available aliases:",
        ...listing,
      ].join("\n"),
    )
}

/**
 * Reject an unknown alias before any permission ask or child session exists.
 * A missing pool rejects every value except "primary" — which is only legal
 * when a pool exists, since without a pool the parameter is not advertised.
 */
export function assertPoolAlias(pool: ModelPoolLike, requested: string | undefined): void {
  if (requested === undefined) return
  if (requested !== "primary" && !entriesByAlias(pool).has(requested)) {
    throw unknownAliasError(pool, requested)
  }
}

/**
 * Precedence when resolving the child model: an explicit `model` parameter
 * (alias or "primary") beats the agent's own model pin, which beats the pool
 * `default`, which falls back to the parent's model. The resolved model flows
 * into the normal prompt path, so the provider availability and permission
 * checks that already run for agent-pinned models apply unchanged.
 */
export function resolvePoolModel(input: {
  pool: ModelPoolLike
  requested?: string
  agentPin?: PooledModelRef
  fallback: PooledModelRef
}): PooledModelRef {
  if (input.requested !== undefined) {
    if (input.requested === "primary") return input.fallback
    const entry = entriesByAlias(input.pool).get(input.requested)
    if (!entry) throw unknownAliasError(input.pool, input.requested)
    return parseModelRef(entry.model)
  }
  if (input.agentPin) return input.agentPin
  const defaultEntry = input.pool?.default ? entriesByAlias(input.pool).get(input.pool.default) : undefined
  if (defaultEntry) return parseModelRef(defaultEntry.model)
  return input.fallback
}
