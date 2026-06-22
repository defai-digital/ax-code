import { create } from "zustand"
import { devtools } from "zustand/middleware"
import { axCodeClient, type ProjectFileSearchHit } from "@/lib/ax-code/client"
import { searchFilesNative, isElectronShell, isTauriShell, recordDesktopStartupEvent } from "@/lib/desktop"

const CACHE_TTL_MS = 30_000
const MAX_CACHE_ENTRIES = 40
const DEFAULT_SEARCH_LIMIT = 60

interface FileSearchCacheEntry {
  files: ProjectFileSearchHit[]
  timestamp: number
}

interface FileSearchStoreState {
  cache: Record<string, FileSearchCacheEntry>
  cacheKeys: string[]
  inFlight: Record<string, Promise<ProjectFileSearchHit[]>>
  searchFiles: (
    directory: string,
    query: string,
    limit?: number,
    options?: { includeHidden?: boolean; respectGitignore?: boolean; type?: "file" | "directory" },
  ) => Promise<ProjectFileSearchHit[]>
  invalidateDirectory: (directory?: string | null) => void
}

const buildCacheKey = (
  directory: string,
  query: string,
  limit: number,
  includeHidden: boolean,
  respectGitignore: boolean,
  type: "file" | "directory",
) => {
  const normalizedDirectory = directory.trim()
  const normalizedQuery = query.trim().toLowerCase()
  return JSON.stringify([normalizedDirectory, normalizedQuery, limit, includeHidden, respectGitignore, type])
}

const cacheKeyMatchesDirectory = (cacheKey: string, directory: string) => {
  try {
    const value: unknown = JSON.parse(cacheKey)
    return Array.isArray(value) && value[0] === directory
  } catch {
    return false
  }
}

const canUseNativeFileSearch = (): boolean => isTauriShell() && !isElectronShell()
let firstFileSearchResultRecorded = false

export const useFileSearchStore = create<FileSearchStoreState>()(
  devtools(
    (set, get) => ({
      cache: {},
      cacheKeys: [],
      inFlight: {},
      async searchFiles(directory, query, limit = DEFAULT_SEARCH_LIMIT, options) {
        if (!directory || directory.trim().length === 0) {
          return []
        }

        const normalizedDirectory = directory.trim()
        const normalizedQuery = typeof query === "string" ? query.trim() : ""
        const includeHidden = Boolean(options?.includeHidden)
        const respectGitignore = options?.respectGitignore ?? true
        const type = options?.type === "directory" ? "directory" : "file"
        const key = buildCacheKey(normalizedDirectory, normalizedQuery, limit, includeHidden, respectGitignore, type)
        const now = Date.now()
        const cached = get().cache[key]

        if (cached && now - cached.timestamp < CACHE_TTL_MS) {
          return cached.files
        }

        const inflight = get().inFlight[key]
        if (inflight) {
          return inflight
        }

        // File-only queries may use the legacy Tauri native command. Electron
        // exposes a Tauri-compatible IPC shim but does not register this
        // command, so keep Electron on the AX Code find.files path.
        const searchStartedAt = Date.now()
        const fetchFiles: Promise<ProjectFileSearchHit[]> =
          type === "file" && canUseNativeFileSearch()
            ? searchFilesNative(normalizedDirectory, normalizedQuery, { limit, includeHidden, respectGitignore }).then(
                (native) =>
                  native ??
                  axCodeClient.searchFiles(normalizedQuery, {
                    directory: normalizedDirectory,
                    limit,
                    includeHidden,
                    respectGitignore,
                    dirs: false,
                    type,
                  }),
              )
            : axCodeClient.searchFiles(normalizedQuery, {
                directory: normalizedDirectory,
                limit,
                includeHidden,
                respectGitignore,
                dirs: type !== "file",
                type,
              })

        const searchPromise = fetchFiles
          .then((files) => {
            if (!firstFileSearchResultRecorded && files.length > 0) {
              firstFileSearchResultRecorded = true
              void recordDesktopStartupEvent("search.first_file_result", {
                count: files.length,
                type,
                limit,
                durationMs: Math.max(0, Date.now() - searchStartedAt),
              })
            }
            set((state) => {
              if (state.inFlight[key] !== searchPromise) {
                return state
              }

              const nextCache = { ...state.cache, [key]: { files, timestamp: Date.now() } }
              const nextKeys = state.cacheKeys.filter((cacheKey) => cacheKey !== key)
              nextKeys.push(key)

              while (nextKeys.length > MAX_CACHE_ENTRIES) {
                const oldestKey = nextKeys.shift()
                if (oldestKey) {
                  delete nextCache[oldestKey]
                }
              }

              return {
                cache: nextCache,
                cacheKeys: nextKeys,
              }
            })
            return files
          })
          .finally(() => {
            set((state) => {
              if (state.inFlight[key] !== searchPromise) {
                return state
              }

              const nextInFlight = { ...state.inFlight }
              delete nextInFlight[key]
              return { inFlight: nextInFlight }
            })
          })

        set((state) => ({
          inFlight: {
            ...state.inFlight,
            [key]: searchPromise,
          },
        }))

        return searchPromise
      },
      invalidateDirectory(directory) {
        if (!directory || directory.trim().length === 0) {
          set({ cache: {}, cacheKeys: [], inFlight: {} })
          return
        }

        const normalizedDirectory = directory.trim()

        set((state) => {
          const nextCache = { ...state.cache }
          const nextKeys = state.cacheKeys.filter((cacheKey) => {
            if (cacheKeyMatchesDirectory(cacheKey, normalizedDirectory)) {
              delete nextCache[cacheKey]
              return false
            }
            return true
          })

          const nextInFlightEntries = Object.entries(state.inFlight).filter(
            ([key]) => !cacheKeyMatchesDirectory(key, normalizedDirectory),
          )
          const nextInFlight = Object.fromEntries(nextInFlightEntries)

          return {
            cache: nextCache,
            cacheKeys: nextKeys,
            inFlight: nextInFlight,
          }
        })
      },
    }),
    {
      name: "file-search-store",
    },
  ),
)
