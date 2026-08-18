import type { Config } from "../config/config"

/**
 * Pure helpers that compute a config patch to temporarily disable or
 * re-enable a provider without touching its stored credentials.
 *
 * Both `disabled_providers` and the `enabled_providers` allowlist are ANDed
 * when providers load (see provider-impl.ts), so `disabled_providers` always
 * wins. The patch is meant for `Config.updateGlobal` / `global.config.update`
 * and replaces the arrays wholesale.
 */

export function disableProviderPatch(config: Config.Info, providerID: string): Partial<Config.Info> {
  const disabled = config.disabled_providers ?? []
  if (disabled.includes(providerID)) return {}
  return { disabled_providers: [...disabled, providerID] }
}

export function enableProviderPatch(config: Config.Info, providerID: string): Partial<Config.Info> {
  const patch: Partial<Config.Info> = {}
  const disabled = config.disabled_providers ?? []
  if (disabled.includes(providerID)) {
    patch.disabled_providers = disabled.filter((id) => id !== providerID)
  }
  // Allowlist mode: removing from disabled_providers is not enough when the
  // provider was never in enabled_providers, so opt it back in there too.
  const enabled = config.enabled_providers
  if (enabled && !enabled.includes(providerID)) {
    patch.enabled_providers = [...enabled, providerID]
  }
  return patch
}

export function isProviderDisabled(config: Config.Info, providerID: string): boolean {
  if ((config.disabled_providers ?? []).includes(providerID)) return true
  const enabled = config.enabled_providers
  return enabled ? !enabled.includes(providerID) : false
}
