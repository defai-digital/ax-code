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

/**
 * Short picker description for a model that cannot serve a chat turn yet.
 * Returns undefined for states that need no annotation (ready, or unknown
 * states the picker should not guess at).
 */
export function axEngineModelStateAnnotation(entry: {
  state?: string
  blockers?: readonly string[]
}): string | undefined {
  switch (entry.state) {
    case "downloadable":
      return "Not downloaded"
    case "downloading":
      return "Downloading…"
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
export function axEngineModelStateAnnotations(entries: readonly AxEngineCatalogEntryState[]): Map<string, string> {
  return new Map(
    entries.flatMap((entry) => {
      if (entry.local?.present) return []
      const annotation = axEngineModelStateAnnotation({ state: entry.fit?.state, blockers: entry.fit?.blockers })
      return annotation ? ([[entry.id, annotation]] as const) : []
    }),
  )
}
