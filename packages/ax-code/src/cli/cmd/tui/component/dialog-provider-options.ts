import { filter, pipe, sortBy } from "remeda"

export type ProviderDialogProvider = {
  id: string
  name: string
}

export const CLI_BINARIES: Record<string, string> = {
  "claude-code": "claude",
  "gemini-cli": "gemini",
  "codex-cli": "codex",
  "grok-build-cli": "grok",
}

export const OFFLINE_PROVIDERS = new Set(["ax-serving", "ollama", "lmstudio"])
export const CLI_PROVIDERS = new Set(["claude-code", "gemini-cli", "codex-cli", "grok-build-cli"])

const HIDDEN_PROVIDERS = new Set(["google", "github-copilot"])

export function providerDialogProviders(input: {
  available: ProviderDialogProvider[]
  configured: ProviderDialogProvider[]
}) {
  const providers = input.available.length > 0 ? input.available : input.configured
  return pipe(
    providers,
    filter((provider) => !HIDDEN_PROVIDERS.has(provider.id)),
    sortBy(
      (provider) => (OFFLINE_PROVIDERS.has(provider.id) ? 0 : CLI_PROVIDERS.has(provider.id) ? 1 : 2),
      (provider) => provider.name,
    ),
  )
}

export function providerDialogCategory(providerID: string) {
  if (OFFLINE_PROVIDERS.has(providerID)) return "Local runtime"
  if (CLI_PROVIDERS.has(providerID)) return "CLI plan"
  return "API plan"
}

export function providerDialogConnected(input: {
  providerID: string
  connected: string[]
  configured: ProviderDialogProvider[]
}) {
  return (
    input.connected.includes(input.providerID) || input.configured.some((provider) => provider.id === input.providerID)
  )
}
