export const LOCAL_PROVIDER_IDS = [
  "claude-code",
  "gemini-cli",
  "codex-cli",
  "grok-build-cli",
  "ollama",
  "ax-studio",
] as const

export type ModelsSnapshot = Record<string, unknown>

const LOCAL_PROVIDER_DEFAULTS: ModelsSnapshot = {
  "grok-build-cli": {
    id: "grok-build-cli",
    name: "Grok Build CLI",
    env: [],
    npm: "cli",
    models: {
      "grok-build-cli": {
        id: "grok-build-cli",
        name: "Grok Build CLI",
        family: "grok",
        attachment: false,
        reasoning: false,
        tool_call: false,
        temperature: false,
        release_date: "2026-04-16",
        modalities: {
          input: ["text"],
          output: ["text"],
        },
        limit: {
          context: 256000,
          output: 10000,
        },
        options: {},
        status: "active",
      },
    },
  },
}

export function preserveLocalProviders(fetched: ModelsSnapshot, existing: ModelsSnapshot) {
  const next = { ...fetched }
  for (const id of LOCAL_PROVIDER_IDS) {
    if (existing[id] && !next[id]) next[id] = JSON.parse(JSON.stringify(existing[id]))
    if (!next[id] && LOCAL_PROVIDER_DEFAULTS[id]) next[id] = LOCAL_PROVIDER_DEFAULTS[id]
  }
  const grokBuildCli = next["grok-build-cli"] as { models?: Record<string, unknown> } | undefined
  const grokBuildCliDefault = LOCAL_PROVIDER_DEFAULTS["grok-build-cli"] as { models: Record<string, unknown> }
  if (grokBuildCli && !grokBuildCli.models?.["grok-build-cli"]) {
    grokBuildCli.models = {
      ...(grokBuildCli.models ?? {}),
      "grok-build-cli": grokBuildCliDefault.models["grok-build-cli"],
    }
  }
  return next
}

export function formatModelsSnapshot(snapshot: ModelsSnapshot) {
  return JSON.stringify(snapshot, null, 2) + "\n"
}

function modelsSnapshotKey(snapshot: ModelsSnapshot) {
  return JSON.stringify(snapshot)
}

export function modelsSnapshotChanged(existing: ModelsSnapshot, next: ModelsSnapshot) {
  return modelsSnapshotKey(existing) !== modelsSnapshotKey(next)
}
