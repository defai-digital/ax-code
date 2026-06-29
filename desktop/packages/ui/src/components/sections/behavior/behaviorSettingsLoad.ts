import { getResponseStylePresetInstructions, isResponseStylePreset, type ResponseStylePreset } from "@/lib/responseStyle"
import { API_ENDPOINTS } from "@/lib/http"

export type ResponseStyleValue = ResponseStylePreset | "custom"

export type BehaviorSettingsState = {
  prompt: string
  responseStyleEnabled: boolean
  responseStylePreset: ResponseStyleValue
  responseStyleCustomInstructions: string
}

export const DEFAULT_BEHAVIOR_SETTINGS: BehaviorSettingsState = {
  prompt: "",
  responseStyleEnabled: false,
  responseStylePreset: "concise",
  responseStyleCustomInstructions: "",
}

export const normalizeAgentsMdContent = (content: string) => {
  return content.length > 0 && !content.endsWith("\n") ? `${content}\n` : content
}

export const getResponseStylePreview = (preset: ResponseStyleValue, customInstructions: string) => {
  return preset === "custom" ? customInstructions : getResponseStylePresetInstructions(preset)
}

export const sanitizeResponseStylePreset = (value: unknown): ResponseStyleValue => {
  if (value === "custom") return "custom"
  return isResponseStylePreset(value) ? value : "concise"
}

type FetchBehaviorSettingsOptions = {
  fetchImpl: typeof fetch
  signal?: AbortSignal
}

export const fetchBehaviorSettings = async ({
  fetchImpl,
  signal,
}: FetchBehaviorSettingsOptions): Promise<BehaviorSettingsState> => {
  const [settingsRes, agentsMdRes] = await Promise.all([
    fetchImpl(API_ENDPOINTS.config.settings, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    }),
    fetchImpl(API_ENDPOINTS.behavior.agentsMd, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    }),
  ])

  let nextSettings: BehaviorSettingsState = DEFAULT_BEHAVIOR_SETTINGS
  if (settingsRes.ok) {
    const data = await settingsRes.json()
    nextSettings = {
      ...nextSettings,
      responseStyleEnabled: data.responseStyleEnabled === true,
      responseStylePreset: sanitizeResponseStylePreset(data.responseStylePreset),
      responseStyleCustomInstructions:
        typeof data.responseStyleCustomInstructions === "string" ? data.responseStyleCustomInstructions : "",
    }
    if (typeof data.globalBehaviorPrompt === "string") {
      nextSettings = { ...nextSettings, prompt: data.globalBehaviorPrompt }
    }
  }

  if (!nextSettings.prompt.trim() && agentsMdRes.ok) {
    const agentsData = await agentsMdRes.json()
    if (typeof agentsData.content === "string") {
      nextSettings = { ...nextSettings, prompt: agentsData.content }
    }
  }

  return nextSettings
}
