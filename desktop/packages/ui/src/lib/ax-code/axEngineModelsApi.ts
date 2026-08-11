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

export type AxEngineDownloadProgress = {
  mode: "determinate" | "indeterminate"
  percent: number
  done?: number
  total?: number
  message?: string
  updatedAt: number
}

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
  progress?: AxEngineDownloadProgress
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
  /** Served by the live ax-code process — sole catalog contract, not a Desktop hardcode. */
  catalog?: {
    source: string
    modelIDs: string[]
  }
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

/** Desktop /health fields that identify which ax-code binary is serving the catalog. */
export type DesktopAxCodeRuntimeIdentity = {
  binaryPath: string | null
  binarySource: string | null
  version: string | null
}

export const fetchDesktopAxCodeRuntimeIdentity = async (): Promise<DesktopAxCodeRuntimeIdentity> => {
  try {
    const response = await fetch(API_ENDPOINTS.debug.rootHealth, {
      method: "GET",
      headers: { Accept: "application/json" },
    })
    if (!response.ok) return { binaryPath: null, binarySource: null, version: null }
    const body = (await response.json()) as {
      axCodeBinaryResolved?: unknown
      axCodeBinarySource?: unknown
      axCodeVersion?: unknown
    }
    return {
      binaryPath: typeof body.axCodeBinaryResolved === "string" ? body.axCodeBinaryResolved : null,
      binarySource: typeof body.axCodeBinarySource === "string" ? body.axCodeBinarySource : null,
      version: typeof body.axCodeVersion === "string" ? body.axCodeVersion : null,
    }
  } catch {
    return { binaryPath: null, binarySource: null, version: null }
  }
}

/** True when the path looks like a packaged/Homebrew install rather than monorepo source. */
export const isExternalInstalledAxCodeBinary = (binaryPath: string | null | undefined): boolean => {
  if (!binaryPath) return false
  const normalized = binaryPath.replace(/\\/g, "/")
  return (
    normalized.includes("/Cellar/ax-code/") ||
    normalized.includes("/opt/homebrew/bin/ax-code") ||
    normalized.includes("/usr/local/bin/ax-code") ||
    /\/\.ax-code\/bin\/ax-code(?:\.exe)?$/i.test(normalized)
  )
}

export type AxEngineDeleteModelResponse = {
  deleted: boolean
  modelID: string
  quantization: string
  path?: string
  freedBytes?: number
  preparedStateUpdated: boolean
}

export type AxEngineConnectionView = {
  mode: "managed" | "attach"
  baseURL: string
  ready: boolean
  models: string[]
  toolcall: boolean
  hasApiKey: boolean
  error?: string
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

export const fetchAxEngineConnection = async (directory: string | null): Promise<AxEngineConnectionView> => {
  return fetchProviderJsonWithRetry(buildDirectoryUrl(API_ENDPOINTS.provider.axEngineConnection, directory), {
    method: "GET",
    headers: { Accept: "application/json" },
  }) as Promise<AxEngineConnectionView>
}

export const updateAxEngineConnection = async (
  input: { mode: "managed" } | { mode: "attach"; baseURL: string; apiKey?: string },
  directory: string | null,
): Promise<AxEngineConnectionView> => {
  return fetchProviderJsonWithRetry(buildDirectoryUrl(API_ENDPOINTS.provider.axEngineConnection, directory), {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify(input),
  }) as Promise<AxEngineConnectionView>
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
