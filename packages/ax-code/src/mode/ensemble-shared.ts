/**
 * Shared ensemble member resolution and provider snapshotting.
 * Eliminates duplication between council.ts and arena.ts.
 *
 * Note: MemberSelectionSchema and its validation are kept local in each tool
 * to avoid a circular-dependency at module-load time (the tools import
 * arena-implement → session → prompt-tools → registry → tool modules,
 * which can prevent this namespace from being available at evaluation time).
 */

import { Auth } from "../auth"
import { Config } from "../config/config"
import { Council } from "./council"
import { ModeMemory } from "./memory"
import { EnsemblePreflight } from "./preflight"
import { isNonChatModelID, modelSelectableForProvider, skuKey } from "../provider/model-selectability"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { isRetiredProviderID } from "../provider/retired-providers"

const GROK_CLI_IDS = ["grok-build-cli"]
const OPENAI_IDS = ["openai", "codex-cli"]
const CLAUDE_IDS = ["anthropic", "claude-code"]
const KIMI_IDS = ["kimi-cli", "kimi-cloud-plan"]
const ALIBABA_PLAN_IDS = [
  "alibaba-token-plan",
  "alibaba-coding-plan",
  "alibaba-token-plan-cn",
  "alibaba-coding-plan-cn",
]
const ZAI_PLAN_IDS = ["zai-coding-plan", "zai", "zhipuai-coding-plan", "zhipuai"]
const MINIMAX_PLAN_IDS = ["minimax-coding-plan", "minimax-cn-coding-plan", "minimax", "minimax-cn"]

/** Colloquial names users type ("grok", "codex") → connected provider IDs. */
const PROVIDER_ALIASES: Record<string, string[]> = {
  grok: GROK_CLI_IDS,
  "grok-build": GROK_CLI_IDS,
  grokbuild: GROK_CLI_IDS,
  grokbuildcli: GROK_CLI_IDS,
  "grok-4": GROK_CLI_IDS,
  "grok-4.5": GROK_CLI_IDS,
  "grok-4.6": GROK_CLI_IDS,
  xai: GROK_CLI_IDS,
  codex: ["codex-cli", "openai"],
  "codex-cli": ["codex-cli", "openai"],
  openai: OPENAI_IDS,
  chatgpt: OPENAI_IDS,
  claude: CLAUDE_IDS,
  anthropic: CLAUDE_IDS,
  gemini: ["google"],
  google: ["google"],
  kimi: KIMI_IDS,
  "kimi-code": KIMI_IDS,
  "kimi-code-cli": KIMI_IDS,
  moonshot: KIMI_IDS,
  "moonshot-ai": KIMI_IDS,
  moonshotai: KIMI_IDS,
  minimax: MINIMAX_PLAN_IDS,
  "minimax-coding": MINIMAX_PLAN_IDS,
  "minimax-coding-plan": MINIMAX_PLAN_IDS,
  "minimax-token-plan": MINIMAX_PLAN_IDS,
  qwen: ALIBABA_PLAN_IDS,
  alibaba: ALIBABA_PLAN_IDS,
  dashscope: ALIBABA_PLAN_IDS,
  tongyi: ALIBABA_PLAN_IDS,
  "alibaba-token-plan": ALIBABA_PLAN_IDS,
  "alibaba-coding-plan": ALIBABA_PLAN_IDS,
  glm: ZAI_PLAN_IDS,
  zai: ZAI_PLAN_IDS,
  "z.ai": ZAI_PLAN_IDS,
  "z-ai": ZAI_PLAN_IDS,
  zhipu: ZAI_PLAN_IDS,
  zhipuai: ZAI_PLAN_IDS,
  chatglm: ZAI_PLAN_IDS,
  "zai-coding-plan": ZAI_PLAN_IDS,
  "zhipuai-coding-plan": ZAI_PLAN_IDS,
  deepseek: ["deepseek"],
  copilot: ["github-copilot"],
  "github-copilot": ["github-copilot"],
  ollama: ["ollama"],
  "ax-engine": ["ax-engine"],
  axengine: ["ax-engine"],
  local: ["ax-engine", "ollama"],
  "ax-trust": ["ax-trust-defai-digital"],
  axtrust: ["ax-trust-defai-digital"],
  tencent: ["tencent-coding-plan", "tencent-token-plan"],
  xiaomi: ["xiaomi-token-plan-cn", "xiaomi-token-plan-sgp", "xiaomi-token-plan-ams"],
}

// Model-id prefixes to search on a connected gateway when the native / plan
// provider is disabled. Keys are normalizeProviderName() results.
const FAMILY_MODEL_PREFIXES: Record<string, string[]> = {
  deepseek: ["deepseek"],
  qwen: ["qwen"],
  alibaba: ["qwen"],
  dashscope: ["qwen"],
  tongyi: ["qwen"],
  "alibaba-token-plan": ["qwen"],
  "alibaba-coding-plan": ["qwen"],
  glm: ["glm"],
  zai: ["glm"],
  "z.ai": ["glm"],
  "z-ai": ["glm"],
  zhipu: ["glm"],
  zhipuai: ["glm"],
  chatglm: ["glm"],
  "zai-coding-plan": ["glm"],
  "zhipuai-coding-plan": ["glm"],
  minimax: ["minimax"],
  "minimax-coding-plan": ["minimax"],
  "minimax-token-plan": ["minimax"],
  kimi: ["kimi", "k3", "moonshot"],
  "kimi-cli": ["kimi", "k3", "moonshot"],
  "kimi-code": ["kimi", "k3", "moonshot"],
  moonshot: ["kimi", "k3", "moonshot"],
  moonshotai: ["kimi", "k3", "moonshot"],
  k3: ["k3"],
  grok: ["grok"],
  xai: ["grok"],
  claude: ["claude"],
  anthropic: ["claude"],
  gemini: ["gemini"],
  google: ["gemini"],
  openai: ["gpt"],
  chatgpt: ["gpt"],
}

// Family follow matches model IDs like `deepseek-v4-pro` when the native
// provider id is disconnected. Unmapped short names ("ai") are too collision-prone.
const MIN_FAMILY_KEY_LENGTH = 4

function familyPrefixesFor(requested: string): string[] {
  const normalized = normalizeProviderName(requested)
  const mapped = FAMILY_MODEL_PREFIXES[normalized]
  if (mapped) return mapped
  const family = skuKey(requested)
  if (FAMILY_MODEL_PREFIXES[family]) return FAMILY_MODEL_PREFIXES[family]
  if (family.length >= MIN_FAMILY_KEY_LENGTH) return [family]
  return []
}

function normalizeProviderName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
}

export function resolveConnectedProviderID(requested: string, connectedIDs: readonly string[]): string | undefined {
  if (connectedIDs.includes(requested)) return requested
  const lower = requested.trim().toLowerCase()
  const exact = connectedIDs.find((id) => id.toLowerCase() === lower)
  if (exact) return exact
  const normalized = normalizeProviderName(lower)
  const normalizedExact = connectedIDs.find((id) => id.toLowerCase().replace(/_/g, "-") === normalized)
  if (normalizedExact) return normalizedExact
  for (const alias of PROVIDER_ALIASES[normalized] ?? []) {
    if (connectedIDs.includes(alias)) return alias
    const match = connectedIDs.find((id) => id.toLowerCase() === alias.toLowerCase())
    if (match) return match
  }
  // Versioned Grok SKUs used as a provider name ("grok-4.6") should hit the
  // CLI when it is connected, instead of falling through to a gateway catalog.
  if (normalized === "grok" || normalized.startsWith("grok-") || normalized.startsWith("grokbuild")) {
    for (const alias of GROK_CLI_IDS) {
      if (connectedIDs.includes(alias)) return alias
      const match = connectedIDs.find((id) => id.toLowerCase() === alias.toLowerCase())
      if (match) return match
    }
  }
  return undefined
}

export type ExplicitMemberResolution =
  | { member: { providerID: string; modelID: string }; note?: string }
  | { rejected: string }

/** Keep the first member per provider; later collisions become rejections. */
export function keepDistinctProviderMembers<T extends { providerID: string; memberId: string }>(
  members: readonly T[],
): { members: T[]; rejected: string[] } {
  const unique: T[] = []
  const rejected: string[] = []
  const seen = new Set<string>()
  for (const spec of members) {
    if (seen.has(spec.providerID)) {
      rejected.push(
        `Council requires distinct providers — ${spec.memberId} collides with another member on ${spec.providerID}.`,
      )
      continue
    }
    seen.add(spec.providerID)
    unique.push(spec)
  }
  return { members: unique, rejected }
}

function catalogsForConnectedProviders(
  selectableModels: Readonly<Record<string, readonly string[]>>,
  connectedIDs: readonly string[],
): Array<{ providerID: string; models: readonly string[] }> {
  return [...connectedIDs]
    .sort((left, right) => left.localeCompare(right))
    .map((providerID) => ({ providerID, models: selectableModels[providerID] ?? [] }))
    .filter((entry) => entry.models.length > 0)
}

/**
 * When the requested provider id is not connected (native `deepseek` disabled
 * after the SKU moved behind a gateway), pick the same SKU — never the
 * gateway's first model, which may be a different family.
 */
export function followSkuOnConnectedProviders(input: {
  requestedProvider: string
  requestedModel?: string
  connectedIDs: readonly string[]
  selectableModels: Readonly<Record<string, readonly string[]>>
}): { providerID: string; modelID: string } | undefined {
  const catalogs = catalogsForConnectedProviders(input.selectableModels, input.connectedIDs)
  if (input.requestedModel) {
    const requestedModel = input.requestedModel
    for (const catalog of catalogs) {
      const exact = catalog.models.find(
        (id) => id === requestedModel || id.toLowerCase() === requestedModel.toLowerCase(),
      )
      if (exact) return { providerID: catalog.providerID, modelID: exact }
    }
    const needle = skuKey(requestedModel)
    if (!needle) return undefined
    for (const catalog of catalogs) {
      const hit = catalog.models.find((id) => skuKey(id) === needle)
      if (hit) return { providerID: catalog.providerID, modelID: hit }
    }
    return undefined
  }

  const prefixes = familyPrefixesFor(input.requestedProvider)
  if (prefixes.length === 0) return undefined
  for (const catalog of catalogs) {
    const hit = catalog.models.find((id) => {
      const key = skuKey(id)
      return prefixes.some((prefix) => key === prefix || key.startsWith(prefix))
    })
    if (hit) return { providerID: catalog.providerID, modelID: hit }
  }
  return undefined
}

/**
 * Resolve a user-typed provider/model pair against connected providers.
 * Unknown colloquial names alias first; if the requested model is missing
 * on the resolved provider, fall back to that provider's first selectable
 * model instead of rejecting the whole member.
 */
export function resolveExplicitMemberSelection(input: {
  requestedProvider: string
  requestedModel?: string
  connectedIDs: readonly string[]
  /** Provider ID → selectable model IDs, already preference-sorted. */
  selectableModels: Readonly<Record<string, readonly string[]>>
  /** Provider IDs with a stored credential that failed decryption. */
  undecryptableIDs?: readonly string[]
  /** Provider IDs in `disabled_providers` (still named in config/docs). */
  disabledIDs?: readonly string[]
}): ExplicitMemberResolution {
  const connected = [...input.connectedIDs].sort()
  const connectedLabel = connected.join(", ") || "(none)"
  const resolvedProvider = resolveConnectedProviderID(input.requestedProvider, input.connectedIDs)
  if (!resolvedProvider) {
    const disabled = input.disabledIDs?.length
      ? resolveConnectedProviderID(input.requestedProvider, input.disabledIDs)
      : undefined
    const followed = followSkuOnConnectedProviders(input)
    if (followed) {
      const reason = disabled
        ? `Provider ${JSON.stringify(input.requestedProvider)} is disabled`
        : `Provider ${JSON.stringify(input.requestedProvider)} is not connected`
      return {
        member: followed,
        note: `${reason}; using ${followed.providerID}/${followed.modelID} (same SKU on a connected provider).`,
      }
    }
    // "Unknown provider" is actively misleading when the provider has a
    // credential on disk that merely failed decryption (machine key or crypto
    // runtime changed) — the user believes they are logged in. Resolve the
    // requested name (including aliases) against the failed set so the
    // rejection names the real problem and its fix.
    const undecryptable = input.undecryptableIDs?.length
      ? resolveConnectedProviderID(input.requestedProvider, input.undecryptableIDs)
      : undefined
    if (undecryptable) {
      return {
        rejected:
          `Provider ${JSON.stringify(undecryptable)} has a stored credential that cannot be decrypted, so it is not connected. ` +
          `Ask the user to run \`ax-code providers login --provider ${undecryptable}\` to re-enter it. Connected: ${connectedLabel}.`,
      }
    }
    if (disabled) {
      return {
        rejected:
          `Provider ${JSON.stringify(disabled)} is disabled. Connected: ${connectedLabel}. ` +
          `Re-enable with \`ax-code providers enable ${disabled}\`, or name a connected provider/model that serves that SKU. ` +
          `The connected list is authoritative — do not grep models-snapshot or re-probe credentials.`,
      }
    }
    return {
      rejected:
        `Unknown provider ${JSON.stringify(input.requestedProvider)}. Connected: ${connectedLabel}. ` +
        `The connected list is authoritative — do not grep models-snapshot or re-probe credentials.`,
    }
  }
  const aliasNote =
    normalizeProviderName(resolvedProvider) === normalizeProviderName(input.requestedProvider)
      ? undefined
      : `Provider ${JSON.stringify(input.requestedProvider)} resolved to connected alias ${resolvedProvider}.`
  const models = input.selectableModels[resolvedProvider] ?? []
  if (models.length === 0) {
    return {
      rejected: `No selectable coding model for ${JSON.stringify(resolvedProvider)}. Connected: ${connectedLabel}.`,
    }
  }
  if (!input.requestedModel) {
    return {
      member: { providerID: resolvedProvider, modelID: models[0]! },
      ...(aliasNote ? { note: aliasNote } : {}),
    }
  }
  const requestedModel = input.requestedModel
  const exact = models.find((id) => id === requestedModel || id.toLowerCase() === requestedModel.toLowerCase())
  if (exact) {
    return {
      member: { providerID: resolvedProvider, modelID: exact },
      ...(aliasNote ? { note: aliasNote } : {}),
    }
  }
  const fallbackNote =
    `Requested ${JSON.stringify(`${input.requestedProvider}/${requestedModel}`)} is not selectable; ` +
    `using ${resolvedProvider}/${models[0]}.`
  return {
    member: { providerID: resolvedProvider, modelID: models[0]! },
    note: [aliasNote, fallbackNote].filter(Boolean).join(" "),
  }
}

export namespace EnsembleShared {
  export interface MemberSpec {
    providerID: ProviderID
    modelID: ModelID
    memberId: string
  }

  export interface MemberResolution {
    members: MemberSpec[]
    rejected: string[]
    notes?: string[]
  }

  export interface ResolveConfig {
    minMembers: number
    maxMembers: number
    requireDistinctProviders: boolean
  }

  export type ProviderExclusion = {
    providerID: string
    reason: string
  }

  export type SelectableProviderSnapshot = EnsemblePreflight.ProviderSnapshot & {
    excluded: ProviderExclusion[]
  }

  /**
   * List connected providers that have at least one selectable non-embedding
   * model. Also returns excluded providers with reasons so arena/council can
   * explain "fewer than 2" instead of silently looking empty (#377).
   */
  export async function snapshotSelectableProviders(): Promise<SelectableProviderSnapshot> {
    await Provider.ready()
    const providers = await Provider.list()
    const ids: string[] = []
    const excluded: ProviderExclusion[] = []
    for (const provider of Object.values(providers)) {
      const providerID = String(provider.id)
      const allModels = Object.values(provider.models)
      if (allModels.length === 0) {
        excluded.push({
          providerID,
          reason: "no models discovered yet (provider may still be probing, or has no configured models)",
        })
        continue
      }
      const selectable = allModels.filter((m) => modelSelectableForProvider(provider.id, m))
      if (selectable.length === 0) {
        excluded.push({
          providerID,
          reason: "models present but none selectable (tool-call, memory, or text-output requirements)",
        })
        continue
      }
      if (selectable.every((m) => isNonChatModelID(String(m.id)))) {
        excluded.push({ providerID, reason: "only embedding, rerank, or speech models available" })
        continue
      }
      ids.push(providerID)
    }
    // Providers with an undecryptable stored credential never make it into
    // Provider.list() at all, so without this they would be invisible here —
    // neither connected nor excluded — and read as "unknown".
    const undecryptable = (await Auth.decryptionFailures().catch(() => [] as readonly string[])).filter(
      (providerID) => !isRetiredProviderID(providerID),
    )
    for (const providerID of undecryptable) {
      if (ids.includes(providerID) || excluded.some((entry) => entry.providerID === providerID)) continue
      excluded.push({
        providerID,
        reason: `stored credential cannot be decrypted — run \`ax-code providers login --provider ${providerID}\` to re-enter it`,
      })
    }
    return {
      count: ids.length,
      ids: ids.sort(),
      excluded: excluded.sort((a, b) => a.providerID.localeCompare(b.providerID)),
    }
  }

  /**
   * Resolve explicit member selections or auto-select diverse members.
   * Shared between council (requireDistinctProviders: true) and arena (false).
   */
  export async function resolveMembers(
    config: ResolveConfig,
    explicit: Array<{ providerID: string; modelID?: string }> | undefined,
    maxMembers: number,
    task: string,
  ): Promise<MemberResolution> {
    await Provider.ready()
    const providers = await Provider.list()

    if (explicit?.length) {
      const out: MemberSpec[] = []
      const rejected: string[] = []
      const notes: string[] = []
      const connectedIDs = Object.keys(providers)
      const undecryptableIDs = (await Auth.decryptionFailures().catch(() => [] as readonly string[])).filter(
        (providerID) => !isRetiredProviderID(providerID),
      )
      const disabledIDs = ((await Config.get()).disabled_providers ?? []).filter(
        (providerID) => !isRetiredProviderID(providerID),
      )
      const selectableModels: Record<string, string[]> = {}
      for (const id of connectedIDs) {
        const provider = providers[ProviderID.make(id)]
        if (!provider) continue
        selectableModels[id] = Provider.sort(
          Object.values(provider.models).filter(
            (model) => modelSelectableForProvider(provider.id, model) && !isNonChatModelID(String(model.id)),
          ),
        ).map((model) => String(model.id))
      }
      for (const item of explicit) {
        const resolved = resolveExplicitMemberSelection({
          requestedProvider: item.providerID,
          requestedModel: item.modelID,
          connectedIDs,
          selectableModels,
          undecryptableIDs,
          disabledIDs,
        })
        if ("rejected" in resolved) {
          rejected.push(resolved.rejected)
          continue
        }
        if (resolved.note) notes.push(resolved.note)
        const providerID = ProviderID.make(resolved.member.providerID)
        const modelID = ModelID.make(resolved.member.modelID)
        out.push({ providerID, modelID, memberId: `${providerID}/${modelID}` })
      }
      // Schema uniqueness is on the requested names. SKU-follow can land two
      // colloquial ids on the same connected gateway; drop the later member
      // instead of throwing so council still returns the rest.
      if (config.requireDistinctProviders) {
        const distinct = keepDistinctProviderMembers(out)
        rejected.push(...distinct.rejected)
        return { members: Council.dedupeMembers(distinct.members).slice(0, maxMembers), rejected, notes }
      }
      return { members: Council.dedupeMembers(out).slice(0, maxMembers), rejected, notes }
    }

    let candidates: Array<{ providerID: string; modelID: ModelID }> = []
    for (const provider of Object.values(providers)) {
      const models = Provider.sort(
        Object.values(provider.models).filter(
          (model) => modelSelectableForProvider(provider.id, model) && !isNonChatModelID(String(model.id)),
        ),
      )
      const model = models[0]
      if (!model) continue
      candidates.push({ providerID: String(provider.id), modelID: model.id })
    }

    // Soft bias by historical performance, then diversify families
    try {
      const store = await ModeMemory.load()
      const stats = ModeMemory.aggregateStats(store.outcomes, ModeMemory.classifyTask(task))
      candidates = ModeMemory.biasByMemory(
        candidates.map((c) => ({ ...c, modelID: String(c.modelID) })),
        stats,
      ).map((c) => ({ providerID: c.providerID, modelID: ModelID.make(String(c.modelID)) }))
    } catch {
      // memory is best-effort
    }

    const diverse = Council.selectDiverseMembers(candidates, maxMembers)
    return {
      members: diverse.map((c) => ({
        providerID: ProviderID.make(c.providerID),
        modelID: ModelID.make(String(c.modelID)),
        memberId: `${c.providerID}/${c.modelID}`,
      })),
      rejected: [],
      notes: [],
    }
  }
}
