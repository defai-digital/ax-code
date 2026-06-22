import { filter, pipe, sortBy } from "remeda"
import { providerModelSelectable } from "@/provider/model-selectability"
import { isRecord } from "@/util/record"
import type { ProviderListResponse } from "@ax-code/sdk/v2"

export { providerModelSelectable }

export type ProviderDialogProvider = {
  id: string
  name: string
}

function isProviderLike(input: unknown): input is ProviderDialogProvider {
  return isRecord(input) && typeof input.id === "string" && typeof input.name === "string" && isRecord(input.models)
}

function normalizeStringRecord(data: unknown): Record<string, string> {
  if (!isRecord(data)) return {}
  return Object.fromEntries(
    Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

export function normalizeConfiguredProvidersPayload<T extends ProviderDialogProvider>(
  data: unknown,
): {
  providers: T[]
  default: Record<string, string>
} {
  if (!isRecord(data)) return { providers: [], default: {} }
  return {
    providers: Array.isArray(data.providers) ? (data.providers.filter(isProviderLike) as T[]) : [],
    default: normalizeStringRecord(data.default),
  }
}

export function normalizeProviderListPayload(data: unknown): ProviderListResponse {
  const fallback = { all: [], connected: [], default: {} }
  if (!isRecord(data)) return fallback
  return {
    all: Array.isArray(data.all) ? data.all.filter(isProviderLike) : [],
    connected: Array.isArray(data.connected) ? data.connected.filter((id): id is string => typeof id === "string") : [],
    default: normalizeStringRecord(data.default),
  } as ProviderListResponse
}

export const CLI_BINARIES: Record<string, string> = {
  "claude-code": "claude",
  "gemini-cli": "gemini",
  "codex-cli": "codex",
  "grok-build-cli": "grok",
  "qoder-cli": "qodercli",
  "antigravity-cli": "agy",
}

export const OFFLINE_PROVIDERS = new Set(["ax-engine", "ax-studio", "ollama"])
export const CLI_PROVIDERS = new Set([
  "claude-code",
  "gemini-cli",
  "codex-cli",
  "grok-build-cli",
  "qoder-cli",
  "antigravity-cli",
])

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

export function configUpdateParams<T extends Record<string, unknown>>(config: T) {
  return { config }
}

export function providerDialogConnected(input: {
  providerID: string
  connected: string[]
  configured: ProviderDialogProvider[]
}) {
  if (input.providerID === "ax-engine") return input.connected.includes(input.providerID)
  return (
    input.connected.includes(input.providerID) || input.configured.some((provider) => provider.id === input.providerID)
  )
}
