// View-model for the AX Engine download watcher. Pure functions over the
// /provider/ax-engine/downloads job list so polling, toasts, the prompt chip,
// and the submit guard all agree on what a job means.

export type AxEngineDownloadJobStatus = "queued" | "running" | "complete" | "failed" | "cancelled"

export type AxEngineDownloadJobView = {
  id: string
  modelID: string
  status: AxEngineDownloadJobStatus
  percent?: number
  error?: string
}

export function axEngineJobActive(job: Pick<AxEngineDownloadJobView, "status">) {
  return job.status === "queued" || job.status === "running"
}

/** Clamp a server-reported percent into a displayable integer, if present. */
export function axEngineJobPercent(job: Pick<AxEngineDownloadJobView, "percent">): number | undefined {
  const percent = job.percent
  if (typeof percent !== "number" || !Number.isFinite(percent)) return undefined
  return Math.max(0, Math.min(100, Math.round(percent)))
}

/**
 * The active (queued/running) job for a model, if any. The server lists
 * current jobs before recent history, so the first active match wins.
 */
export function activeAxEngineJobForModel(
  jobs: readonly AxEngineDownloadJobView[],
  modelID: string,
): AxEngineDownloadJobView | undefined {
  return jobs.find((job) => job.modelID === modelID && axEngineJobActive(job))
}

/** Short chip shown next to the model name while its weights download. */
export function axEngineDownloadChip(job: Pick<AxEngineDownloadJobView, "status" | "percent">): string {
  if (job.status === "queued") return "download queued"
  const percent = axEngineJobPercent(job)
  return percent === undefined ? "downloading" : `downloading ${percent}%`
}

export type AxEngineJobTransition = {
  job: AxEngineDownloadJobView
  to: "complete" | "failed" | "cancelled"
}

/**
 * Jobs that reached a terminal state since the previous observation.
 * `observed` maps job id → last seen status; only jobs previously seen as
 * queued/running produce a transition, so the terminal jobs the server keeps
 * in recent history never re-toast on startup or on every poll.
 */
export function axEngineJobTransitions(
  observed: ReadonlyMap<string, string>,
  jobs: readonly AxEngineDownloadJobView[],
): AxEngineJobTransition[] {
  const transitions: AxEngineJobTransition[] = []
  for (const job of jobs) {
    if (job.status !== "complete" && job.status !== "failed" && job.status !== "cancelled") continue
    const previous = observed.get(job.id)
    if (previous === "queued" || previous === "running") transitions.push({ job, to: job.status })
  }
  return transitions
}

export function axEngineJobToast(transition: AxEngineJobTransition): { message: string; variant: "success" | "error" | "info" } {
  const { job, to } = transition
  if (to === "complete") {
    return { message: `${job.modelID} download complete — the model is ready to use`, variant: "success" }
  }
  if (to === "failed") {
    return { message: `${job.modelID} download failed${job.error ? `: ${job.error}` : ""}`, variant: "error" }
  }
  return { message: `${job.modelID} download cancelled`, variant: "info" }
}
