import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import type { DoctorCheck } from "./doctor-health"

export function getConfiguredCredentialProviders(
  config: { provider?: Record<string, { options?: { apiKey?: unknown } }> } | undefined,
) {
  return Object.entries(config?.provider ?? {})
    .filter(([, provider]) => typeof provider.options?.apiKey === "string" && provider.options.apiKey.trim().length > 0)
    .map(([id]) => id)
    .sort()
}

export async function getDoctorConfiguration(directory: string): Promise<{ config?: Config.Info; check: DoctorCheck }> {
  try {
    const config = await Instance.provide({ directory, fn: () => Config.get() })
    return {
      config,
      check: {
        name: "Configuration",
        status: "ok",
        detail: `Loaded effective configuration (${Object.keys(config.provider ?? {}).length} provider(s) configured; runtime defaults included)`,
      },
    }
  } catch {
    // Config parse errors can include the source document and credential values.
    return {
      check: {
        name: "Configuration",
        status: "fail",
        detail:
          "Unable to load effective configuration; inspect configuration syntax, access, and runtime trust settings",
      },
    }
  }
}
