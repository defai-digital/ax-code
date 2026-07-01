import { API_ENDPOINTS, replacePathParams } from "@/lib/http"
import { buildDirectoryUrl, fetchProviderJsonWithRetry } from "./providerApi"

export type AxEngineModelFitState =
  | "ready"
  | "downloadable"
  | "downloading"
  | "not-fit"
  | "host-unsupported"
  | "dependency-missing"
  | "disk-blocked"
  | "local-unusable"
  | "failed"

export type AxEngineModelJobSummary = {
  id: string
  type: "download"
  modelID: string
  quantization: string
  status: "queued" | "running" | "complete" | "failed" | "cancelled"
  startedAt?: number
  finishedAt?: number
  path?: string
  revision?: string
  error?: string
  logTail?: string[]
}

export type AxEngineModelCatalogEntry = {
  id: string
  apiModelID: string
  name: string
  quantization: string
  hfRepo: string
  mtpSource: string
  minDiskBytes: number
  minMemoryBytes: number
  contextTokens: number
  outputTokens: number
  toolcall: boolean
  local: {
    present: boolean
    complete: boolean
    path?: string
    revision?: string
    bytes?: number
    blockers: string[]
  }
  disk: {
    path: string
    freeBytes?: number
    requiredBytes: number
    ok: boolean
    blockers: string[]
  }
  fit: {
    state: AxEngineModelFitState
    downloadable: boolean
    runnable: boolean
    deletable: boolean
    blockers: string[]
    warnings: string[]
  }
}

export type AxEngineModelsResponse = {
  eligibility: {
    supported: boolean
    platform: string
    arch: string
    macosVersion?: string
    macosMajor?: number
    chip?: string
    chipGeneration?: string
    memoryBytes?: number
    blockers: string[]
    warnings: string[]
  }
  dependency: {
    available: boolean
    mode?: string
    binaryPath?: string
    managedVersion?: string
    installable?: boolean
    blockers: string[]
  }
  server: {
    running: boolean
    ready: boolean
    state?: {
      pid: number
      port: number
      baseURL: string
      modelID: string
      apiModelID?: string
      modelPath: string
      modelRevision?: string
      binaryPath: string
      contextTokens?: number
      speculationProfile?: string
      mtpMode?: string
      startedAt: number
      lastHealthAt?: number
    }
    blockers: string[]
  }
  diskRoot: {
    path: string
    freeBytes?: number
    blockers: string[]
  }
  models: AxEngineModelCatalogEntry[]
  jobs: AxEngineModelJobSummary[]
}

export type AxEngineDeleteModelResponse = {
  deleted: boolean
  modelID: string
  quantization: string
  path?: string
  freedBytes?: number
  preparedStateUpdated: boolean
}

const jsonHeaders = { "Content-Type": "application/json", Accept: "application/json" }

export const fetchAxEngineModels = async (directory: string | null): Promise<AxEngineModelsResponse> => {
  return fetchProviderJsonWithRetry(buildDirectoryUrl(API_ENDPOINTS.provider.axEngineModels, directory), {
    method: "GET",
    headers: { Accept: "application/json" },
  }) as Promise<AxEngineModelsResponse>
}

export const startAxEngineModelDownload = async (
  modelId: string,
  directory: string | null,
): Promise<AxEngineModelJobSummary> => {
  return fetchProviderJsonWithRetry(
    buildDirectoryUrl(replacePathParams(API_ENDPOINTS.provider.axEngineModelDownload, { modelId }), directory),
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  ) as Promise<AxEngineModelJobSummary>
}

export const cancelAxEngineModelDownload = async (
  jobId: string,
  directory: string | null,
): Promise<AxEngineModelJobSummary> => {
  return fetchProviderJsonWithRetry(
    buildDirectoryUrl(replacePathParams(API_ENDPOINTS.provider.axEngineDownloadCancel, { jobId }), directory),
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  ) as Promise<AxEngineModelJobSummary>
}

export const deleteAxEngineModel = async (
  modelId: string,
  directory: string | null,
): Promise<AxEngineDeleteModelResponse> => {
  return fetchProviderJsonWithRetry(
    buildDirectoryUrl(replacePathParams(API_ENDPOINTS.provider.axEngineModel, { modelId }), directory),
    {
      method: "DELETE",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  ) as Promise<AxEngineDeleteModelResponse>
}

export type AxEngineInstallResult = {
  installed: boolean
  alreadyPresent: boolean
  version: string
  binaryPath: string
}

export const installAxEngine = async (directory: string | null): Promise<AxEngineInstallResult> => {
  return fetchProviderJsonWithRetry(buildDirectoryUrl(API_ENDPOINTS.provider.axEngineInstall, directory), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({}),
  }) as Promise<AxEngineInstallResult>
}

export const startAxEngineServer = async (modelId: string, directory: string | null) => {
  return fetchProviderJsonWithRetry(buildDirectoryUrl(API_ENDPOINTS.provider.axEngineStart, directory), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ modelID: modelId, download: false }),
  })
}

export const stopAxEngineServer = async (directory: string | null): Promise<boolean> => {
  return fetchProviderJsonWithRetry(buildDirectoryUrl(API_ENDPOINTS.provider.axEngineStop, directory), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({}),
  }) as Promise<boolean>
}
