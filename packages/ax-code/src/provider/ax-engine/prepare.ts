import z from "zod"
import { AX_ENGINE_DEFAULT_PORT, AX_ENGINE_ERROR } from "./constants"
import type { AxEngineModelID, AxEngineQuantization } from "./constants"
import { downloadModel, AxEngineModelStatus, AxEnginePrepareState, getModelStatus, markPrepared } from "./model-cache"
import { getDependencyStatus } from "./dependency"
import { resolveAxEngineModelDefinition } from "./hub-catalog"
import { fetchAxEngineModelContracts, requireAxEngineCodingContract } from "./model-card"
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
  quantization?: AxEngineQuantization
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
  fetchContracts?: typeof fetchAxEngineModelContracts
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

  input.signal?.throwIfAborted()
  const definition = await resolveAxEngineModelDefinition(input.modelID, { signal: input.signal, persist: true })
  const eligibility = await requireEligibility()
  input.signal?.throwIfAborted()
  if (
    definition.estimatedResources &&
    (eligibility.memoryBytes === undefined || eligibility.memoryBytes < definition.minMemoryBytes)
  ) {
    throw new Error(
      `${AX_ENGINE_ERROR.InsufficientMemory}: this package needs an estimated ${Math.ceil(definition.minMemoryBytes / 1024 ** 3)} GiB unified memory`,
    )
  }
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
      ...(definition.revision ? { binaryVersion: dependency.version } : {}),
      modelID: input.modelID,
      quantization: input.quantization,
      signal: input.signal,
    })
    model = modelFromPrepared(prepared)
  } else {
    model = await modelStatus({ modelID: input.modelID, quantization: input.quantization })
  }

  if (!input.start) {
    input.signal?.throwIfAborted()
    return { eligibility, prepared, model }
  }

  if (!model.present || !model.path) {
    throw new Error(model.blockers[0] ?? `${AX_ENGINE_ERROR.ModelMissing}: ax-engine model is not prepared`)
  }

  dependency ??= await dependencyStatus({ binaryPath: input.binaryPath })
  input.signal?.throwIfAborted()
  if (!dependency.available || !dependency.binaryPath) {
    throw new Error(dependency.blockers[0] ?? "ax-engine binary is not available")
  }

  const server = await startServer({
    binaryPath: dependency.binaryPath,
    modelID: model.modelID,
    apiModelID: definition.apiModelID,
    modelPath: model.path,
    modelRevision: model.revision,
    preferredPort: AX_ENGINE_DEFAULT_PORT,
    contextTokens: definition.contextTokens,
    maxOutputTokens: definition.outputTokens,
    binaryVersion: dependency.version,
    signal: input.signal,
  })

  if (definition.revision) {
    const contracts = await (runtime.fetchContracts ?? fetchAxEngineModelContracts)({
      baseURL: server.baseURL,
      signal: input.signal,
    })
    requireAxEngineCodingContract(contracts, definition.apiModelID, { requireText: true })
  }
  return { eligibility, prepared, model, server }
}
