import { CLI_PROVIDER_IDS, isKnownCliProviderID, type CliProviderID } from "@ax-code/sdk/provider-connect"
import { isRetiredProviderID } from "../retired-providers"

export { CLI_PROVIDER_IDS, isKnownCliProviderID }
export type { CliProviderID }

/**
 * Whether a provider runs the vendor's own CLI agent loop (so it never receives
 * AX Code tools). True for known CLI providers and the `*-cli` naming
 * convention, unless the provider has been retired.
 */
export function isCliProviderID(providerID: string | undefined): boolean {
  if (!providerID || isRetiredProviderID(providerID)) return false
  return providerID.endsWith("-cli") || isKnownCliProviderID(providerID)
}

/** The provider-ID model is a sentinel that delegates model choice to the CLI itself. */
export function isGenericCliFallbackModel(model: { id: string; providerID?: string }): boolean {
  return !!model.providerID && isKnownCliProviderID(model.providerID) && model.id === model.providerID
}
