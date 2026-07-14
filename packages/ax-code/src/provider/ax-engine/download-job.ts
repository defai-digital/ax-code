import { randomUUID } from "crypto"
import { AX_ENGINE_ERROR, AX_ENGINE_MODEL_DEFINITIONS, isAxEngineModelID } from "./constants"
import type { AxEngineModelID, AxEngineQuantization } from "./constants"
import { getDependencyStatus } from "./dependency"
import { downloadModel, getDiskStatus, normalizeQuantization } from "./model-cache"
import { requirePlatformEligibility } from "./platform"

export type AxEngineModelJobStatus = "queued" | "running" | "complete" | "failed" | "cancelled"

export type AxEngineModelJobSummary = {
  id: string
  type: "download"
  modelID: AxEngineModelID
  quantization: AxEngineQuantization
  status: AxEngineModelJobStatus
  startedAt?: number
  finishedAt?: number
  path?: string
  revision?: string
  error?: string
  logTail?: string[]
}

type AxEngineDownloadJob = AxEngineModelJobSummary & {
  controller: AbortController
  promise: Promise<AxEngineModelJobSummary>
}

export type AxEngineDownloadJobRuntime = {
  requireEligibility?: typeof requirePlatformEligibility
  getDependencyStatus?: typeof getDependencyStatus
  getDiskStatus?: typeof getDiskStatus
  downloadModel?: typeof downloadModel
}

const jobs = new Map<string, AxEngineDownloadJob>()
const recentJobs: AxEngineModelJobSummary[] = []

function jobKey(modelID: AxEngineModelID, quantization: AxEngineQuantization) {
  return `${modelID}:${quantization}`
}

function summarize(job: AxEngineModelJobSummary): AxEngineModelJobSummary {
  return { ...job, logTail: job.logTail ? [...job.logTail] : undefined }
}

function remember(job: AxEngineModelJobSummary) {
  recentJobs.unshift(summarize(job))
  recentJobs.splice(20)
}

export async function listDownloadJobs(): Promise<AxEngineModelJobSummary[]> {
  return [...jobs.values()].map(summarize).concat(recentJobs)
}

export async function startDownloadJob(
  input: {
    modelID: AxEngineModelID
    quantization?: AxEngineQuantization
  },
  runtime: AxEngineDownloadJobRuntime = {},
): Promise<AxEngineModelJobSummary> {
  const requireEligibility = runtime.requireEligibility ?? requirePlatformEligibility
  const dependencyStatus = runtime.getDependencyStatus ?? getDependencyStatus
  const diskStatus = runtime.getDiskStatus ?? getDiskStatus
  const download = runtime.downloadModel ?? downloadModel

  if (!isAxEngineModelID(input.modelID)) {
    throw new Error(`${AX_ENGINE_ERROR.DownloadFailed}: unknown AX Engine model`)
  }
  const quantization = normalizeQuantization(input.quantization, input.modelID)
  const key = jobKey(input.modelID, quantization)
  const existing = jobs.get(key)
  if (existing && (existing.status === "queued" || existing.status === "running")) return summarize(existing)

  const controller = new AbortController()
  const job: AxEngineDownloadJob = {
    id: randomUUID(),
    type: "download" as const,
    modelID: input.modelID,
    quantization,
    status: "queued",
    controller,
    promise: Promise.resolve(undefined as unknown as AxEngineModelJobSummary),
  }
  const run = async (): Promise<AxEngineModelJobSummary> => {
    try {
      const eligibility = await requireEligibility()
      const definition = AX_ENGINE_MODEL_DEFINITIONS[input.modelID]
      if (eligibility.memoryBytes !== undefined && eligibility.memoryBytes < definition.minMemoryBytes) {
        throw new Error(
          `${AX_ENGINE_ERROR.InsufficientMemory}: ${Math.ceil(definition.minMemoryBytes / 1024 ** 3)} GB unified memory is required`,
        )
      }
      const dependency = await dependencyStatus()
      if (!dependency.available || !dependency.binaryPath) {
        throw new Error(dependency.blockers[0] ?? `${AX_ENGINE_ERROR.BinaryMissing}: ax-engine binary is not available`)
      }
      const disk = await diskStatus({ modelID: input.modelID, quantization })
      if (!disk.ok) throw new Error(disk.blockers[0] ?? `${AX_ENGINE_ERROR.InsufficientDisk}: insufficient disk space`)
      job.status = "running"
      job.startedAt = Date.now()
      const prepared = await download({
        binaryPath: dependency.binaryPath,
        modelID: input.modelID,
        quantization,
        signal: controller.signal,
      })
      // Cancel can race a late successful download: never leave the job as
      // "complete" after the user (or a superseding start) aborted it.
      // cancelDownloadJob sets status to cancelled before the download promise
      // settles; re-read the mutable job field so TypeScript cannot narrow it
      // away as still "running".
      if (controller.signal.aborted || (job.status as AxEngineModelJobStatus) === "cancelled") {
        job.status = "cancelled"
        job.finishedAt = Date.now()
        job.error = "Download cancelled"
        return summarize(job)
      }
      job.status = "complete"
      job.finishedAt = Date.now()
      job.path = prepared.path
      job.revision = prepared.revision
      return summarize(job)
    } catch (error) {
      job.finishedAt = Date.now()
      if (controller.signal.aborted || (job.status as AxEngineModelJobStatus) === "cancelled") {
        job.status = "cancelled"
        job.error = "Download cancelled"
      } else {
        job.status = "failed"
        job.error = error instanceof Error ? error.message : `${AX_ENGINE_ERROR.DownloadFailed}: download failed`
      }
      return summarize(job)
    } finally {
      // A cancelled/failed job can already have been replaced under this key by
      // a newer start; deleting unconditionally would evict the newer running
      // job from the map (making it uncancellable and invisible to listing).
      if (jobs.get(key) === job) jobs.delete(key)
      remember(job)
    }
  }
  jobs.set(key, job)
  job.promise = run()
  return summarize(job)
}

export async function cancelDownloadJob(jobID: string): Promise<AxEngineModelJobSummary | undefined> {
  for (const job of jobs.values()) {
    if (job.id !== jobID) continue
    job.controller.abort()
    job.status = "cancelled"
    job.finishedAt = Date.now()
    job.error = "Download cancelled"
    return summarize(job)
  }
  return recentJobs.find((job) => job.id === jobID)
}

export function modelDisplayNameForJob(modelID: AxEngineModelID) {
  return AX_ENGINE_MODEL_DEFINITIONS[modelID].name
}
