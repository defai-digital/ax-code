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
import { Council } from "./council"
import { ModeMemory } from "./memory"
import { EnsemblePreflight } from "./preflight"
import { modelSelectableForProvider } from "../provider/model-selectability"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { isRetiredProviderID } from "../provider/retired-providers"

/** Colloquial names users type ("grok", "codex") → connected provider IDs. */
const PROVIDER_ALIASES: Record<string, string[]> = {
  grok: ["grok-build-cli"],
  "grok-build": ["grok-build-cli"],
  grokbuild: ["grok-build-cli"],
  grokbuildcli: ["grok-build-cli"],
  "grok-4": ["grok-build-cli"],
  "grok-4.5": ["grok-build-cli"],
  xai: ["grok-build-cli"],
  codex: ["codex-cli", "openai"],
  "codex-cli": ["codex-cli", "openai"],
  openai: ["openai", "codex-cli"],
  claude: ["anthropic", "claude-code"],
  anthropic: ["anthropic", "claude-code"],
  gemini: ["google"],
  kimi: ["kimi-cli"],
  "kimi-code": ["kimi-cli"],
  "kimi-code-cli": ["kimi-cli"],
  qoder: ["qoder-cli"],
  qodercli: ["qoder-cli"],
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
  return undefined
}

export type ExplicitMemberResolution =
  | { member: { providerID: string; modelID: string }; note?: string }
  | { rejected: string }

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
}): ExplicitMemberResolution {
  const connected = [...input.connectedIDs].sort()
  const connectedLabel = connected.join(", ") || "(none)"
  const resolvedProvider = resolveConnectedProviderID(input.requestedProvider, input.connectedIDs)
  if (!resolvedProvider) {
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
      if (selectable.every((m) => String(m.id).toLowerCase().includes("embed"))) {
        excluded.push({ providerID, reason: "only embedding models available" })
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
      const selectableModels: Record<string, string[]> = {}
      for (const id of connectedIDs) {
        const provider = providers[ProviderID.make(id)]
        if (!provider) continue
        selectableModels[id] = Provider.sort(
          Object.values(provider.models).filter(
            (model) =>
              modelSelectableForProvider(provider.id, model) && !String(model.id).toLowerCase().includes("embed"),
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
      if (config.requireDistinctProviders) {
        const providerIDs = new Set(out.map((s) => s.providerID))
        if (providerIDs.size < out.length) {
          throw new Error("Council requires distinct providers \u2014 duplicate providerID found")
        }
      }
      return { members: Council.dedupeMembers(out).slice(0, maxMembers), rejected, notes }
    }

    let candidates: Array<{ providerID: string; modelID: ModelID }> = []
    for (const provider of Object.values(providers)) {
      const models = Provider.sort(
        Object.values(provider.models).filter(
          (model) =>
            modelSelectableForProvider(provider.id, model) && !String(model.id).toLowerCase().includes("embed"),
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
