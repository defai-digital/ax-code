import { create } from "zustand"
import { devtools } from "zustand/middleware"
import type { SessionRollbackPoint } from "@ax-code/sdk/v2"
import { axCodeClient } from "@/lib/ax-code/client"
import { normalizeProjectPath } from "@/lib/projectResolution"
import { useDirectoryStore } from "@/stores/useDirectoryStore"

const EMPTY_POINTS: SessionRollbackPoint[] = []

const normalizeDirectory = (directory: string | null | undefined): string | null => normalizeProjectPath(directory)

const directoryKey = (directory: string | null | undefined): string => normalizeDirectory(directory) ?? "__global__"

const cacheKey = (sessionId: string, tool?: string | null): string => `${sessionId}\u0000${tool?.trim() ?? ""}`

const getRollbackClient = (directory: string | null | undefined) => {
  const normalized = normalizeDirectory(directory)
  if (!normalized) return axCodeClient.getApiClient()
  return axCodeClient.getScopedApiClient(normalized)
}

type RefreshRollbackOptions = {
  directory?: string | null
  tool?: string | null
  silent?: boolean
}

interface SessionRollbackStore {
  pointsByDirectory: Record<string, Record<string, SessionRollbackPoint[]>>
  loadingKeys: Record<string, boolean>
  errorKeys: Record<string, string | null>

  getPoints: (sessionId: string, options?: Pick<RefreshRollbackOptions, "directory" | "tool">) => SessionRollbackPoint[]
  getError: (sessionId: string, options?: Pick<RefreshRollbackOptions, "directory" | "tool">) => string | null
  isLoading: (sessionId: string, options?: Pick<RefreshRollbackOptions, "directory" | "tool">) => boolean
  refreshPoints: (sessionId: string, options?: RefreshRollbackOptions) => Promise<SessionRollbackPoint[]>
  clearSession: (sessionId: string, directory?: string | null) => void
}

const rollbackRefreshRequestIds = new Map<string, number>()
let rollbackRefreshSequence = 0

const requestKey = (directory: string | null | undefined, sessionId: string, tool?: string | null): string =>
  `${directoryKey(directory)}:${cacheKey(sessionId, tool)}`

export const useSessionRollbackStore = create<SessionRollbackStore>()(
  devtools((set, get) => ({
    pointsByDirectory: {},
    loadingKeys: {},
    errorKeys: {},

    getPoints: (sessionId, options) => {
      const directory = normalizeDirectory(options?.directory ?? useDirectoryStore.getState().currentDirectory)
      return get().pointsByDirectory[directoryKey(directory)]?.[cacheKey(sessionId, options?.tool)] ?? EMPTY_POINTS
    },

    getError: (sessionId, options) => {
      const directory = normalizeDirectory(options?.directory ?? useDirectoryStore.getState().currentDirectory)
      return get().errorKeys[requestKey(directory, sessionId, options?.tool)] ?? null
    },

    isLoading: (sessionId, options) => {
      const directory = normalizeDirectory(options?.directory ?? useDirectoryStore.getState().currentDirectory)
      return Boolean(get().loadingKeys[requestKey(directory, sessionId, options?.tool)])
    },

    refreshPoints: async (sessionId, options) => {
      const directory = normalizeDirectory(options?.directory ?? useDirectoryStore.getState().currentDirectory)
      const tool = options?.tool?.trim() || undefined
      const dirKey = directoryKey(directory)
      const entryKey = cacheKey(sessionId, tool)
      const reqKey = requestKey(directory, sessionId, tool)
      const requestId = ++rollbackRefreshSequence
      rollbackRefreshRequestIds.set(reqKey, requestId)
      const isCurrentRefresh = () => rollbackRefreshRequestIds.get(reqKey) === requestId

      if (!options?.silent) {
        set((state) => ({
          loadingKeys: { ...state.loadingKeys, [reqKey]: true },
          errorKeys: { ...state.errorKeys, [reqKey]: null },
        }))
      }

      try {
        const client = getRollbackClient(directory)
        const result = await client.session.rollbackPoints(
          { sessionID: sessionId, directory: directory ?? undefined, tool },
          { throwOnError: true },
        )
        const points = result.data ?? []

        if (!isCurrentRefresh()) {
          return get().pointsByDirectory[dirKey]?.[entryKey] ?? EMPTY_POINTS
        }

        set((state) => ({
          pointsByDirectory: {
            ...state.pointsByDirectory,
            [dirKey]: {
              ...(state.pointsByDirectory[dirKey] ?? {}),
              [entryKey]: points,
            },
          },
          loadingKeys: { ...state.loadingKeys, [reqKey]: false },
          errorKeys: { ...state.errorKeys, [reqKey]: null },
        }))
        return points
      } catch (error) {
        if (!isCurrentRefresh()) {
          return get().pointsByDirectory[dirKey]?.[entryKey] ?? EMPTY_POINTS
        }
        const message = error instanceof Error ? error.message : "Failed to load rollback points"
        set((state) => ({
          loadingKeys: { ...state.loadingKeys, [reqKey]: false },
          errorKeys: { ...state.errorKeys, [reqKey]: message },
        }))
        throw error
      } finally {
        if (isCurrentRefresh()) {
          rollbackRefreshRequestIds.delete(reqKey)
        }
      }
    },

    clearSession: (sessionId, directory) => {
      const dirKey = directoryKey(directory ?? useDirectoryStore.getState().currentDirectory)
      set((state) => {
        const nextDirectoryPoints = { ...(state.pointsByDirectory[dirKey] ?? {}) }
        for (const key of Object.keys(nextDirectoryPoints)) {
          if (key === cacheKey(sessionId) || key.startsWith(`${sessionId}\u0000`)) {
            delete nextDirectoryPoints[key]
          }
        }
        return {
          pointsByDirectory: {
            ...state.pointsByDirectory,
            [dirKey]: nextDirectoryPoints,
          },
        }
      })
    },
  })),
)
