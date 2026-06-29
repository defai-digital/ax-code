import { API_ENDPOINTS } from "@/lib/http"

export type GitChangesViewMode = "flat" | "tree"

export type GitSettingsPayload = {
  gitmojiEnabled?: boolean
  gitChangesViewMode?: GitChangesViewMode
}

type RuntimeSettingsResult = {
  settings?: unknown
} | null

type LoadGitSettingsOptions = {
  fetchImpl: typeof fetch
  loadRuntimeSettings?: () => Promise<RuntimeSettingsResult>
  signal?: AbortSignal
}

export const parseGitSettingsPayload = (settings: unknown): GitSettingsPayload | null => {
  if (!settings || typeof settings !== "object") {
    return null
  }

  const record = settings as Record<string, unknown>
  return {
    gitmojiEnabled: typeof record.gitmojiEnabled === "boolean" ? record.gitmojiEnabled : undefined,
    gitChangesViewMode:
      record.gitChangesViewMode === "flat" || record.gitChangesViewMode === "tree"
        ? record.gitChangesViewMode
        : undefined,
  }
}

export const loadGitSettings = async ({
  fetchImpl,
  loadRuntimeSettings,
  signal,
}: LoadGitSettingsOptions): Promise<GitSettingsPayload | null> => {
  if (loadRuntimeSettings) {
    try {
      const runtimePayload = await loadRuntimeSettings()
      const runtimeSettings = parseGitSettingsPayload(runtimePayload?.settings)
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

  return parseGitSettingsPayload(await response.json())
}
