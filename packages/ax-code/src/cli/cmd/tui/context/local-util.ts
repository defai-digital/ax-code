import {
  isProviderModelKeyInput,
  providerModelKey,
  providerModelList,
  type ProviderModelKeyInput,
} from "@/provider/model-key"
import { modelSelectableForProvider, sameSkuOnConnectedProvider } from "@/provider/model-selectability"

export const RECENT_MODEL_LIMIT = 5
export const SESSION_MODEL_LIMIT = 150

export type ModelPreferenceStatus = "valid" | "invalid" | "unknown"

export function modelPreferenceStatus(
  providers: readonly {
    id: string
    models: Record<string, Parameters<typeof modelSelectableForProvider>[1]>
  }[],
  model: ProviderModelKeyInput,
): ModelPreferenceStatus {
  const provider = providers.find((item) => item.id === model.providerID)
  if (!provider) return "invalid"
  const info = provider.models[model.modelID]
  if (!info) return "unknown"
  return modelSelectableForProvider(model.providerID, info) ? "valid" : "invalid"
}

/**
 * A configured or agent-pinned model resolved against the connected
 * providers: the pin itself when valid, else the same SKU on another
 * connected provider (the native provider was disabled after the model moved
 * behind a custom gateway), else undefined.
 */
export function resolvePinnedModelPreference(
  providers: readonly {
    id: string
    models: Record<string, Parameters<typeof modelSelectableForProvider>[1]>
  }[],
  model: ProviderModelKeyInput,
): ProviderModelKeyInput | undefined {
  if (modelPreferenceStatus(providers, model) === "valid") return model
  return sameSkuOnConnectedProvider(providers, model)
}

export type ModelPreferenceStore = {
  model: Record<string, ProviderModelKeyInput>
  recent: ProviderModelKeyInput[]
  favorite: ProviderModelKeyInput[]
  variant: Record<string, string | undefined>
}

export type SessionModelPreference = {
  model?: ProviderModelKeyInput
  agents: Record<string, ProviderModelKeyInput>
}

export type SessionModelPreferenceStore = Record<string, SessionModelPreference>

export function resolveCurrentAgent<
  T extends { name: string; displayName?: string; model?: unknown } = {
    name: string
    displayName?: string
    model?: unknown
  },
>(agents: T[], current: string): T {
  const match = agents.find((x) => x.name === current)
  if (match) return match
  const first = agents[0]
  if (first) return first
  return {
    name: current,
    displayName: "Agent",
    model: undefined,
  } as T
}

export function normalizeModelVariantStore(input: unknown): Record<string, string | undefined> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string | undefined] => entry[1] === undefined || typeof entry[1] === "string",
    ),
  )
}

export function modelIdentity(model: ProviderModelKeyInput) {
  return { providerID: model.providerID, modelID: model.modelID }
}

export function normalizeRecentModels(input: unknown): ProviderModelKeyInput[] {
  return providerModelList(input).slice(0, RECENT_MODEL_LIMIT).map(modelIdentity)
}

export function normalizeModelOverrides(input: unknown): Record<string, ProviderModelKeyInput> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, ProviderModelKeyInput] => {
      const [key, value] = entry
      return typeof key === "string" && key.length > 0 && isProviderModelKeyInput(value)
    }),
  )
}

export function normalizeSessionModelPreferences(input: unknown): SessionModelPreferenceStore {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  const entries: [string, SessionModelPreference][] = []
  for (const [sessionID, value] of Object.entries(input)) {
    if (!sessionID || !value || typeof value !== "object" || Array.isArray(value)) continue
    const record = value as { model?: unknown; agents?: unknown }
    const model = isProviderModelKeyInput(record.model) ? modelIdentity(record.model) : undefined
    const agents = Object.fromEntries(
      Object.entries(normalizeModelOverrides(record.agents)).map(([agentName, selection]) => [
        agentName,
        modelIdentity(selection),
      ]),
    )
    if (!model && Object.keys(agents).length === 0) continue
    entries.push([sessionID, { model, agents }])
  }
  return Object.fromEntries(entries.slice(-SESSION_MODEL_LIMIT))
}

export function sessionModelPreference(
  input: SessionModelPreferenceStore,
  sessionID: string | undefined,
  agentName: string,
): ProviderModelKeyInput | undefined {
  if (!sessionID) return undefined
  const entry = input[sessionID]
  return entry?.agents[agentName] ?? entry?.model
}

export function rememberSessionModelPreference(
  input: SessionModelPreferenceStore,
  sessionID: string,
  agentName: string | undefined,
  model: ProviderModelKeyInput,
): SessionModelPreferenceStore {
  if (!sessionID) return input
  const identity = modelIdentity(model)
  const current = input[sessionID]
  const agents = {
    ...(current?.agents ?? {}),
    ...(agentName ? { [agentName]: identity } : {}),
  }
  const currentModel = current?.model
  const currentAgentModel = agentName ? current?.agents[agentName] : undefined
  const unchanged =
    currentModel?.providerID === identity.providerID &&
    currentModel.modelID === identity.modelID &&
    (!agentName ||
      (currentAgentModel?.providerID === identity.providerID && currentAgentModel.modelID === identity.modelID))
  const keys = Object.keys(input)
  if (unchanged && keys[keys.length - 1] === sessionID) return input

  const next = { ...input }
  delete next[sessionID]
  next[sessionID] = { model: identity, agents }
  return Object.fromEntries(Object.entries(next).slice(-SESSION_MODEL_LIMIT))
}

export function hasSessionModelPreference(input: SessionModelPreferenceStore, sessionID: string | undefined): boolean {
  if (!sessionID) return false
  const entry = input[sessionID]
  if (!entry) return false
  return entry.model !== undefined || Object.keys(entry.agents).length > 0
}

export function shouldAdoptMessageModelFromHistory(sessionChanged: boolean, hasSessionPreference: boolean): boolean {
  return !sessionChanged || !hasSessionPreference
}

export function applyExplicitModelPreference(
  sessions: SessionModelPreferenceStore,
  global: Record<string, ProviderModelKeyInput>,
  sessionID: string | undefined,
  agentName: string,
  model: ProviderModelKeyInput,
): { sessions: SessionModelPreferenceStore; global: Record<string, ProviderModelKeyInput> } {
  if (sessionID) {
    return {
      sessions: rememberSessionModelPreference(sessions, sessionID, agentName, model),
      global,
    }
  }
  const identity = modelIdentity(model)
  const current = global[agentName]
  if (current?.providerID === identity.providerID && current.modelID === identity.modelID) {
    return { sessions, global }
  }
  return {
    sessions,
    global: { ...global, [agentName]: identity },
  }
}

export function rememberRecentModel(
  recent: readonly ProviderModelKeyInput[],
  model: ProviderModelKeyInput,
): ProviderModelKeyInput[] {
  const out: ProviderModelKeyInput[] = []
  const seen = new Set<string>()
  for (const item of [model, ...recent]) {
    const key = providerModelKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(modelIdentity(item))
    if (out.length === RECENT_MODEL_LIMIT) break
  }
  return out
}

function parseProviderModelKey(key: string): ProviderModelKeyInput | undefined {
  const idx = key.indexOf("/")
  if (idx <= 0 || idx === key.length - 1) return undefined
  return {
    providerID: key.slice(0, idx),
    modelID: key.slice(idx + 1),
  }
}

type ModelMigration = (model: ProviderModelKeyInput) => ProviderModelKeyInput | undefined

function keepOrMigrate(
  item: ProviderModelKeyInput,
  modelStatus: (model: ProviderModelKeyInput) => ModelPreferenceStatus,
  migrate?: ModelMigration,
): ProviderModelKeyInput | undefined {
  if (modelStatus(item) !== "invalid") return item
  const migrated = migrate?.(item)
  if (!migrated || modelStatus(migrated) === "invalid") return undefined
  return migrated
}

function filterKnownModels(
  input: readonly ProviderModelKeyInput[],
  modelStatus: (model: ProviderModelKeyInput) => ModelPreferenceStatus,
  limit?: number,
  migrate?: ModelMigration,
) {
  const out: ProviderModelKeyInput[] = []
  const seen = new Set<string>()
  for (const stored of providerModelList(input)) {
    const item = keepOrMigrate(stored, modelStatus, migrate)
    if (!item) continue
    const key = providerModelKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(modelIdentity(item))
    if (limit !== undefined && out.length === limit) break
  }
  return out
}

function sameModelList(left: readonly ProviderModelKeyInput[], right: readonly ProviderModelKeyInput[]) {
  if (left.length !== right.length) return false
  return left.every((item, index) => {
    const other = right[index]
    return other !== undefined && item.providerID === other.providerID && item.modelID === other.modelID
  })
}

function sameVariantStore(left: Record<string, string | undefined>, right: Record<string, string | undefined>) {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) return false
  return leftEntries.every(([key, value]) => right[key] === value)
}

function sameModelOverrides(left: Record<string, ProviderModelKeyInput>, right: Record<string, ProviderModelKeyInput>) {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) return false
  return leftEntries.every(([key, value]) => {
    const other = right[key]
    return other !== undefined && value.providerID === other.providerID && value.modelID === other.modelID
  })
}

function sameSessionModelPreferences(left: SessionModelPreferenceStore, right: SessionModelPreferenceStore) {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) return false
  return leftEntries.every(([sessionID, value], index) => {
    const otherEntry = rightEntries[index]
    if (!otherEntry || otherEntry[0] !== sessionID) return false
    const other = otherEntry[1]
    const sameModel =
      value.model === undefined
        ? other.model === undefined
        : other.model !== undefined &&
          value.model.providerID === other.model.providerID &&
          value.model.modelID === other.model.modelID
    return sameModel && sameModelOverrides(value.agents, other.agents)
  })
}

/** Solid stores merge objects. Missing keys must be set to `undefined` to delete them. */
export function solidStoreRecordPatch<T>(
  current: Record<string, T>,
  next: Record<string, T>,
): Record<string, T | undefined> {
  const patch: Record<string, T | undefined> = { ...next }
  for (const key of Object.keys(current)) {
    if (!Object.hasOwn(next, key)) patch[key] = undefined
  }
  return patch
}

/**
 * Drop stored preferences that no longer resolve. When `migrate` is given,
 * an invalid entry is first mapped (typically to the same SKU on a connected
 * provider) and kept under its new identity instead of being deleted — the
 * user's per-agent choices survive moving a model behind a custom gateway.
 */
export function pruneModelPreferences(
  input: ModelPreferenceStore,
  modelStatus: (model: ProviderModelKeyInput) => ModelPreferenceStatus,
  variantStatus: (model: ProviderModelKeyInput, variant: string | undefined) => ModelPreferenceStatus = modelStatus,
  migrate?: ModelMigration,
): ModelPreferenceStore & { changed: boolean } {
  const model = Object.fromEntries(
    Object.entries(input.model).flatMap(([key, value]) => {
      const kept = keepOrMigrate(value, modelStatus, migrate)
      return kept ? [[key, modelIdentity(kept)] as const] : []
    }),
  )
  const recent = filterKnownModels(input.recent, modelStatus, RECENT_MODEL_LIMIT, migrate)
  const favorite = filterKnownModels(input.favorite, modelStatus, undefined, migrate)
  const variant: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(input.variant)) {
    const stored = parseProviderModelKey(key)
    if (!stored) continue
    const kept = keepOrMigrate(stored, modelStatus, migrate)
    if (!kept || variantStatus(kept, value) === "invalid") continue
    const nextKey = providerModelKey(kept)
    if (!Object.hasOwn(variant, nextKey)) variant[nextKey] = value
  }
  return {
    model,
    recent,
    favorite,
    variant,
    changed:
      !sameModelOverrides(input.model, model) ||
      !sameModelList(input.recent, recent) ||
      !sameModelList(input.favorite, favorite) ||
      !sameVariantStore(input.variant, variant),
  }
}

export function pruneSessionModelPreferences(
  input: SessionModelPreferenceStore,
  modelStatus: (model: ProviderModelKeyInput) => ModelPreferenceStatus,
  migrate?: ModelMigration,
): { value: SessionModelPreferenceStore; changed: boolean } {
  const output: SessionModelPreferenceStore = {}
  for (const [sessionID, value] of Object.entries(input).slice(-SESSION_MODEL_LIMIT)) {
    const model = value.model ? keepOrMigrate(value.model, modelStatus, migrate) : undefined
    const agents = Object.fromEntries(
      Object.entries(value.agents).flatMap(([agentName, selection]) => {
        const kept = keepOrMigrate(selection, modelStatus, migrate)
        return kept ? [[agentName, modelIdentity(kept)] as const] : []
      }),
    )
    if (!model && Object.keys(agents).length === 0) continue
    output[sessionID] = {
      model: model ? modelIdentity(model) : undefined,
      agents,
    }
  }
  return {
    value: output,
    changed: !sameSessionModelPreferences(input, output),
  }
}
