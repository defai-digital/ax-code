import {
  AX_ENGINE_ERROR,
  AX_ENGINE_MODEL_DEFINITIONS,
  axEngineHubReference,
  isAxEngineModelID,
  isAxEngineBuiltinModelID,
} from "./constants"

/** Exact Qwen3.8 27B AXQ 6-bit MTP choice. Historical IDs remain valid storage identities. */
export const AX_ENGINE_LOCAL_REPOSITORIES = ["AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP"] as const

export function axEngineLocalRepository(modelID: unknown): string | undefined {
  if (!isAxEngineModelID(modelID)) return
  const definition = isAxEngineBuiltinModelID(modelID) ? AX_ENGINE_MODEL_DEFINITIONS[modelID] : undefined
  const repo = definition
    ? definition.quantizations[definition.defaultQuantization]?.hfRepo
    : axEngineHubReference(modelID)?.repoID
  return AX_ENGINE_LOCAL_REPOSITORIES.find((allowed) => allowed === repo)
}

export function requireAxEngineLocalModel(modelID: unknown) {
  if (axEngineLocalRepository(modelID)) return
  throw new Error(`${AX_ENGINE_ERROR.ModelUnsupported}: select AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP`)
}

/** Prefer stable aliases; otherwise retain the inventory's first pinned revision. */
export function selectAxEngineLocalModels<T>(models: readonly T[], modelID: (model: T) => unknown): T[] {
  return AX_ENGINE_LOCAL_REPOSITORIES.flatMap((repo) => {
    const matches = models.filter((model) => axEngineLocalRepository(modelID(model)) === repo)
    const selected = matches.find((model) => isAxEngineBuiltinModelID(modelID(model))) ?? matches[0]
    return selected === undefined ? [] : [selected]
  })
}
