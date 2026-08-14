/**
 * Shared ensemble member resolution and provider snapshotting.
 * Eliminates duplication between council.ts and arena.ts.
 *
 * Note: MemberSelectionSchema and its validation are kept local in each tool
 * to avoid a circular-dependency at module-load time (the tools import
 * arena-implement → session → prompt-tools → registry → tool modules,
 * which can prevent this namespace from being available at evaluation time).
 */

import { Council } from "./council"
import { ModeMemory } from "./memory"
import { EnsemblePreflight } from "./preflight"
import { modelSelectableForProvider } from "../provider/model-selectability"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"

/** Colloquial names users type ("grok", "codex") → connected provider IDs. */
const PROVIDER_ALIASES: Record<string, string[]> = {
  grok: ["grok-build-cli", "xai"],
  "grok-4": ["grok-build-cli"],
  "grok-4.5": ["grok-build-cli"],
  xai: ["xai", "grok-build-cli"],
  codex: ["codex-cli", "openai"],
  "codex-cli": ["codex-cli", "openai"],
  claude: ["anthropic"],
  anthropic: ["anthropic"],
}

export function resolveConnectedProviderID(
  requested: string,
  connectedIDs: readonly string[],
): string | undefined {
  if (connectedIDs.includes(requested)) return requested
  const lower = requested.toLowerCase()
  const exact = connectedIDs.find((id) => id.toLowerCase() === lower)
  if (exact) return exact
  for (const alias of PROVIDER_ALIASES[lower] ?? []) {
    if (connectedIDs.includes(alias)) return alias
    const match = connectedIDs.find((id) => id.toLowerCase() === alias.toLowerCase())
    if (match) return match
  }
  return undefined
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
    return { count: ids.length, ids: ids.sort(), excluded: excluded.sort((a, b) => a.providerID.localeCompare(b.providerID)) }
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
      const connectedIDs = Object.keys(providers)
      for (const item of explicit) {
        const resolved = resolveConnectedProviderID(item.providerID, connectedIDs)
        if (!resolved) {
          rejected.push(
            `Unknown provider ${JSON.stringify(item.providerID)}. Connected: ${connectedIDs.sort().join(", ") || "(none)"}.`,
          )
          continue
        }
        const providerID = ProviderID.make(resolved)
        const provider = providers[providerID]
        if (!provider) {
          rejected.push(
            `Unknown provider ${JSON.stringify(item.providerID)}. Connected: ${connectedIDs.sort().join(", ") || "(none)"}.`,
          )
          continue
        }
        let modelID: ModelID | undefined
        if (item.modelID) {
          const model = Object.values(provider.models).find(
            (candidate) =>
              String(candidate.id) === item.modelID &&
              modelSelectableForProvider(providerID, candidate) &&
              !String(candidate.id).toLowerCase().includes("embed"),
          )
          modelID = model?.id
          if (!modelID) {
            rejected.push(`Unknown or unselectable model ${JSON.stringify(`${item.providerID}/${item.modelID}`)}`)
          }
        } else {
          const sorted = Provider.sort(
            Object.values(provider.models).filter(
              (model) =>
                modelSelectableForProvider(providerID, model) && !String(model.id).toLowerCase().includes("embed"),
            ),
          )
          modelID = sorted[0]?.id
        }
        if (!modelID) {
          if (!item.modelID) rejected.push(`No selectable coding model for ${JSON.stringify(item.providerID)}`)
          continue
        }
        out.push({ providerID, modelID, memberId: `${providerID}/${modelID}` })
      }
      if (config.requireDistinctProviders) {
        const providerIDs = new Set(out.map((s) => s.providerID))
        if (providerIDs.size < out.length) {
          throw new Error("Council requires distinct providers \u2014 duplicate providerID found")
        }
      }
      return { members: Council.dedupeMembers(out).slice(0, maxMembers), rejected }
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
    }
  }
}
