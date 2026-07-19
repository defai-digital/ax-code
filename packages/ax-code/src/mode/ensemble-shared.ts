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

  /** List connected providers that have at least one selectable non-embedding model. */
  export async function snapshotSelectableProviders(): Promise<EnsemblePreflight.ProviderSnapshot> {
    await Provider.ready()
    const providers = await Provider.list()
    const ids: string[] = []
    for (const provider of Object.values(providers)) {
      const models = Object.values(provider.models).filter((m) => modelSelectableForProvider(provider.id, m))
      if (models.length === 0) continue
      if (models.every((m) => String(m.id).toLowerCase().includes("embed"))) continue
      ids.push(String(provider.id))
    }
    return { count: ids.length, ids: ids.sort() }
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
      for (const item of explicit) {
        const providerID = ProviderID.make(item.providerID)
        const provider = providers[providerID]
        if (!provider) {
          rejected.push(`Unknown provider ${JSON.stringify(item.providerID)}`)
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
