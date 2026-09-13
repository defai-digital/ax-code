export type SetupGuidance = {
  state: "loading" | "failed" | "connect" | "model" | "selected"
  message?: string
  action?: { label: string; command: string }
  showIntroduction: boolean
  modelCommand: "provider.connect" | "model.list"
}

export function setupGuidance(input: {
  providerLoaded: boolean
  providerFailed: boolean
  modelReady: boolean
  providers: readonly { id: string; models: Record<string, unknown> }[]
  model?: { providerID: string; modelID: string }
  sessionLoaded: boolean
  sessionCount: number
}): SetupGuidance {
  const modelCommand = input.providers.length ? "model.list" : "provider.connect"
  const base = { showIntroduction: false, modelCommand } as const
  if (input.providerFailed)
    return {
      ...base,
      state: "failed",
      message: "Providers could not load.",
      action: { label: "/status - check connection", command: "ax-code.status" },
    }
  if (!input.providerLoaded || !input.modelReady)
    return { ...base, state: "loading", message: "Loading providers and models..." }
  if (!input.providers.length)
    return {
      ...base,
      state: "connect",
      message: "Connect a provider to start.",
      action: { label: "/connect - choose a provider", command: "provider.connect" },
    }
  const selected =
    input.model &&
    input.providers.find((provider) => provider.id === input.model?.providerID)?.models[input.model.modelID]
  if (!selected)
    return {
      ...base,
      state: "model",
      message: "Choose a model to start.",
      action: { label: "/models - choose a model", command: "model.list" },
    }
  return { ...base, state: "selected", showIntroduction: input.sessionLoaded && input.sessionCount === 0 }
}
