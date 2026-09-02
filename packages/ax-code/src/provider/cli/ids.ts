import { CLI_PROVIDER_IDS, isKnownCliProviderID, type CliProviderID } from "@ax-code/sdk/provider-connect"

export { CLI_PROVIDER_IDS, isKnownCliProviderID }
export type { CliProviderID }

/** The provider-ID model is a sentinel that delegates model choice to the CLI itself. */
export function isGenericCliFallbackModel(model: { id: string; providerID?: string }): boolean {
  return !!model.providerID && isKnownCliProviderID(model.providerID) && model.id === model.providerID
}
