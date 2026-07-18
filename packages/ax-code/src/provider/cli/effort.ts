const CLI_EFFORT_LEVELS: Record<string, readonly string[]> = {
  "claude-code": ["low", "medium", "high", "max"],
  "codex-cli": ["minimal", "low", "medium", "high", "xhigh"],
  "grok-build-cli": ["low", "medium", "high"],
}

export function cliEffortLevels(providerID: string): readonly string[] {
  return CLI_EFFORT_LEVELS[providerID] ?? []
}

export function cliEffortVariants(providerID: string): Record<string, Record<string, string>> {
  return Object.fromEntries(cliEffortLevels(providerID).map((effort) => [effort, { effort }]))
}

export function cliEffortFromProviderOptions(providerID: string, providerOptions: unknown): string | undefined {
  if (!providerOptions || typeof providerOptions !== "object" || Array.isArray(providerOptions)) return undefined
  const options = (providerOptions as Record<string, unknown>)[providerID]
  if (!options || typeof options !== "object" || Array.isArray(options)) return undefined
  const effort = (options as Record<string, unknown>).effort
  if (typeof effort !== "string" || !cliEffortLevels(providerID).includes(effort)) return undefined
  return effort
}

export function cliEffortArgs(providerID: string, effort?: string): string[] {
  if (!effort || !cliEffortLevels(providerID).includes(effort)) return []
  if (providerID === "claude-code") return ["--effort", effort]
  if (providerID === "codex-cli") return ["-c", `model_reasoning_effort="${effort}"`]
  if (providerID === "grok-build-cli") return ["--reasoning-effort", effort]
  return []
}
