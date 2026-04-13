export const LOCAL_PROVIDER_IDS = ["claude-code", "gemini-cli", "codex-cli", "ollama", "ax-studio"] as const

export type ModelsSnapshot = Record<string, unknown>

export function preserveLocalProviders(fetched: ModelsSnapshot, existing: ModelsSnapshot) {
  const next = { ...fetched }
  for (const id of LOCAL_PROVIDER_IDS) {
    if (existing[id] && !next[id]) next[id] = existing[id]
  }
  return next
}

export function formatModelsSnapshot(snapshot: ModelsSnapshot) {
  return JSON.stringify(snapshot, null, 2) + "\n"
}

export function modelsSnapshotChanged(existing: ModelsSnapshot, next: ModelsSnapshot) {
  return JSON.stringify(existing) !== JSON.stringify(next)
}
