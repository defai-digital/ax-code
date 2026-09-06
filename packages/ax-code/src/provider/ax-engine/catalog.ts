import z from "zod"
import {
  AX_ENGINE_CATALOG_SOURCE,
  AX_ENGINE_ERROR,
  AX_ENGINE_MODEL_DEFINITIONS,
  AX_ENGINE_MODEL_IDS,
} from "./constants"
import type { AxEngineModelID, AxEngineQuantization } from "./constants"
import { AxEngineDependencyStatus, getDependencyStatus, pinnedDownloadVersionBlocker } from "./dependency"
import { AxEngineDiskStatus, evaluateDiskStatus, getDiskStatus } from "./model-cache"
import { AxEnginePlatformEligibility, getPlatformEligibility } from "./platform"
import { getModelStatus, type AxEngineModelStatus } from "./model-cache"
import { listDownloadJobs, type AxEngineModelJobSummary } from "./download-job"
import { getServerStatus, type AxEngineServerRuntimeStatus } from "./server"
import { axEngineHubCatalog } from "./hub-catalog"
import { fetchAxEngineModelContracts } from "./model-card"
import type { HubModelDecision } from "./hub-model"

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
  "verification-required",
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
  recommended: boolean
  verification: "unverified" | "verified"
  revision?: string
  estimatedResources?: boolean
  local: AxEngineModelStatus
  disk: AxEngineDiskStatus
  fit: AxEngineModelFit
}

export type AxEngineCatalogMeta = {
  /** Repo-relative path of the TypeScript module that defines the catalog. */
  source: typeof AX_ENGINE_CATALOG_SOURCE
  /** Opaque IDs, including legacy aliases and pinned Hub artifact references. */
  modelIDs: readonly AxEngineModelID[]
}

export type AxEngineModelsResponse = {
  /** Identity of the in-process catalog contract (not a client-side list). */
  catalog: AxEngineCatalogMeta
  eligibility: AxEnginePlatformEligibility
  dependency: AxEngineDependencyStatus
  server: AxEngineServerRuntimeStatus
  diskRoot: {
    path: string
    freeBytes?: number
    blockers: string[]
  }
  models: AxEngineModelCatalogEntry[]
  jobs: AxEngineModelJobSummary[]
  discovery: { source: string; fetchedAt: number; warnings: string[]; decisions: HubModelDecision[] }
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
  estimatedResources?: boolean
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

  if (
    (input.estimatedResources && memoryBytes === undefined) ||
    (memoryBytes !== undefined && memoryBytes < input.minMemoryBytes)
  ) {
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

export async function getAxEngineModelsCatalog(
  options: { refresh?: boolean; signal?: AbortSignal } = {},
): Promise<AxEngineModelsResponse> {
  const [eligibility, dependency, jobs, server, hub] = await Promise.all([
    getPlatformEligibility(),
    getDependencyStatus(),
    listDownloadJobs(),
    getServerStatus(),
    axEngineHubCatalog.inspect(options),
  ])
  const diskRootStatus = await getDiskStatus()
  const activeJobs = selectCurrentAxEngineModelJobs(jobs)
  const models: AxEngineModelCatalogEntry[] = []

  const definitions = [...AX_ENGINE_MODEL_IDS.map((id) => AX_ENGINE_MODEL_DEFINITIONS[id]), ...hub.definitions]
  const live =
    server.ready && server.state
      ? await fetchAxEngineModelContracts({ baseURL: server.state.baseURL, signal: options.signal }).catch(() => [])
      : []
  for (const definition of definitions) {
    const modelID = definition.id
    const quantization = definition.defaultQuantization
    const quant = definition.quantizations[quantization]
    if (!quant) continue
    const local = await getModelStatus({ modelID, quantization })
    const disk = evaluateDiskStatus({
      path: diskRootStatus.path,
      modelID,
      quantization,
      freeBytes: diskRootStatus.freeBytes,
      requiredBytes: quant.minDiskBytes,
    })
    const activeJob = activeJobs.get(`${modelID}:${quantization}`)
    const contract =
      server.state?.modelID === modelID && server.state.modelRevision === definition.revision
        ? live.find(
            (card) =>
              card.id === definition.apiModelID &&
              card.toolcall &&
              (definition.revision
                ? card.capabilities.output?.text === true
                : card.capabilities.output?.text !== false) &&
              (definition.revision ? card.capabilities.input?.text === true : card.capabilities.input?.text !== false),
          )
        : undefined
    const fit = evaluateAxEngineModelFit({
      eligibility,
      dependency,
      disk,
      model: local,
      minMemoryBytes: definition.minMemoryBytes,
      estimatedResources: definition.estimatedResources,
      activeJob,
    })
    if (definition.revision) {
      fit.warnings.push("Resource requirements are estimates; native capabilities are checked when the model starts")
      if (!contract) {
        fit.runnable = false
        if (fit.state === "ready") fit.state = "verification-required"
      }
      const versionBlocker = !local.present && pinnedDownloadVersionBlocker(dependency.version)
      if (versionBlocker) {
        fit.downloadable = false
        fit.blockers.push(versionBlocker)
        if (fit.state === "downloadable") fit.state = "dependency-missing"
      }
    }
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
      toolcall: contract?.toolcall ?? definition.toolcall,
      recommended: !definition.revision,
      verification: contract ? "verified" : "unverified",
      revision: definition.revision,
      estimatedResources: definition.estimatedResources,
      local,
      disk,
      fit,
    })
  }

  return {
    catalog: {
      source: AX_ENGINE_CATALOG_SOURCE,
      modelIDs: models.map((model) => model.id),
    },
    eligibility,
    dependency,
    server,
    diskRoot: {
      path: diskRootStatus.path,
      freeBytes: diskRootStatus.freeBytes,
      blockers: diskRootStatus.blockers,
    },
    models,
    jobs,
    discovery: {
      source: hub.source,
      fetchedAt: hub.catalog.fetchedAt,
      warnings: hub.warnings,
      decisions: hub.decisions,
    },
  }
}
