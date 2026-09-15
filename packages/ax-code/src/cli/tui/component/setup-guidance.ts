import { english, type Translate } from "../i18n"
export type SetupGuidance = {
  state: "loading" | "failed" | "connect" | "model" | "selected"
  message?: string
  action?: { label: string; command: string }
  showIntroduction: boolean
  modelCommand: "provider.connect" | "model.list"
}

export function setupGuidance(
  input: {
    providerLoaded: boolean
    providerFailed: boolean
    modelReady: boolean
    providers: readonly { id: string; models: Record<string, unknown> }[]
    model?: { providerID: string; modelID: string }
    sessionLoaded: boolean
    sessionCount: number
  },
  t: Translate = english,
): SetupGuidance {
  const modelCommand = input.providers.length ? "model.list" : "provider.connect"
  const base = { showIntroduction: false, modelCommand } as const
  if (input.providerFailed)
    return {
      ...base,
      state: "failed",
      message: t("setup.failed"),
      action: { label: t("setup.status"), command: "ax-code.status" },
    }
  if (!input.providerLoaded || !input.modelReady) return { ...base, state: "loading", message: t("setup.loading") }
  if (!input.providers.length)
    return {
      ...base,
      state: "connect",
      message: t("setup.connectMessage"),
      action: { label: t("setup.connect"), command: "provider.connect" },
    }
  const selected =
    input.model &&
    input.providers.find((provider) => provider.id === input.model?.providerID)?.models[input.model.modelID]
  if (!selected)
    return {
      ...base,
      state: "model",
      message: t("setup.modelMessage"),
      action: { label: t("setup.model"), command: "model.list" },
    }
  return { ...base, state: "selected", showIntroduction: input.sessionLoaded && input.sessionCount === 0 }
}
