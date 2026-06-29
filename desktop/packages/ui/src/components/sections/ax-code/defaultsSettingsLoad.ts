import { API_ENDPOINTS } from "@/lib/http"

export type DefaultsSettingsPayload = {
  defaultModel?: string
  defaultVariant?: string
  defaultAgent?: string
}

type RuntimeSettingsResult = {
  settings?: unknown
} | null

type LoadDefaultsSettingsOptions = {
  fetchImpl: typeof fetch
  loadRuntimeSettings?: () => Promise<RuntimeSettingsResult>
  signal?: AbortSignal
}

const normalizeOptionalString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

export const parseDefaultsSettingsPayload = (settings: unknown): DefaultsSettingsPayload | null => {
  if (!settings || typeof settings !== "object") {
    return null
  }

  const record = settings as Record<string, unknown>
  return {
    defaultModel: normalizeOptionalString(record.defaultModel),
    defaultVariant: normalizeOptionalString(record.defaultVariant),
    defaultAgent: normalizeOptionalString(record.defaultAgent),
  }
}

export const loadDefaultsSettings = async ({
  fetchImpl,
  loadRuntimeSettings,
  signal,
}: LoadDefaultsSettingsOptions): Promise<DefaultsSettingsPayload | null> => {
  if (loadRuntimeSettings) {
    try {
      const runtimePayload = await loadRuntimeSettings()
      const runtimeSettings = parseDefaultsSettingsPayload(runtimePayload?.settings)
      if (runtimeSettings) {
        return runtimeSettings
      }
    } catch {
      // Fall through to the server settings API.
    }
  }

  const response = await fetchImpl(API_ENDPOINTS.config.settings, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  })
  if (!response.ok) {
    return null
  }

  return parseDefaultsSettingsPayload(await response.json())
}
