/**
 * Provider taxonomy for AX Code clients and provider pickers: connect
 * categories, bundled CLI provider ids, custom API provider plumbing, and
 * helpers describing how a provider connects.
 *
 * @module
 */

/** Provider taxonomy shared by AX Code clients and provider pickers. */
export type ProviderConnectCategory = "local" | "private-gpu" | "cli" | "api"

/** Sentinel option id for a user-supplied custom API provider in connection pickers. */
export const CUSTOM_API_PROVIDER_OPTION_ID = "__custom-api__"

/** Bundled CLI-plan provider ids (`claude-code`, `codex-cli`, `grok-build-cli`, `kimi-cli`). */
export const CLI_PROVIDER_IDS = ["claude-code", "codex-cli", "grok-build-cli", "kimi-cli"] as const
/** One of the bundled CLI-plan provider ids. */
export type CliProviderID = (typeof CLI_PROVIDER_IDS)[number]

/** Local-runtime provider ids (`ax-engine`, `ax-studio`, `ollama`). */
export const LOCAL_RUNTIME_PROVIDER_IDS = ["ax-engine", "ax-studio", "ollama"] as const
/** Alias of `CLI_PROVIDER_IDS` for picker copy that talks about CLI plans. */
export const CLI_PLAN_PROVIDER_IDS = CLI_PROVIDER_IDS

/** Dedicated private-GPU cloud provider ids (RunPod, SageMaker, PAI, ...). */
export const DEDICATED_PRIVATE_GPU_PROVIDER_IDS = [
  "alibaba-pai",
  "runpod",
  "huggingface-endpoints",
  "sagemaker",
  "volcengine-ark",
  "modelarts",
  "tencent-ti",
] as const

/** Hosted GPU-catalog provider ids (Nebius, Fireworks, Together, ...). */
export const CATALOG_PRIVATE_GPU_PROVIDER_IDS = [
  "nebius",
  "fireworks-ai",
  "togetherai",
  "baseten",
  "nvidia",
  "deepinfra",
] as const

/** Union of dedicated and catalog private-GPU provider ids. */
export const PRIVATE_GPU_CLOUD_PROVIDER_IDS = [
  ...DEDICATED_PRIVATE_GPU_PROVIDER_IDS,
  ...CATALOG_PRIVATE_GPU_PROVIDER_IDS,
] as const

const LOCAL_SET = new Set<string>(LOCAL_RUNTIME_PROVIDER_IDS)
const CLI_SET = new Set<string>(CLI_PLAN_PROVIDER_IDS)
const PRIVATE_GPU_SET = new Set<string>(PRIVATE_GPU_CLOUD_PROVIDER_IDS)
const CLI_PROVIDER_ID_SET = new Set<string>(CLI_PROVIDER_IDS)

/** Ordered connect categories with picker labels and short hints. */
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

/** Type guard: whether a provider id is one of the bundled CLI-plan providers. */
export function isKnownCliProviderID(providerID: string): providerID is CliProviderID {
  return CLI_PROVIDER_ID_SET.has(providerID)
}

/** Map a provider id onto a connect category (`local`, `private-gpu`, `cli`, or `api`). */
export function providerConnectCategory(providerID: string): ProviderConnectCategory {
  if (LOCAL_SET.has(providerID)) return "local"
  if (PRIVATE_GPU_SET.has(providerID)) return "private-gpu"
  if (CLI_SET.has(providerID)) return "cli"
  return "api"
}

/** Return the label and hint metadata for a connect category. */
export function providerConnectCategoryMeta(category: ProviderConnectCategory) {
  const meta = PROVIDER_CONNECT_CATEGORIES.find((item) => item.id === category)
  if (!meta) throw new Error(`Unknown provider connect category: ${category}`)
  return meta
}

/** Human-readable connect-category label for a provider id. */
export function providerConnectCategoryLabel(providerID: string): string {
  return providerConnectCategoryMeta(providerConnectCategory(providerID)).label
}

/** Short hint string for a connect category. */
export function providerConnectCategoryHint(category: ProviderConnectCategory): string {
  return providerConnectCategoryMeta(category).hint
}

/** Stable sort key so pickers list local, private GPU, CLI, then API. */
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

/** Connect categories represented in a list of provider ids, in display order. */
export function providerConnectCategoriesPresent(providerIDs: readonly string[]): ProviderConnectCategory[] {
  const present = new Set(providerIDs.map(providerConnectCategory))
  return PROVIDER_CONNECT_CATEGORIES.filter((item) => present.has(item.id)).map((item) => item.id)
}

/** Filter provider records to those in a given connect category. */
export function providersInConnectCategory<T extends { id: string }>(
  providers: readonly T[],
  category: ProviderConnectCategory,
): T[] {
  return providers.filter((provider) => providerConnectCategory(provider.id) === category)
}

/** First connect category present in a provider-id list, if any. */
export function defaultProviderConnectCategory(providerIDs: readonly string[]): ProviderConnectCategory | undefined {
  return providerConnectCategoriesPresent(providerIDs)[0]
}

/** Short count label such as `3 providers` for picker type options. */
export function providerConnectTypeOptionDescription(count: number): string {
  const noun = count === 1 ? "provider" : "providers"
  return `${count} ${noun}`
}
