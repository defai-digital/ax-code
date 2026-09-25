// Provider presets shared by the server-backed setup dialog and the CLI login
// picker. Keep surface-specific entries (`ax-engine` and `ax-code`) at their
// call sites.
//
// Cloud API-key providers (google, deepseek, meta/Muse Spark, …) must stay
// here so /connect, providers login, and the Desktop setup dialog surface them
// without requiring enabled_providers opt-in — same pattern OpenCode uses for
// native deepseek + meta blocks.
import { CLI_PROVIDER_IDS } from "./cli/ids"
import { LOCAL_LLM_PROVIDER_IDS, providerConnectCategory } from "@/mode/provider-category"
import { isPrivateGpuProviderID } from "./private-gpu/presets"
import { AX_ENGINE_PROVIDER_ID } from "./ax-engine/constants"
import type { ModelsDev } from "./models"

export const DEFAULT_SETUP_PROVIDER_IDS = [
  "google",
  "deepseek",
  "meta",
  "groq",
  "openrouter",
  "huggingface",
  "unorouter",
  "alibaba-coding-plan",
  "alibaba-coding-plan-cn",
  "alibaba-token-plan",
  "alibaba-token-plan-cn",
  // Private GPU cloud — catalog (OpenCode / models.dev API-key vendors)
  "nebius",
  "fireworks-ai",
  "togetherai",
  "baseten",
  "nvidia",
  "deepinfra",
  // Private GPU cloud — dedicated URL + token + /models discover
  "alibaba-pai",
  "runpod",
  "huggingface-endpoints",
  "sagemaker",
  "volcengine-ark",
  "modelarts",
  "tencent-ti",
  "custom-private-gpu",
  "github-copilot",
  "zai",
  "zai-coding-plan",
  // models.dev still publishes these as *-coding-plan; MiniMax renamed the
  // product to Token Plan. Display names and docs use Token Plan.
  "minimax-coding-plan",
  "minimax-cn-coding-plan",
  ...CLI_PROVIDER_IDS,
] as const

const CLI_PROVIDER_ID_SET = new Set<string>(CLI_PROVIDER_IDS)
const LOCAL_LLM_PROVIDER_ID_SET = new Set<string>(LOCAL_LLM_PROVIDER_IDS)

/**
 * Whether a models.dev catalog record belongs on the /connect API Cloud
 * Provider list beyond the curated suggested set: at least one model, not a
 * CLI adapter, and not owned by another connect category (local runtime,
 * private GPU cloud, AX Engine). Records with zero models (e.g. snapshot
 * placeholders for local runtimes) stay on their own category paths.
 */
export function isApiCloudCatalogProvider(id: string, provider: ModelsDev.Provider): boolean {
  if (id === AX_ENGINE_PROVIDER_ID) return false
  if (CLI_PROVIDER_ID_SET.has(id)) return false
  if (LOCAL_LLM_PROVIDER_ID_SET.has(id)) return false
  if (isPrivateGpuProviderID(id)) return false
  if (provider.npm === "cli") return false
  return Object.keys(provider.models).length > 0
}

const VENDOR_PLAN_SUFFIX = /(?:-coding-plan|-token-plan|-step-plan|-tokenhub|-cloud)$/

/**
 * Vendor key for /connect dedupe: region/plan variants of one vendor collapse
 * to a single row ("SiliconFlow (China)" and "SiliconFlow" both -> "siliconflow").
 * Falls back to the provider id when nothing meaningful remains so unrelated
 * empty names never share a bucket.
 */
export function normalizeConnectVendorName(name: string): string {
  let out = name.toLowerCase().replace(/\([^)]*\)/g, "")
  for (;;) {
    const next = out.replace(/\s+(coding|token|step|cloud)\s+plan\s*$/, "").replace(/\s+tokenhub\s*$/, "")
    if (next === out) break
    out = next
  }
  return out.replace(/\s+/g, " ").trim()
}

const DEFAULT_SETUP_PROVIDER_INDEX = new Map<string, number>(
  DEFAULT_SETUP_PROVIDER_IDS.map((id, index) => [id, index]),
)

function variantName(providers: Record<string, ModelsDev.Provider>, id: string) {
  return providers[id]?.name ?? id
}

function firstVariantByNameThenID(members: string[], providers: Record<string, ModelsDev.Provider>) {
  return [...members].sort((a, b) => {
    const nameA = variantName(providers, a)
    const nameB = variantName(providers, b)
    if (nameA !== nameB) return nameA < nameB ? -1 : 1
    return a < b ? -1 : a > b ? 1 : 0
  })[0]
}

function isPlainBaseVariant(id: string, name: string) {
  return !name.includes("(") && !id.endsWith("-cn") && !VENDOR_PLAN_SUFFIX.test(id)
}

function isCNVariant(id: string, name: string) {
  return name.toLowerCase().includes("(china)") || id.endsWith("-cn")
}

function pickVendorVariantRepresentative(members: string[], providers: Record<string, ModelsDev.Provider>) {
  const curated = members
    .map((id) => ({ id, index: DEFAULT_SETUP_PROVIDER_INDEX.get(id) }))
    .filter((entry): entry is { id: string; index: number } => entry.index !== undefined)
    .sort((a, b) => a.index - b.index)
  if (curated.length > 0) return curated[0].id
  const plain = members.filter((id) => isPlainBaseVariant(id, variantName(providers, id)))
  if (plain.length > 0) return firstVariantByNameThenID(plain, providers)
  const nonCN = members.filter((id) => !isCNVariant(id, variantName(providers, id)))
  if (nonCN.length > 0) return firstVariantByNameThenID(nonCN, providers)
  return firstVariantByNameThenID(members, providers)
}

/**
 * Collapse vendor-variant duplication in a visible provider set: api-category
 * records grouping to the same normalized vendor name keep one representative
 * (curated member first, then plain base variant, then non-China variant, then
 * name A-Z), plus any member in `keep` (connected providers stay visible).
 * Single-member groups and non-api records are never dropped.
 */
export function dedupeApiCloudVendorVariants(
  providers: Record<string, ModelsDev.Provider>,
  keep?: ReadonlySet<string>,
): string[] {
  const groups = new Map<string, string[]>()
  for (const id of Object.keys(providers)) {
    if (providerConnectCategory(id) !== "api") continue
    const key = normalizeConnectVendorName(variantName(providers, id)) || id
    const members = groups.get(key)
    if (members) members.push(id)
    else groups.set(key, [id])
  }
  const dropped = new Set<string>()
  for (const members of groups.values()) {
    if (members.length === 1) continue
    const representative = pickVendorVariantRepresentative(members, providers)
    for (const id of members) {
      if (id !== representative && !keep?.has(id)) dropped.add(id)
    }
  }
  return Object.keys(providers).filter((id) => !dropped.has(id))
}
