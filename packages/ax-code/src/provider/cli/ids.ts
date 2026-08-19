export const CLI_PROVIDER_IDS = ["claude-code", "codex-cli", "grok-build-cli", "qoder-cli", "kimi-cli"] as const

export type CliProviderID = (typeof CLI_PROVIDER_IDS)[number]

const CLI_PROVIDER_ID_SET = new Set<string>(CLI_PROVIDER_IDS)

export function isKnownCliProviderID(providerID: string): providerID is CliProviderID {
  return CLI_PROVIDER_ID_SET.has(providerID)
}

/** The provider-ID model is a sentinel that delegates model choice to the CLI itself. */
export function isGenericCliFallbackModel(model: { id: string; providerID?: string }): boolean {
  return !!model.providerID && isKnownCliProviderID(model.providerID) && model.id === model.providerID
}
