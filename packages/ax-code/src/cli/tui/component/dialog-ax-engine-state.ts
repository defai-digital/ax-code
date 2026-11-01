// Picker annotations for managed AX Engine models. The /provider/ax-engine/models
// catalog computes a per-model fit state (ready / downloadable / downloading /
// failed / blocked); these helpers turn it into the short description the model
// picker shows so an undownloaded model is never a silent selection.

// Minimal projection of a catalog entry — only the fields annotations read.
// The server catalog is the authority.
export type AxEngineCatalogEntryState = {
  id: string
  local?: { present?: boolean }
  fit?: { state?: string; blockers?: string[] }
}

// Minimal projection of a catalog `jobs` entry: the live download job whose
// progress (percent plus the engine's current file or retry notice) the
// "downloading" annotation shows.
export type AxEngineCatalogJobState = {
  modelID?: string
  status?: string
  progress?: { percent?: number; message?: string }
}

/** "Downloading 45% · model-00002-of-00003.safetensors", degrading to "Downloading..." without a job. */
export function axEngineDownloadAnnotation(job?: AxEngineCatalogJobState): string {
  if (job?.status === "queued") return "Download queued"
  const raw = job?.progress?.percent
  const percent =
    typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : undefined
  const head = percent === undefined ? "Downloading..." : `Downloading ${percent}%`
  const message = job?.progress?.message?.trim()
  return message ? `${head} · ${message}` : head
}

function activeCatalogJob(jobs: readonly AxEngineCatalogJobState[], modelID: string) {
  return jobs.find((job) => job.modelID === modelID && (job.status === "queued" || job.status === "running"))
}

/**
 * Short picker description for a model that cannot serve a chat turn yet.
 * Returns undefined for states that need no annotation (ready, or unknown
 * states the picker should not guess at).
 */
export function axEngineModelStateAnnotation(
  entry: {
    state?: string
    blockers?: readonly string[]
  },
  job?: AxEngineCatalogJobState,
): string | undefined {
  switch (entry.state) {
    case "verification-required":
      return "Prepared; runtime verification required"
    case "downloadable":
      return "Not downloaded"
    case "downloading":
      return axEngineDownloadAnnotation(job)
    case "failed":
      return entry.blockers?.[0] ? `Download failed: ${entry.blockers[0]}` : "Download failed"
    case "not-fit":
    case "host-unsupported":
    case "dependency-missing":
    case "disk-blocked":
    case "local-unusable":
      return entry.blockers?.[0]
    default:
      return undefined
  }
}

/**
 * modelID → annotation for every catalog entry that is present in the catalog
 * but whose weights are not usable locally. Ready/present models are omitted
 * so their picker description stays clean.
 */
export function axEngineModelStateAnnotations(
  entries: readonly AxEngineCatalogEntryState[],
  jobs: readonly AxEngineCatalogJobState[] = [],
): Map<string, string> {
  return new Map(
    entries.flatMap((entry) => {
      if (entry.local?.present && entry.fit?.state !== "verification-required") return []
      const annotation = axEngineModelStateAnnotation(
        { state: entry.fit?.state, blockers: entry.fit?.blockers },
        activeCatalogJob(jobs, entry.id),
      )
      return annotation ? ([[entry.id, annotation]] as const) : []
    }),
  )
}
