/**
 * Connect-dialog taxonomy shared by TUI `/connect` and Desktop Add Provider.
 *
 * Pure ID/label helpers so Desktop can import this module without pulling
 * runtime provider internals (`ax-code/provider/*` is a desktop boundary).
 *
 * Hugging Face router (`huggingface`) stays API plan; dedicated HF endpoints
 * are Private GPU cloud.
 */

export type ProviderConnectCategory = "local" | "private-gpu" | "cli" | "api"

export const LOCAL_RUNTIME_PROVIDER_IDS = ["ax-engine", "ax-studio", "ollama"] as const

export const CLI_PLAN_PROVIDER_IDS = [
  "claude-code",
  "gemini-cli",
  "codex-cli",
  "grok-build-cli",
  "qoder-cli",
  "antigravity-cli",
  "kimi-cli",
] as const

export const DEDICATED_PRIVATE_GPU_PROVIDER_IDS = [
  "alibaba-pai",
  "runpod",
  "huggingface-endpoints",
  "sagemaker",
  "volcengine-ark",
  "modelarts",
  "tencent-ti",
] as const

export const CATALOG_PRIVATE_GPU_PROVIDER_IDS = [
  "nebius",
  "fireworks-ai",
  "togetherai",
  "baseten",
  "nvidia",
  "deepinfra",
] as const

export const PRIVATE_GPU_CLOUD_PROVIDER_IDS = [
  ...DEDICATED_PRIVATE_GPU_PROVIDER_IDS,
  ...CATALOG_PRIVATE_GPU_PROVIDER_IDS,
] as const

const LOCAL_SET = new Set<string>(LOCAL_RUNTIME_PROVIDER_IDS)
const CLI_SET = new Set<string>(CLI_PLAN_PROVIDER_IDS)
const PRIVATE_GPU_SET = new Set<string>(PRIVATE_GPU_CLOUD_PROVIDER_IDS)

export const PROVIDER_CONNECT_CATEGORIES = [
  { id: "local", label: "Local runtime", hint: "On this machine" },
  { id: "private-gpu", label: "Private GPU cloud", hint: "Dedicated GPU or hosted catalog" },
  { id: "cli", label: "CLI plan", hint: "Installed CLI subscription" },
  { id: "api", label: "API plan", hint: "Hosted API key" },
] as const satisfies readonly {
  id: ProviderConnectCategory
  label: string
  hint: string
}[]

export function providerConnectCategory(providerID: string): ProviderConnectCategory {
  if (LOCAL_SET.has(providerID)) return "local"
  if (PRIVATE_GPU_SET.has(providerID)) return "private-gpu"
  if (CLI_SET.has(providerID)) return "cli"
  return "api"
}

export function providerConnectCategoryMeta(category: ProviderConnectCategory) {
  const meta = PROVIDER_CONNECT_CATEGORIES.find((item) => item.id === category)
  if (!meta) throw new Error(`Unknown provider connect category: ${category}`)
  return meta
}

export function providerConnectCategoryLabel(providerID: string): string {
  return providerConnectCategoryMeta(providerConnectCategory(providerID)).label
}

export function providerConnectCategoryHint(category: ProviderConnectCategory): string {
  return providerConnectCategoryMeta(category).hint
}

export function providerConnectCategorySortKey(providerID: string): number {
  switch (providerConnectCategory(providerID)) {
    case "local":
      return 0
    case "private-gpu":
      return 1
    case "cli":
      return 2
    case "api":
      return 3
  }
}

export function providerConnectCategoriesPresent(providerIDs: readonly string[]): ProviderConnectCategory[] {
  const present = new Set(providerIDs.map(providerConnectCategory))
  return PROVIDER_CONNECT_CATEGORIES.filter((item) => present.has(item.id)).map((item) => item.id)
}

export function providersInConnectCategory<T extends { id: string }>(
  providers: readonly T[],
  category: ProviderConnectCategory,
): T[] {
  return providers.filter((provider) => providerConnectCategory(provider.id) === category)
}

export function defaultProviderConnectCategory(providerIDs: readonly string[]): ProviderConnectCategory | undefined {
  return providerConnectCategoriesPresent(providerIDs)[0]
}

export function providerConnectTypeOptionDescription(category: ProviderConnectCategory, count: number): string {
  const noun = count === 1 ? "provider" : "providers"
  return `${count} ${noun} · ${providerConnectCategoryHint(category)}`
}
