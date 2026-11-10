const CLI_EFFORT_LEVELS: Record<string, readonly string[]> = {
  "codex-cli": ["minimal", "low", "medium", "high", "xhigh"],
  "grok-build-cli": ["low", "medium", "high"],
  "minimax-cli": ["low", "medium", "high"],
}

/**
 * Per-model efforts read from the CLI's own model cache (see native-models.ts),
 * carried on `model.options.cliEfforts`. Undefined when the CLI published none.
 */
export function cliModelEfforts(options: unknown): readonly string[] | undefined {
  if (!options || typeof options !== "object" || Array.isArray(options)) return undefined
  const list = (options as Record<string, unknown>).cliEfforts
  if (!Array.isArray(list)) return undefined
  const efforts = list.filter(
    (item): item is string => typeof item === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(item),
  )
  return efforts.length > 0 ? efforts : undefined
}

export function cliEffortLevels(providerID: string, modelEfforts?: readonly string[]): readonly string[] {
  if (!Object.hasOwn(CLI_EFFORT_LEVELS, providerID)) return []
  return modelEfforts ?? CLI_EFFORT_LEVELS[providerID]
}

export function cliEffortVariants(
  providerID: string,
  modelEfforts?: readonly string[],
): Record<string, Record<string, string>> {
  return Object.fromEntries(cliEffortLevels(providerID, modelEfforts).map((effort) => [effort, { effort }]))
}

export function cliEffortFromProviderOptions(
  providerID: string,
  providerOptions: unknown,
  modelEfforts?: readonly string[],
): string | undefined {
  if (!providerOptions || typeof providerOptions !== "object" || Array.isArray(providerOptions)) return undefined
  const options = (providerOptions as Record<string, unknown>)[providerID]
  if (!options || typeof options !== "object" || Array.isArray(options)) return undefined
  const effort = (options as Record<string, unknown>).effort
  if (typeof effort !== "string" || !cliEffortLevels(providerID, modelEfforts).includes(effort)) return undefined
  return effort
}

export function cliEffortArgs(providerID: string, effort?: string, modelEfforts?: readonly string[]): string[] {
  if (!effort || !cliEffortLevels(providerID, modelEfforts).includes(effort)) return []
  if (providerID === "codex-cli") return ["-c", `model_reasoning_effort="${effort}"`]
  if (providerID === "grok-build-cli") return ["--reasoning-effort", effort]
  if (providerID === "minimax-cli") return ["--effort", effort]
  return []
}
