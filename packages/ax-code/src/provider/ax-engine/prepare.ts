import z from "zod"
import { AX_ENGINE_DEFAULT_PORT, AX_ENGINE_ERROR, AX_ENGINE_MODEL_DEFINITIONS } from "./constants"
import type { AxEngineModelID, AxEngineQuantization } from "./constants"
import { downloadModel, AxEngineModelStatus, AxEnginePrepareState, getModelStatus, markPrepared } from "./model-cache"
import { getDependencyStatus } from "./dependency"
import { AxEnginePlatformEligibility, requirePlatformEligibility } from "./platform"
import { AxEngineServerState, ensureServer } from "./server"

export const AxEnginePrepareResult = z.object({
  eligibility: AxEnginePlatformEligibility,
  prepared: AxEnginePrepareState.optional(),
  model: AxEngineModelStatus,
  server: AxEngineServerState.optional(),
})
export type AxEnginePrepareResult = z.infer<typeof AxEnginePrepareResult>

export type AxEnginePrepareInput = {
  modelID: AxEngineModelID
  modelPath?: string
  binaryPath?: string
  quantization: AxEngineQuantization
  download?: boolean
  start?: boolean
  signal?: AbortSignal
}

type AxEnginePrepareRuntime = {
  requireEligibility?: typeof requirePlatformEligibility
  getDependencyStatus?: typeof getDependencyStatus
  getModelStatus?: typeof getModelStatus
  markPrepared?: typeof markPrepared
  downloadModel?: typeof downloadModel
  ensureServer?: typeof ensureServer
}

function modelFromPrepared(prepared: AxEnginePrepareState): AxEngineModelStatus {
  return {
    present: true,
    modelID: prepared.modelID,
    quantization: prepared.quantization,
    path: prepared.path,
    revision: prepared.revision,
    complete: true,
    blockers: [],
  }
}

export async function prepareAxEngine(
  input: AxEnginePrepareInput,
  runtime: AxEnginePrepareRuntime = {},
): Promise<AxEnginePrepareResult> {
  const requireEligibility = runtime.requireEligibility ?? requirePlatformEligibility
  const dependencyStatus = runtime.getDependencyStatus ?? getDependencyStatus
  const modelStatus = runtime.getModelStatus ?? getModelStatus
  const mark = runtime.markPrepared ?? markPrepared
  const download = runtime.downloadModel ?? downloadModel
  const startServer = runtime.ensureServer ?? ensureServer

  const eligibility = await requireEligibility()
  let dependency: Awaited<ReturnType<typeof getDependencyStatus>> | undefined
  let prepared: AxEnginePrepareState | undefined
  let model: AxEngineModelStatus

  if (input.modelPath) {
    prepared = await mark({
      modelID: input.modelID,
      modelPath: input.modelPath,
      quantization: input.quantization,
    })
    model = modelFromPrepared(prepared)
  } else if (input.download) {
    dependency = await dependencyStatus({ binaryPath: input.binaryPath })
    if (!dependency.available || !dependency.binaryPath) {
      throw new Error(dependency.blockers[0] ?? "ax-engine binary is not available")
    }
    prepared = await download({
      binaryPath: dependency.binaryPath,
      modelID: input.modelID,
      quantization: input.quantization,
      signal: input.signal,
    })
    model = modelFromPrepared(prepared)
  } else {
    model = await modelStatus({ modelID: input.modelID, quantization: input.quantization })
  }

  if (!input.start) {
    return { eligibility, prepared, model }
  }

  if (!model.present || !model.path) {
    throw new Error(model.blockers[0] ?? `${AX_ENGINE_ERROR.ModelMissing}: ax-engine model is not prepared`)
  }

  dependency ??= await dependencyStatus({ binaryPath: input.binaryPath })
  if (!dependency.available || !dependency.binaryPath) {
    throw new Error(dependency.blockers[0] ?? "ax-engine binary is not available")
  }

  const server = await startServer({
    binaryPath: dependency.binaryPath,
    modelID: model.modelID,
    apiModelID: AX_ENGINE_MODEL_DEFINITIONS[model.modelID].apiModelID,
    modelPath: model.path,
    modelRevision: model.revision,
    preferredPort: AX_ENGINE_DEFAULT_PORT,
    signal: input.signal,
  })

  return { eligibility, prepared, model, server }
}
