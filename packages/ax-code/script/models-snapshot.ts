import { RETIRED_PROVIDER_IDS } from "../src/provider/retired-providers"

export const LOCAL_PROVIDER_IDS = [
  "claude-code",
  "codex-cli",
  "grok-build-cli",
  "kimi-cli",
  "muse-cli",
  "minimax-cli",
  "ollama",
  "ax-studio",
] as const

export { RETIRED_PROVIDER_IDS }

export type ModelsSnapshot = Record<string, unknown>

export function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

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
  "muse-cli": {
    id: "muse-cli",
    name: "Muse Code CLI",
    env: [],
    npm: "cli",
    models: {
      "muse-cli": {
        id: "muse-cli",
        name: "Muse Code CLI",
        family: "muse",
        attachment: true,
        reasoning: false,
        tool_call: false,
        temperature: false,
        release_date: "2026-09-17",
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
        limit: {
          context: 1048576,
          output: 131072,
        },
        options: {},
        status: "active",
      },
    },
  },
  "minimax-cli": {
    id: "minimax-cli",
    name: "MiniMax Code CLI",
    env: [],
    npm: "cli",
    models: {
      "minimax-cli": {
        id: "minimax-cli",
        name: "MiniMax Code CLI",
        family: "minimax",
        attachment: true,
        reasoning: false,
        tool_call: false,
        temperature: false,
        release_date: "2026-09-17",
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
        limit: {
          context: 1048576,
          output: 512000,
        },
        options: {},
        status: "active",
      },
    },
  },
}

export function preserveLocalProviders(fetched: ModelsSnapshot, existing: ModelsSnapshot) {
  const next = { ...fetched }
  for (const id of RETIRED_PROVIDER_IDS) {
    delete next[id]
  }
  for (const id of LOCAL_PROVIDER_IDS) {
    if (existing[id] && !next[id]) next[id] = cloneJsonValue(existing[id])
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
  const museCli = next["muse-cli"] as { models?: Record<string, unknown> } | undefined
  const museCliDefault = LOCAL_PROVIDER_DEFAULTS["muse-cli"] as { models: Record<string, unknown> }
  if (museCli && !museCli.models?.["muse-cli"]) {
    museCli.models = {
      ...(museCli.models ?? {}),
      "muse-cli": museCliDefault.models["muse-cli"],
    }
  }
  const minimaxCli = next["minimax-cli"] as { models?: Record<string, unknown> } | undefined
  const minimaxCliDefault = LOCAL_PROVIDER_DEFAULTS["minimax-cli"] as { models: Record<string, unknown> }
  if (minimaxCli && !minimaxCli.models?.["minimax-cli"]) {
    minimaxCli.models = {
      ...(minimaxCli.models ?? {}),
      "minimax-cli": minimaxCliDefault.models["minimax-cli"],
    }
  }
  return next
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeJson(entry)]),
  )
}

function orderJsonLike(value: unknown, existing: unknown): unknown {
  if (Array.isArray(value))
    return value.map((entry, index) => orderJsonLike(entry, Array.isArray(existing) ? existing[index] : undefined))
  if (!value || typeof value !== "object") return value
  const next = value as Record<string, unknown>
  const previous =
    existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {}
  const keys = [
    ...Object.keys(previous).filter((key) => key in next),
    ...Object.keys(next)
      .filter((key) => !(key in previous))
      .sort((left, right) => left.localeCompare(right)),
  ]
  return Object.fromEntries(keys.map((key) => [key, orderJsonLike(next[key], previous[key])]))
}

export function formatModelsSnapshot(snapshot: ModelsSnapshot, existing: ModelsSnapshot = {}) {
  return JSON.stringify(orderJsonLike(snapshot, existing), null, 2) + "\n"
}

function modelsSnapshotKey(snapshot: ModelsSnapshot) {
  return JSON.stringify(canonicalizeJson(snapshot))
}

export function modelsSnapshotChanged(existing: ModelsSnapshot, next: ModelsSnapshot) {
  return modelsSnapshotKey(existing) !== modelsSnapshotKey(next)
}
