import { describe, expect, test, vi } from "vitest"
import {
  cancelDownloadJob,
  listDownloadJobs,
  startDownloadJob,
  type AxEngineDownloadJobRuntime,
} from "../../../src/provider/ax-engine/download-job"
import { AX_ENGINE_GEMMA4_12B_MODEL_ID } from "../../../src/provider/ax-engine/constants"
import type { downloadModel } from "../../../src/provider/ax-engine/model-cache"

const MODEL_ID = AX_ENGINE_GEMMA4_12B_MODEL_ID

const eligibility = {
  supported: true,
  platform: "darwin",
  arch: "arm64",
  macosVersion: "26.0",
  macosMajor: 26,
  chip: "Apple M2 Max",
  chipGeneration: "m2",
  memoryBytes: 64 * 1024 ** 3,
  blockers: [],
  warnings: [],
} as any

function runtimeWith(download: typeof downloadModel): AxEngineDownloadJobRuntime {
  return {
    requireEligibility: async () => eligibility,
    getDependencyStatus: async () => ({
      available: true,
      mode: "configured" as const,
      binaryPath: "/bin/ax-engine",
      installable: false,
      blockers: [],
    }),
    getDiskStatus: async () => ({
      path: "/tmp",
      modelID: MODEL_ID,
      quantization: "mlx6bit" as const,
      freeBytes: 1024 ** 4,
      requiredBytes: 48 * 1024 ** 3,
      ok: true,
      blockers: [],
    }),
    downloadModel: download,
  }
}

const preparedState = {
  modelID: MODEL_ID,
  quantization: "mlx6bit" as const,
  path: "/models/gemma",
  revision: "abc123",
  preparedAt: 1,
}

async function activeJobs() {
  const jobs = await listDownloadJobs()
  return jobs.filter((job) => job.status === "queued" || job.status === "running")
}

describe("ax-engine download jobs", () => {
  test("reuses the running job instead of starting a duplicate", async () => {
    let resolveDownload!: (state: typeof preparedState) => void
    let downloadStarted!: () => void
    const downloadRunning = new Promise<void>((resolve) => (downloadStarted = resolve))
    const runtime = runtimeWith(() => {
      downloadStarted()
      return new Promise((resolve) => (resolveDownload = resolve)) as any
    })

    const first = await startDownloadJob({ modelID: MODEL_ID }, runtime)
    const second = await startDownloadJob({ modelID: MODEL_ID }, runtime)
    expect(second.id).toBe(first.id)

    await downloadRunning
    resolveDownload(preparedState)
    await vi.waitFor(async () => expect(await activeJobs()).toEqual([]))
    const jobs = await listDownloadJobs()
    expect(jobs.find((job) => job.id === first.id)?.status).toBe("complete")
  })

  test("cancelled download that still resolves stays cancelled, not complete", async () => {
    let resolveDownload!: (state: typeof preparedState) => void
    let downloadStarted!: () => void
    const downloadRunning = new Promise<void>((resolve) => (downloadStarted = resolve))
    const runtime = runtimeWith(() => {
      downloadStarted()
      return new Promise((resolve) => (resolveDownload = resolve)) as any
    })

    const job = await startDownloadJob({ modelID: MODEL_ID }, runtime)
    await downloadRunning
    const cancelled = await cancelDownloadJob(job.id)
    expect(cancelled?.status).toBe("cancelled")

    resolveDownload(preparedState)
    await vi.waitFor(async () => {
      const jobs = await listDownloadJobs()
      expect(jobs.find((entry) => entry.id === job.id)?.status).toBe("cancelled")
    })
    const jobs = await listDownloadJobs()
    expect(jobs.find((entry) => entry.id === job.id)?.status).not.toBe("complete")
  })

  test("a superseded job's cleanup does not evict its replacement from the job list", async () => {
    // First download: never settles until we release it, so its run() is still
    // in flight (and its `finally` cleanup still pending) when the job is
    // cancelled and a replacement starts.
    let releaseFirst!: (error: Error) => void
    let firstStarted!: () => void
    const firstRunning = new Promise<void>((resolve) => (firstStarted = resolve))
    const firstRuntime = runtimeWith(() => {
      firstStarted()
      return new Promise((_, reject) => (releaseFirst = reject)) as any
    })

    const first = await startDownloadJob({ modelID: MODEL_ID }, firstRuntime)
    await firstRunning

    const cancelled = await cancelDownloadJob(first.id)
    expect(cancelled?.status).toBe("cancelled")

    // Start the replacement before the first job's cleanup has run.
    let resolveSecond!: (state: typeof preparedState) => void
    let secondStarted!: () => void
    const secondRunning = new Promise<void>((resolve) => (secondStarted = resolve))
    const secondRuntime = runtimeWith(() => {
      secondStarted()
      return new Promise((resolve) => (resolveSecond = resolve)) as any
    })
    const second = await startDownloadJob({ modelID: MODEL_ID }, secondRuntime)
    expect(second.id).not.toBe(first.id)
    await secondRunning

    // Now let the first job's run() settle, which triggers its cleanup.
    releaseFirst(new Error("download aborted"))
    await vi.waitFor(async () => {
      const jobs = await listDownloadJobs()
      expect(jobs.find((job) => job.id === first.id)?.status).toBe("cancelled")
    })

    // The replacement must still be tracked: visible in the list and cancellable.
    const active = await activeJobs()
    expect(active.map((job) => job.id)).toContain(second.id)

    resolveSecond(preparedState)
    await vi.waitFor(async () => expect(await activeJobs()).toEqual([]))
    const jobs = await listDownloadJobs()
    expect(jobs.find((job) => job.id === second.id)?.status).toBe("complete")
  })
})
