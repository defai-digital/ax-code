/**
 * Selection Store — per-session model, agent, and variant selections.
 * Extracted from session-ui-store for subscription isolation.
 */

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { getSafeStorage } from "@/stores/utils/safeStorage"
import type { LastUsedProviderSelection, SessionModelSelection } from "@/stores/types/selectionTypes"

type AgentModelSelectionEntries = [string, [string, SessionModelSelection][]][]
type PersistedSelectionState = {
  sessionModelSelections?: [string, SessionModelSelection][]
  sessionAgentSelections?: [string, string][]
  sessionAgentModelSelections?: AgentModelSelectionEntries
  lastUsedProvider?: LastUsedProviderSelection | null
}

type LegacyContextPersistedState = {
  sessionModelSelections?: [string, SessionModelSelection][]
  sessionAgentSelections?: [string, string][]
  sessionAgentModelSelections?: AgentModelSelectionEntries
}

export type SelectionState = {
  sessionModelSelections: Map<string, SessionModelSelection>
  sessionAgentSelections: Map<string, string>
  sessionAgentModelSelections: Map<string, Map<string, SessionModelSelection>>
  lastUsedProvider: LastUsedProviderSelection | null
  hasHydrated: boolean

  saveSessionModelSelection: (sessionId: string, providerId: string, modelId: string) => void
  getSessionModelSelection: (sessionId: string) => SessionModelSelection | null
  saveSessionAgentSelection: (sessionId: string, agentName: string) => void
  getSessionAgentSelection: (sessionId: string) => string | null
  saveAgentModelForSession: (sessionId: string, agentName: string, providerId: string, modelId: string) => void
  getAgentModelForSession: (sessionId: string, agentName: string) => SessionModelSelection | null
  saveAgentModelVariantForSession: (sessionId: string, agentName: string, providerId: string, modelId: string, variant: string | undefined) => void
  getAgentModelVariantForSession: (sessionId: string, agentName: string, providerId: string, modelId: string) => string | undefined
}

const isPersistedSelectionState = (state: unknown): state is PersistedSelectionState => (
  typeof state === "object" && state !== null
)

const isLegacyContextPersistedState = (state: unknown): state is LegacyContextPersistedState => (
  typeof state === "object" && state !== null
)

const readLegacyContextStoreState = (): LegacyContextPersistedState | undefined => {
  if (typeof window === "undefined") {
    return undefined
  }

  try {
    const raw = getSafeStorage().getItem("context-store")
    if (!raw) {
      return undefined
    }

    const parsed = JSON.parse(raw) as { state?: unknown }
    return isLegacyContextPersistedState(parsed.state) ? parsed.state : undefined
  } catch {
    return undefined
  }
}

const mergeEntries = <T>(primary: [string, T][] | undefined, legacy: [string, T][] | undefined): [string, T][] => {
  const merged = new Map<string, T>()
  if (Array.isArray(legacy)) {
    legacy.forEach(([key, value]) => merged.set(key, value))
  }
  if (Array.isArray(primary)) {
    primary.forEach(([key, value]) => merged.set(key, value))
  }
  return Array.from(merged.entries())
}

const mergeAgentModelEntries = (
  primary: AgentModelSelectionEntries | undefined,
  legacy: AgentModelSelectionEntries | undefined,
): AgentModelSelectionEntries => {
  const merged = new Map<string, Map<string, SessionModelSelection>>()
  if (Array.isArray(legacy)) {
    legacy.forEach(([sessionId, agentArray]) => {
      merged.set(sessionId, new Map(agentArray))
    })
  }
  if (Array.isArray(primary)) {
    primary.forEach(([sessionId, agentArray]) => {
      const agentMap = new Map(merged.get(sessionId) ?? new Map<string, SessionModelSelection>())
      agentArray.forEach(([agentName, selection]) => agentMap.set(agentName, selection))
      merged.set(sessionId, agentMap)
    })
  }
  return Array.from(merged.entries()).map(([sessionId, agentMap]) => [sessionId, Array.from(agentMap.entries())])
}

const deriveLastUsedProvider = (
  persisted: PersistedSelectionState | undefined,
  sessionModelSelections: [string, SessionModelSelection][],
): LastUsedProviderSelection | null => {
  if (persisted?.lastUsedProvider) {
    return persisted.lastUsedProvider
  }

  const lastSelection = sessionModelSelections[sessionModelSelections.length - 1]?.[1]
  return lastSelection ? { providerID: lastSelection.providerId, modelID: lastSelection.modelId } : null
}

export const mergePersistedSelectionState = (
  persistedState: unknown,
  legacyState: unknown,
) => {
  const persisted = isPersistedSelectionState(persistedState) ? persistedState : undefined
  const legacy = isLegacyContextPersistedState(legacyState) ? legacyState : undefined
  const sessionModelSelections = mergeEntries(persisted?.sessionModelSelections, legacy?.sessionModelSelections)
  const sessionAgentSelections = mergeEntries(persisted?.sessionAgentSelections, legacy?.sessionAgentSelections)
  const sessionAgentModelSelections = mergeAgentModelEntries(
    persisted?.sessionAgentModelSelections,
    legacy?.sessionAgentModelSelections,
  )

  return {
    lastUsedProvider: deriveLastUsedProvider(persisted, sessionModelSelections),
    sessionModelSelections,
    sessionAgentSelections,
    sessionAgentModelSelections,
  }
}

// In-memory variant storage (not persisted)
const agentModelVariantSelections = new Map<string, Map<string, Map<string, string>>>()

// Maximum number of sessions to persist to local storage to prevent unbounded growth
const MAX_PERSISTED_SESSIONS = 150
let hydrationListenerAttached = false

export const useSelectionStore = create<SelectionState>()(
  persist(
    (set, get) => ({
      sessionModelSelections: new Map(),
      sessionAgentSelections: new Map(),
      sessionAgentModelSelections: new Map(),
      lastUsedProvider: null,
      hasHydrated: typeof window === "undefined",

      saveSessionModelSelection: (sessionId, providerId, modelId) =>
        set((s) => {
          const map = new Map(s.sessionModelSelections)
          map.delete(sessionId) // Delete first to ensure it moves to the end of insertion order (MRU)
          map.set(sessionId, { providerId, modelId })
          return { sessionModelSelections: map, lastUsedProvider: { providerID: providerId, modelID: modelId } }
        }),

      getSessionModelSelection: (sessionId) => get().sessionModelSelections.get(sessionId) ?? null,

      saveSessionAgentSelection: (sessionId, agentName) =>
        set((s) => {
          if (s.sessionAgentSelections.get(sessionId) === agentName) return s
          const map = new Map(s.sessionAgentSelections)
          map.delete(sessionId) // Delete first to ensure it moves to the end of insertion order (MRU)
          map.set(sessionId, agentName)
          return { sessionAgentSelections: map }
        }),

      getSessionAgentSelection: (sessionId) => get().sessionAgentSelections.get(sessionId) ?? null,

      saveAgentModelForSession: (sessionId, agentName, providerId, modelId) =>
        set((s) => {
          const existing = s.sessionAgentModelSelections.get(sessionId)?.get(agentName)
          if (existing?.providerId === providerId && existing?.modelId === modelId) return s
          const outer = new Map(s.sessionAgentModelSelections)
          const inner = new Map(outer.get(sessionId) ?? new Map())

          outer.delete(sessionId) // Delete first to ensure it moves to the end of insertion order (MRU)
          inner.set(agentName, { providerId, modelId })
          outer.set(sessionId, inner)

          return { sessionAgentModelSelections: outer }
        }),

      getAgentModelForSession: (sessionId, agentName) =>
        get().sessionAgentModelSelections.get(sessionId)?.get(agentName) ?? null,

      saveAgentModelVariantForSession: (sessionId, agentName, providerId, modelId, variant) => {
        const key = `${providerId}/${modelId}`
        let agentMap = agentModelVariantSelections.get(sessionId)
        if (!agentMap && variant) {
          agentMap = new Map()
          agentModelVariantSelections.set(sessionId, agentMap)
        }
        if (!agentMap) return
        let modelMap = agentMap.get(agentName)
        if (!modelMap && variant) {
          modelMap = new Map()
          agentMap.set(agentName, modelMap)
        }
        if (!modelMap) return

        if (!variant) {
          modelMap.delete(key)
          if (modelMap.size === 0) {
            agentMap.delete(agentName)
          }
          if (agentMap.size === 0) {
            agentModelVariantSelections.delete(sessionId)
          }
          return
        }

        modelMap.set(key, variant)
      },

      getAgentModelVariantForSession: (sessionId, agentName, providerId, modelId) => {
        const key = `${providerId}/${modelId}`
        return agentModelVariantSelections.get(sessionId)?.get(agentName)?.get(key)
      },
    }),
    {
      name: "selection-store",
      version: 1,
      storage: createJSONStorage(() => getSafeStorage()),
      partialize: (state) => {
        // Convert Maps to arrays and slice to keep only the most recent MAX_PERSISTED_SESSIONS
        const models = Array.from(state.sessionModelSelections.entries()).slice(-MAX_PERSISTED_SESSIONS)
        const agents = Array.from(state.sessionAgentSelections.entries()).slice(-MAX_PERSISTED_SESSIONS)
        const agentModels = Array.from(state.sessionAgentModelSelections.entries())
          .slice(-MAX_PERSISTED_SESSIONS)
          .map(([sessionId, agentMap]) => [sessionId, Array.from(agentMap.entries())])

        return {
          sessionModelSelections: models,
          sessionAgentSelections: agents,
          sessionAgentModelSelections: agentModels,
          lastUsedProvider: state.lastUsedProvider,
        }
      },
      merge: (persistedState: unknown, currentState) => {
        const merged = mergePersistedSelectionState(persistedState, readLegacyContextStoreState())
        const agentModelSelections = new Map<string, Map<string, SessionModelSelection>>()
        if (Array.isArray(merged.sessionAgentModelSelections)) {
          merged.sessionAgentModelSelections.forEach(([sessionId, agentArray]) => {
            agentModelSelections.set(sessionId, new Map(agentArray))
          })
        }

        return {
          ...currentState,
          lastUsedProvider: merged.lastUsedProvider,
          sessionModelSelections: new Map(merged.sessionModelSelections),
          sessionAgentSelections: new Map(merged.sessionAgentSelections),
          sessionAgentModelSelections: agentModelSelections,
          hasHydrated: true,
        }
      },
      migrate: (persistedState: unknown) => {
        // Scaffold for future schema migrations
        return persistedState
      }
    }
  )
)

// Ensure hydration completes even when no persisted state exists.
if (typeof window !== "undefined" && !hydrationListenerAttached) {
  hydrationListenerAttached = true
  const persistApi = (
    useSelectionStore as unknown as {
      persist?: {
        hasHydrated?: () => boolean
        onFinishHydration?: (cb: () => void) => (() => void) | void
      }
    }
  ).persist

  const markHydrated = () => {
    if (!useSelectionStore.getState().hasHydrated) {
      useSelectionStore.setState({ hasHydrated: true })
    }
  }

  if (persistApi?.hasHydrated?.()) {
    markHydrated()
  } else if (persistApi?.onFinishHydration) {
    persistApi.onFinishHydration(markHydrated)
  } else {
    markHydrated()
  }
}
