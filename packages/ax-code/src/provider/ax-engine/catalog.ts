import z from "zod"
import {
  AX_ENGINE_ERROR,
  AX_ENGINE_MODEL_DEFINITIONS,
  AX_ENGINE_MODEL_IDS,
  AX_ENGINE_QUANTIZATION_IDS,
} from "./constants"
import type { AxEngineModelID, AxEngineQuantization } from "./constants"
import { AxEngineDependencyStatus, getDependencyStatus } from "./dependency"
import { AxEngineDiskStatus, getDiskStatus } from "./model-cache"
import { AxEnginePlatformEligibility, getPlatformEligibility } from "./platform"
import { getModelStatus, type AxEngineModelStatus } from "./model-cache"
import { listDownloadJobs, type AxEngineModelJobSummary } from "./download-job"

export const AxEngineModelFitState = z.enum([
  "ready",
  "downloadable",
  "downloading",
  "not-fit",
  "host-unsupported",
  "dependency-missing",
  "disk-blocked",
  "local-unusable",
  "failed",
])
export type AxEngineModelFitState = z.infer<typeof AxEngineModelFitState>

export type AxEngineModelFit = {
  state: AxEngineModelFitState
  downloadable: boolean
  runnable: boolean
  deletable: boolean
  blockers: string[]
  warnings: string[]
}

export type AxEngineModelCatalogEntry = {
  id: AxEngineModelID
  apiModelID: string
  name: string
  quantization: AxEngineQuantization
  hfRepo: string
  mtpSource: string
  minDiskBytes: number
  minMemoryBytes: number
  contextTokens: number
  outputTokens: number
  toolcall: boolean
  local: AxEngineModelStatus
  disk: AxEngineDiskStatus
  fit: AxEngineModelFit
}

export type AxEngineModelsResponse = {
  eligibility: AxEnginePlatformEligibility
  dependency: AxEngineDependencyStatus
  diskRoot: {
    path: string
    freeBytes?: number
    blockers: string[]
  }
  models: AxEngineModelCatalogEntry[]
  jobs: AxEngineModelJobSummary[]
}

export function selectCurrentAxEngineModelJobs(jobs: AxEngineModelJobSummary[]) {
  const selected = new Map<string, AxEngineModelJobSummary>()
  for (const job of jobs) {
    const key = `${job.modelID}:${job.quantization}`
    if (!selected.has(key)) selected.set(key, job)
  }
  return selected
}

export function evaluateAxEngineModelFit(input: {
  eligibility: AxEnginePlatformEligibility
  dependency: AxEngineDependencyStatus
  disk: AxEngineDiskStatus
  model: AxEngineModelStatus
  minMemoryBytes: number
  activeJob?: AxEngineModelJobSummary
}): AxEngineModelFit {
  const blockers: string[] = []
  const warnings: string[] = [...(input.eligibility.warnings ?? [])]
  const memoryBytes = input.eligibility.memoryBytes

  if (!input.eligibility.supported) {
    blockers.push(...input.eligibility.blockers)
    return {
      state: input.model.present ? "local-unusable" : "host-unsupported",
      downloadable: false,
      runnable: false,
      deletable: input.model.present,
      blockers,
      warnings,
    }
  }

  if (memoryBytes !== undefined && memoryBytes < input.minMemoryBytes) {
    blockers.push(
      `${AX_ENGINE_ERROR.InsufficientMemory}: ${Math.ceil(input.minMemoryBytes / 1024 ** 3)} GB unified memory is required`,
    )
    return {
      state: input.model.present ? "local-unusable" : "not-fit",
      downloadable: false,
      runnable: false,
      deletable: input.model.present,
      blockers,
      warnings,
    }
  }

  if (input.activeJob && (input.activeJob.status === "queued" || input.activeJob.status === "running")) {
    return {
      state: "downloading",
      downloadable: false,
      runnable: false,
      deletable: false,
      blockers,
      warnings,
    }
  }

  if (input.activeJob?.status === "failed") {
    blockers.push(input.activeJob.error ?? `${AX_ENGINE_ERROR.DownloadFailed}: download failed`)
    return {
      state: "failed",
      downloadable: false,
      runnable: input.model.present,
      deletable: input.model.present,
      blockers,
      warnings,
    }
  }

  if (!input.dependency.available) {
    blockers.push(...input.dependency.blockers)
    return {
      state: "dependency-missing",
      downloadable: false,
      runnable: input.model.present,
      deletable: input.model.present,
      blockers,
      warnings,
    }
  }

  if (!input.model.present && !input.disk.ok) {
    blockers.push(...input.disk.blockers)
    return {
      state: "disk-blocked",
      downloadable: false,
      runnable: false,
      deletable: false,
      blockers,
      warnings,
    }
  }

  if (input.model.present) {
    return {
      state: "ready",
      downloadable: false,
      runnable: true,
      deletable: true,
      blockers,
      warnings,
    }
  }

  return {
    state: "downloadable",
    downloadable: true,
    runnable: false,
    deletable: false,
    blockers,
    warnings,
  }
}

export async function getAxEngineModelsCatalog(): Promise<AxEngineModelsResponse> {
  const [eligibility, dependency, jobs] = await Promise.all([
    getPlatformEligibility(),
    getDependencyStatus(),
    listDownloadJobs(),
  ])
  const diskRootStatus = await getDiskStatus()
  const activeJobs = selectCurrentAxEngineModelJobs(jobs)
  const models: AxEngineModelCatalogEntry[] = []

  for (const modelID of AX_ENGINE_MODEL_IDS) {
    const definition = AX_ENGINE_MODEL_DEFINITIONS[modelID]
    const quantization = definition.defaultQuantization
    if (!AX_ENGINE_QUANTIZATION_IDS.includes(quantization)) continue
    const quant = definition.quantizations[quantization]
    const [local, disk] = await Promise.all([
      getModelStatus({ modelID, quantization }),
      getDiskStatus({ modelID, quantization }),
    ])
    const activeJob = activeJobs.get(`${modelID}:${quantization}`)
    models.push({
      id: modelID,
      apiModelID: definition.apiModelID,
      name: definition.name,
      quantization,
      hfRepo: quant.hfRepo,
      mtpSource: quant.mtpSource,
      minDiskBytes: quant.minDiskBytes,
      minMemoryBytes: definition.minMemoryBytes,
      contextTokens: definition.contextTokens,
      outputTokens: definition.outputTokens,
      toolcall: definition.toolcall,
      local,
      disk,
      fit: evaluateAxEngineModelFit({
        eligibility,
        dependency,
        disk,
        model: local,
        minMemoryBytes: definition.minMemoryBytes,
        activeJob,
      }),
    })
  }

  return {
    eligibility,
    dependency,
    diskRoot: {
      path: diskRootStatus.path,
      freeBytes: diskRootStatus.freeBytes,
      blockers: diskRootStatus.blockers,
    },
    models,
    jobs,
  }
}
