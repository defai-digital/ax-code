/**
 * Provider taxonomy for AX Code clients and provider pickers: connect
 * categories, bundled CLI provider ids, custom API provider plumbing, and
 * helpers describing how a provider connects.
 *
 * @module
 */

/** Provider taxonomy shared by AX Code clients and provider pickers. */
export type ProviderConnectCategory = "ax-engine" | "local" | "private-gpu" | "cli" | "api" | "ax-trust"
/** Persisted category choices for providers with user-selected identifiers. */
export type ProviderConnectCategoryOverrides = Readonly<Partial<Record<string, ProviderConnectCategory>>>

/** Sentinel option id for a user-supplied custom API provider in connection pickers. */
export const CUSTOM_API_PROVIDER_OPTION_ID = "__custom-api__"
/** Sentinel option id for adding an AX Trust gateway. */
export const AX_TRUST_PROVIDER_OPTION_ID = "__ax-trust__"

/** Bundled CLI provider ids (`claude-code`, `codex-cli`, `grok-build-cli`, `kimi-cli`). */
export const CLI_PROVIDER_IDS = ["claude-code", "codex-cli", "grok-build-cli", "kimi-cli"] as const
/** One of the bundled CLI provider ids. */
export type CliProviderID = (typeof CLI_PROVIDER_IDS)[number]

/** External local LLM runtime provider ids, in connection-picker order. */
export const LOCAL_LLM_PROVIDER_IDS = ["ollama", "lmstudio", "ax-studio", "local-llm"] as const
/** One of the external local LLM runtime presets; local-llm is the Others entry. */
export type LocalLlmProviderID = (typeof LOCAL_LLM_PROVIDER_IDS)[number]
/** All local runtime providers, including the separately listed AX Engine runtime. */
export const LOCAL_RUNTIME_PROVIDER_IDS = ["ax-engine", ...LOCAL_LLM_PROVIDER_IDS] as const
/** Compatibility alias of `CLI_PROVIDER_IDS`. */
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
  "custom-private-gpu",
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

const LOCAL_SET = new Set<string>(LOCAL_LLM_PROVIDER_IDS)
const CLI_SET = new Set<string>(CLI_PLAN_PROVIDER_IDS)
const PRIVATE_GPU_SET = new Set<string>(PRIVATE_GPU_CLOUD_PROVIDER_IDS)
const CLI_PROVIDER_ID_SET = new Set<string>(CLI_PROVIDER_IDS)

/** Ordered connect categories with picker labels and short hints. */
export const PROVIDER_CONNECT_CATEGORIES = [
  { id: "api", label: "API Cloud Provider", hint: "Hosted API key" },
  { id: "cli", label: "CLI Provider", hint: "Installed CLI subscription" },
  { id: "ax-engine", label: "AX-Engine runtime", hint: "Run models on this machine" },
  { id: "local", label: "Local LLM runtime", hint: "Ollama, LMStudio, AX-Studio, Others" },
  { id: "private-gpu", label: "Private GPU cloud", hint: "Dedicated GPU or hosted catalog" },
  { id: "ax-trust", label: "AX Trust", hint: "Connect an AX Trust gateway" },
] as const satisfies readonly {
  id: ProviderConnectCategory
  label: string
  hint: string
}[]

/** Type guard: whether a provider id is one of the bundled CLI providers. */
export function isKnownCliProviderID(providerID: string): providerID is CliProviderID {
  return CLI_PROVIDER_ID_SET.has(providerID)
}

/** Map a provider id onto its connection category. */
export function providerConnectCategory(
  providerID: string,
  overrides?: ProviderConnectCategoryOverrides,
): ProviderConnectCategory {
  if (overrides && Object.hasOwn(overrides, providerID) && overrides[providerID]) return overrides[providerID]
  if (providerID === AX_TRUST_PROVIDER_OPTION_ID || isAxTrustProviderID(providerID)) return "ax-trust"
  if (providerID === "ax-engine") return "ax-engine"
  if (LOCAL_SET.has(providerID)) return "local"
  if (PRIVATE_GPU_SET.has(providerID)) return "private-gpu"
  if (CLI_SET.has(providerID)) return "cli"
  return "api"
}

/** Recognize legacy AX Trust identifiers without changing their stored identity. */
export function isAxTrustProviderID(providerID: string): boolean {
  return providerID === "ax-trust" || providerID.startsWith("ax-trust-")
}

/** Return the label and hint metadata for a connect category. */
export function providerConnectCategoryMeta(category: ProviderConnectCategory) {
  const meta = PROVIDER_CONNECT_CATEGORIES.find((item) => item.id === category)
  if (!meta) throw new Error(`Unknown provider connect category: ${category}`)
  return meta
}

/** Human-readable connect-category label for a provider id. */
export function providerConnectCategoryLabel(providerID: string, overrides?: ProviderConnectCategoryOverrides): string {
  return providerConnectCategoryMeta(providerConnectCategory(providerID, overrides)).label
}

/** Short hint string for a connect category. */
export function providerConnectCategoryHint(category: ProviderConnectCategory): string {
  return providerConnectCategoryMeta(category).hint
}

/** Stable sort key for API, CLI, AX Engine, local LLMs, private GPU, then AX Trust. */
export function providerConnectCategorySortKey(
  providerID: string,
  overrides?: ProviderConnectCategoryOverrides,
): number {
  switch (providerConnectCategory(providerID, overrides)) {
    case "api":
      return 0
    case "cli":
      return 1
    case "ax-engine":
      return 2
    case "local":
      return 3
    case "private-gpu":
      return 4
    case "ax-trust":
      return 5
  }
}

/** Connect categories represented in a list of provider ids, in display order. */
export function providerConnectCategoriesPresent(
  providerIDs: readonly string[],
  overrides?: ProviderConnectCategoryOverrides,
): ProviderConnectCategory[] {
  const present = new Set(providerIDs.map((providerID) => providerConnectCategory(providerID, overrides)))
  return PROVIDER_CONNECT_CATEGORIES.filter((item) => present.has(item.id)).map((item) => item.id)
}

/** Filter provider records to those in a given connect category. */
export function providersInConnectCategory<T extends { id: string }>(
  providers: readonly T[],
  category: ProviderConnectCategory,
  overrides?: ProviderConnectCategoryOverrides,
): T[] {
  return providers.filter((provider) => providerConnectCategory(provider.id, overrides) === category)
}

/** First connect category present in a provider-id list, if any. */
export function defaultProviderConnectCategory(
  providerIDs: readonly string[],
  overrides?: ProviderConnectCategoryOverrides,
): ProviderConnectCategory | undefined {
  return providerConnectCategoriesPresent(providerIDs, overrides)[0]
}

/** Short count label such as `3 providers` for picker type options. */
export function providerConnectTypeOptionDescription(count: number): string {
  const noun = count === 1 ? "provider" : "providers"
  return `${count} ${noun}`
}
