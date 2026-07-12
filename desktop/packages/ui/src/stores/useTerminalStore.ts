import { create } from "zustand"
import { devtools, persist, createJSONStorage } from "zustand/middleware"

import { closeTerminal } from "@/lib/terminalApi"
import { normalizeProjectPath } from "@/lib/projectResolution"
import { isRecord } from "@/lib/record"
import { getSafeSessionStorage } from "@/stores/utils/safeStorage"

export interface TerminalChunk {
  id: number
  data: string
}

export type TerminalTabLifecycle = "idle" | "running" | "exited"

export type TerminalTab = {
  id: string
  terminalSessionId: string | null
  lifecycle: TerminalTabLifecycle
  label: string
  iconKey: string | null
  bufferChunks: TerminalChunk[]
  bufferLength: number
  isConnecting: boolean
  createdAt: number
  previewUrl: string | null
  previewAutoOpened: boolean
  previewUrlLocked: boolean
}

export type DirectoryTerminalState = {
  tabs: TerminalTab[]
  activeTabId: string | null
}

export type TerminalProjectActionRun = {
  key: string
  directory: string
  actionId: string
  tabId: string
  sessionId: string
  status: "running" | "waiting-for-preview" | "stopping"
}

interface TerminalStore {
  sessions: Map<string, DirectoryTerminalState>
  projectActionRuns: Record<string, TerminalProjectActionRun>
  nextChunkId: number
  nextTabId: number
  hasHydrated: boolean

  ensureDirectory: (directory: string) => void
  getDirectoryState: (directory: string) => DirectoryTerminalState | undefined
  getActiveTab: (directory: string) => TerminalTab | undefined

  createTab: (directory: string) => string
  setActiveTab: (directory: string, tabId: string) => void
  setTabLabel: (directory: string, tabId: string, label: string) => void
  setTabIconKey: (directory: string, tabId: string, iconKey: string | null) => void
  closeTab: (directory: string, tabId: string) => Promise<void>

  setTabSessionId: (
    directory: string,
    tabId: string,
    sessionId: string | null,
    options?: { lifecycle?: TerminalTabLifecycle; expectedSessionId?: string },
  ) => void
  setTabLifecycle: (directory: string, tabId: string, lifecycle: TerminalTabLifecycle) => void
  setConnecting: (directory: string, tabId: string, isConnecting: boolean) => void
  appendToBuffer: (directory: string, tabId: string, chunk: string, options?: { expectedSessionId?: string }) => boolean
  clearBuffer: (directory: string, tabId: string, options?: { expectedSessionId?: string }) => void
  setTabPreviewUrl: (
    directory: string,
    tabId: string,
    url: string | null,
    options?: { locked?: boolean; autoOpened?: boolean },
  ) => void
  markPreviewAutoOpened: (directory: string, tabId: string) => void
  setProjectActionRun: (run: TerminalProjectActionRun) => void
  updateProjectActionRunStatus: (runKey: string, status: TerminalProjectActionRun["status"]) => void
  removeProjectActionRun: (runKey: string) => void

  removeDirectory: (directory: string) => void
  clearAll: () => void
}

const TERMINAL_BUFFER_LIMIT = 1_000_000
const TERMINAL_STORE_NAME = "terminal-store"
// PTY session ids and lifecycle are server-ephemeral and must not be restored
// across app restarts (the utilityProcess server is gone). Persist only tab
// chrome; every restored tab starts idle and creates a fresh PTY when opened.
type PersistedTerminalTab = Pick<TerminalTab, "id" | "label" | "iconKey" | "createdAt">

type PersistedDirectoryTerminalState = {
  tabs: PersistedTerminalTab[]
  activeTabId: string | null
}

type PersistedTerminalStoreState = {
  sessions: Array<[string, PersistedDirectoryTerminalState]>
  nextTabId: number
}

const tabIdNumber = (tabId: string): number | null => {
  const match = /^tab-(\d+)$/.exec(tabId)
  if (!match) return null
  const num = Number(match[1])
  return Number.isFinite(num) ? num : null
}

function normalizeDirectory(dir: string): string {
  return normalizeProjectPath(dir) ?? ""
}

const createEmptyTab = (id: string, label: string): TerminalTab => ({
  id,
  terminalSessionId: null,
  lifecycle: "idle",
  label,
  iconKey: null,
  bufferChunks: [],
  bufferLength: 0,
  isConnecting: false,
  createdAt: Date.now(),
  previewUrl: null,
  previewAutoOpened: false,
  previewUrlLocked: false,
})

const createEmptyDirectoryState = (firstTab: TerminalTab): DirectoryTerminalState => ({
  tabs: [firstTab],
  activeTabId: firstTab.id,
})

const findTabIndex = (state: DirectoryTerminalState, tabId: string): number =>
  state.tabs.findIndex((t) => t.id === tabId)

export const useTerminalStore = create<TerminalStore>()(
  devtools(
    persist(
      (set, get) => ({
        sessions: new Map(),
        projectActionRuns: {},
        nextChunkId: 1,
        nextTabId: 1,
        hasHydrated: typeof window === "undefined",

        ensureDirectory: (directory: string) => {
          const key = normalizeDirectory(directory)
          if (!key) return

          set((state) => {
            if (state.sessions.has(key)) {
              return state
            }

            const newSessions = new Map(state.sessions)
            const tabId = `tab-${state.nextTabId}`
            const firstTab = createEmptyTab(tabId, "Terminal")
            newSessions.set(key, createEmptyDirectoryState(firstTab))

            return { sessions: newSessions, nextTabId: state.nextTabId + 1 }
          })
        },

        getDirectoryState: (directory: string) => {
          const key = normalizeDirectory(directory)
          return get().sessions.get(key)
        },

        getActiveTab: (directory: string) => {
          const key = normalizeDirectory(directory)
          const entry = get().sessions.get(key)
          if (!entry) return undefined
          const activeId = entry.activeTabId
          if (!activeId) return entry.tabs[0]
          return entry.tabs.find((t) => t.id === activeId) ?? entry.tabs[0]
        },

        createTab: (directory: string) => {
          const key = normalizeDirectory(directory)
          if (!key) {
            return "tab-invalid"
          }

          const tabId = `tab-${get().nextTabId}`

          set((state) => {
            const newSessions = new Map(state.sessions)
            const existing = newSessions.get(key)

            const nextTabId = state.nextTabId + 1
            const labelIndex = (existing?.tabs.length ?? 0) + 1
            const label = `Terminal ${labelIndex}`
            const tab = createEmptyTab(tabId, label)

            if (!existing) {
              newSessions.set(key, createEmptyDirectoryState(tab))
            } else {
              newSessions.set(key, {
                ...existing,
                tabs: [...existing.tabs, tab],
              })
            }

            return { sessions: newSessions, nextTabId }
          })

          return tabId
        },

        setActiveTab: (directory: string, tabId: string) => {
          const key = normalizeDirectory(directory)
          set((state) => {
            const newSessions = new Map(state.sessions)
            const existing = newSessions.get(key)
            if (!existing) {
              return state
            }
            if (existing.activeTabId === tabId) {
              return state
            }
            if (findTabIndex(existing, tabId) < 0) {
              return state
            }

            newSessions.set(key, { ...existing, activeTabId: tabId })
            return { sessions: newSessions }
          })
        },

        setTabLabel: (directory: string, tabId: string, label: string) => {
          const key = normalizeDirectory(directory)
          const normalizedLabel = label.trim()
          if (!normalizedLabel) {
            return
          }

          set((state) => {
            const newSessions = new Map(state.sessions)
            const existing = newSessions.get(key)
            if (!existing) {
              return state
            }

            const idx = findTabIndex(existing, tabId)
            if (idx < 0) {
              return state
            }

            if (existing.tabs[idx]?.label === normalizedLabel) {
              return state
            }

            const nextTabs = [...existing.tabs]
            nextTabs[idx] = {
              ...nextTabs[idx],
              label: normalizedLabel,
            }

            newSessions.set(key, {
              ...existing,
              tabs: nextTabs,
            })
            return { sessions: newSessions }
          })
        },

        setTabIconKey: (directory: string, tabId: string, iconKey: string | null) => {
          const key = normalizeDirectory(directory)
          set((state) => {
            const newSessions = new Map(state.sessions)
            const existing = newSessions.get(key)
            if (!existing) {
              return state
            }

            const idx = findTabIndex(existing, tabId)
            if (idx < 0) {
              return state
            }

            const normalizedIconKey = iconKey?.trim() || null
            if (existing.tabs[idx]?.iconKey === normalizedIconKey) {
              return state
            }

            const nextTabs = [...existing.tabs]
            nextTabs[idx] = {
              ...nextTabs[idx],
              iconKey: normalizedIconKey,
            }

            newSessions.set(key, {
              ...existing,
              tabs: nextTabs,
            })
            return { sessions: newSessions }
          })
        },

        closeTab: async (directory: string, tabId: string) => {
          const key = normalizeDirectory(directory)
          const entry = get().sessions.get(key)
          const tab = entry?.tabs.find((t) => t.id === tabId)
          const sessionId = tab?.terminalSessionId ?? null

          if (sessionId) {
            try {
              await closeTerminal(sessionId)
            } catch {
              // ignore
            }
          }

          set((state) => {
            const newSessions = new Map(state.sessions)
            const existing = newSessions.get(key)
            if (!existing) {
              return state
            }

            const idx = findTabIndex(existing, tabId)
            if (idx < 0) {
              return state
            }

            const nextTabs = existing.tabs.filter((t) => t.id !== tabId)
            const nextRuns = Object.fromEntries(
              Object.entries(state.projectActionRuns).filter(
                ([, run]) => !(run.directory === key && run.tabId === tabId),
              ),
            )
            const runsChanged = Object.keys(nextRuns).length !== Object.keys(state.projectActionRuns).length

            if (nextTabs.length === 0) {
              const newTabId = `tab-${state.nextTabId}`
              const newTab = createEmptyTab(newTabId, "Terminal")
              newSessions.set(key, createEmptyDirectoryState(newTab))
              return {
                sessions: newSessions,
                nextTabId: state.nextTabId + 1,
                ...(runsChanged ? { projectActionRuns: nextRuns } : {}),
              }
            }

            let nextActive = existing.activeTabId
            if (existing.activeTabId === tabId) {
              const fallback = nextTabs[Math.min(idx, nextTabs.length - 1)]
              nextActive = fallback?.id ?? nextTabs[0]?.id ?? null
            }

            newSessions.set(key, {
              ...existing,
              tabs: nextTabs,
              activeTabId: nextActive,
            })

            return {
              sessions: newSessions,
              ...(runsChanged ? { projectActionRuns: nextRuns } : {}),
            }
          })
        },

        setTabSessionId: (
          directory: string,
          tabId: string,
          sessionId: string | null,
          options?: { lifecycle?: TerminalTabLifecycle; expectedSessionId?: string },
        ) => {
          const key = normalizeDirectory(directory)
          set((state) => {
            const newSessions = new Map(state.sessions)
            const existing = newSessions.get(key)
            if (!existing) {
              return state
            }

            const idx = findTabIndex(existing, tabId)
            if (idx < 0) {
              return state
            }

            const tab = existing.tabs[idx]
            if (options?.expectedSessionId !== undefined && tab.terminalSessionId !== options.expectedSessionId) {
              return state
            }
            const shouldResetBuffer = sessionId !== null && tab.terminalSessionId !== sessionId

            const nextLifecycle =
              options?.lifecycle ?? (sessionId ? "running" : tab.terminalSessionId ? "exited" : tab.lifecycle)

            const nextTab: TerminalTab = {
              ...tab,
              terminalSessionId: sessionId,
              lifecycle: nextLifecycle,
              isConnecting: false,
              ...(shouldResetBuffer ? { bufferChunks: [], bufferLength: 0 } : {}),
            }

            const nextTabs = [...existing.tabs]
            nextTabs[idx] = nextTab
            newSessions.set(key, { ...existing, tabs: nextTabs })
            return { sessions: newSessions }
          })
        },

        setTabLifecycle: (directory: string, tabId: string, lifecycle: TerminalTabLifecycle) => {
          const key = normalizeDirectory(directory)
          set((state) => {
            const newSessions = new Map(state.sessions)
            const existing = newSessions.get(key)
            if (!existing) {
              return state
            }

            const idx = findTabIndex(existing, tabId)
            if (idx < 0) {
              return state
            }

            const nextTabs = [...existing.tabs]
            nextTabs[idx] = { ...nextTabs[idx], lifecycle, isConnecting: false }
            newSessions.set(key, { ...existing, tabs: nextTabs })
            return { sessions: newSessions }
          })
        },

        setConnecting: (directory: string, tabId: string, isConnecting: boolean) => {
          const key = normalizeDirectory(directory)
          set((state) => {
            const newSessions = new Map(state.sessions)
            const existing = newSessions.get(key)
            if (!existing) {
              return state
            }

            const idx = findTabIndex(existing, tabId)
            if (idx < 0) {
              return state
            }

            const nextTabs = [...existing.tabs]
            nextTabs[idx] = { ...nextTabs[idx], isConnecting }
            newSessions.set(key, { ...existing, tabs: nextTabs })
            return { sessions: newSessions }
          })
        },

        appendToBuffer: (directory: string, tabId: string, chunk: string, options?: { expectedSessionId?: string }) => {
          if (!chunk) {
            return false
          }

          const key = normalizeDirectory(directory)
          let appended = false
          set((state) => {
            const newSessions = new Map(state.sessions)
            const existing = newSessions.get(key)
            if (!existing) {
              return state
            }

            const idx = findTabIndex(existing, tabId)
            if (idx < 0) {
              return state
            }

            const tab = existing.tabs[idx]
            if (options?.expectedSessionId !== undefined && tab.terminalSessionId !== options.expectedSessionId) {
              return state
            }
            const chunkId = state.nextChunkId
            const chunkEntry: TerminalChunk = { id: chunkId, data: chunk }

            const bufferChunks = [...tab.bufferChunks, chunkEntry]
            let bufferLength = tab.bufferLength + chunk.length

            while (bufferLength > TERMINAL_BUFFER_LIMIT && bufferChunks.length > 1) {
              const removed = bufferChunks.shift()
              if (!removed) {
                break
              }
              bufferLength -= removed.data.length
            }

            const nextTabs = [...existing.tabs]
            nextTabs[idx] = {
              ...tab,
              bufferChunks,
              bufferLength,
            }
            newSessions.set(key, { ...existing, tabs: nextTabs })
            appended = true

            return { sessions: newSessions, nextChunkId: chunkId + 1 }
          })
          return appended
        },

        setTabPreviewUrl: (directory: string, tabId: string, url: string | null, options = {}) => {
          const key = normalizeDirectory(directory)
          set((state) => {
            const newSessions = new Map(state.sessions)
            const existing = newSessions.get(key)
            if (!existing) {
              return state
            }

            const idx = findTabIndex(existing, tabId)
            if (idx < 0) {
              return state
            }

            const tab = existing.tabs[idx]
            const nextPreviewAutoOpened = options.autoOpened ?? tab.previewAutoOpened
            const nextPreviewUrlLocked = options.locked ?? tab.previewUrlLocked
            if (
              tab.previewUrl === url &&
              tab.previewAutoOpened === nextPreviewAutoOpened &&
              tab.previewUrlLocked === nextPreviewUrlLocked
            ) {
              return state
            }

            const nextTabs = [...existing.tabs]
            nextTabs[idx] = {
              ...tab,
              previewUrl: url,
              previewAutoOpened: nextPreviewAutoOpened,
              previewUrlLocked: nextPreviewUrlLocked,
            }
            newSessions.set(key, { ...existing, tabs: nextTabs })
            return { sessions: newSessions }
          })
        },

        markPreviewAutoOpened: (directory: string, tabId: string) => {
          const key = normalizeDirectory(directory)
          set((state) => {
            const newSessions = new Map(state.sessions)
            const existing = newSessions.get(key)
            if (!existing) {
              return state
            }

            const idx = findTabIndex(existing, tabId)
            if (idx < 0) {
              return state
            }

            const tab = existing.tabs[idx]
            if (!tab.previewUrl || tab.previewAutoOpened) {
              return state
            }

            const nextTabs = [...existing.tabs]
            nextTabs[idx] = { ...tab, previewAutoOpened: true }
            newSessions.set(key, { ...existing, tabs: nextTabs })
            return { sessions: newSessions }
          })
        },

        setProjectActionRun: (run: TerminalProjectActionRun) => {
          set((state) => {
            const existing = state.projectActionRuns[run.key]
            if (
              existing &&
              existing.directory === run.directory &&
              existing.actionId === run.actionId &&
              existing.tabId === run.tabId &&
              existing.sessionId === run.sessionId &&
              existing.status === run.status
            ) {
              return state
            }
            return { projectActionRuns: { ...state.projectActionRuns, [run.key]: run } }
          })
        },

        updateProjectActionRunStatus: (runKey: string, status: TerminalProjectActionRun["status"]) => {
          set((state) => {
            const existing = state.projectActionRuns[runKey]
            if (!existing || existing.status === status) {
              return state
            }
            return {
              projectActionRuns: {
                ...state.projectActionRuns,
                [runKey]: { ...existing, status },
              },
            }
          })
        },

        removeProjectActionRun: (runKey: string) => {
          set((state) => {
            if (!state.projectActionRuns[runKey]) {
              return state
            }
            const next = { ...state.projectActionRuns }
            delete next[runKey]
            return { projectActionRuns: next }
          })
        },

        clearBuffer: (directory: string, tabId: string, options?: { expectedSessionId?: string }) => {
          const key = normalizeDirectory(directory)
          set((state) => {
            const newSessions = new Map(state.sessions)
            const existing = newSessions.get(key)
            if (!existing) {
              return state
            }

            const idx = findTabIndex(existing, tabId)
            if (idx < 0) {
              return state
            }

            if (
              options?.expectedSessionId !== undefined &&
              existing.tabs[idx]?.terminalSessionId !== options.expectedSessionId
            ) {
              return state
            }

            const nextTabs = [...existing.tabs]
            nextTabs[idx] = {
              ...nextTabs[idx],
              bufferChunks: [],
              bufferLength: 0,
            }
            newSessions.set(key, { ...existing, tabs: nextTabs })
            return { sessions: newSessions }
          })
        },

        removeDirectory: (directory: string) => {
          const key = normalizeDirectory(directory)
          set((state) => {
            const newSessions = new Map(state.sessions)
            newSessions.delete(key)
            const nextRuns = Object.fromEntries(
              Object.entries(state.projectActionRuns).filter(([, run]) => run.directory !== key),
            )
            return { sessions: newSessions, projectActionRuns: nextRuns }
          })
        },

        clearAll: () => {
          set({ sessions: new Map(), projectActionRuns: {}, nextChunkId: 1, nextTabId: 1 })
        },
      }),
      {
        name: TERMINAL_STORE_NAME,
        storage: createJSONStorage(() => getSafeSessionStorage()),
        partialize: (state): PersistedTerminalStoreState => ({
          sessions: Array.from(state.sessions.entries()).map(([directory, dirState]) => [
            directory,
            {
              activeTabId: dirState.activeTabId,
              tabs: dirState.tabs.map((tab) => ({
                id: tab.id,
                label: tab.label,
                iconKey: tab.iconKey,
                createdAt: tab.createdAt,
              })),
            },
          ]),
          nextTabId: state.nextTabId,
        }),
        merge: (persistedState, currentState) => {
          if (!isRecord(persistedState)) {
            return currentState
          }

          const rawSessions = Array.isArray(persistedState.sessions)
            ? (persistedState.sessions as PersistedTerminalStoreState["sessions"])
            : []

          const sessions = new Map<string, DirectoryTerminalState>()
          let maxTabNum = 0

          for (const entry of rawSessions) {
            if (!Array.isArray(entry) || entry.length !== 2) {
              continue
            }

            const [directory, rawState] = entry as [unknown, unknown]
            if (typeof directory !== "string" || !isRecord(rawState)) {
              continue
            }

            const rawTabs = Array.isArray(rawState.tabs) ? (rawState.tabs as unknown[]) : []
            const tabs: TerminalTab[] = []

            for (const rawTab of rawTabs) {
              if (!isRecord(rawTab)) {
                continue
              }

              const id = typeof rawTab.id === "string" ? rawTab.id : null
              if (!id) {
                continue
              }

              const num = tabIdNumber(id)
              if (num !== null) {
                maxTabNum = Math.max(maxTabNum, num)
              }

              tabs.push({
                id,
                label: typeof rawTab.label === "string" ? rawTab.label : "Terminal",
                iconKey: typeof rawTab.iconKey === "string" ? rawTab.iconKey : null,
                terminalSessionId: null,
                // Never restore server session ids or lifecycle from storage.
                // An exited marker without its PTY/output renders as a blank,
                // permanently stopped terminal after an app restart.
                lifecycle: "idle",
                createdAt: typeof rawTab.createdAt === "number" ? rawTab.createdAt : Date.now(),
                bufferChunks: [],
                bufferLength: 0,
                isConnecting: false,
                previewUrl: null,
                previewAutoOpened: false,
                previewUrlLocked: false,
              })
            }

            if (tabs.length === 0) {
              continue
            }

            const activeTabId = typeof rawState.activeTabId === "string" ? (rawState.activeTabId as string) : null
            const activeExists = activeTabId ? tabs.some((t) => t.id === activeTabId) : false

            sessions.set(directory, {
              tabs,
              activeTabId: activeExists ? activeTabId : tabs[0].id,
            })
          }

          const persistedNextTabId =
            typeof persistedState.nextTabId === "number" && Number.isFinite(persistedState.nextTabId)
              ? (persistedState.nextTabId as number)
              : 1

          const nextTabId = Math.max(currentState.nextTabId, persistedNextTabId, maxTabNum + 1)

          return {
            ...currentState,
            sessions,
            nextChunkId: 1,
            nextTabId,
            hasHydrated: true,
          }
        },
      },
    ),
  ),
)

// Ensure hydration completes even when no persisted state exists.
if (typeof window !== "undefined") {
  const persistApi = (
    useTerminalStore as unknown as {
      persist?: {
        hasHydrated?: () => boolean
        onFinishHydration?: (cb: () => void) => (() => void) | void
      }
    }
  ).persist

  const markHydrated = () => {
    if (!useTerminalStore.getState().hasHydrated) {
      useTerminalStore.setState({ hasHydrated: true })
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
