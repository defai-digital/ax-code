import { create } from "zustand"
import { devtools } from "zustand/middleware"
import { axCodeClient } from "@/lib/ax-code/client"
import { getDesktopHomeDirectory } from "@/lib/desktop"
import { updateDesktopSettings } from "@/lib/persistence"
import { useFileSearchStore } from "@/stores/useFileSearchStore"
import { streamDebugEnabled } from "@/stores/utils/streamDebug"
import { getSafeStorage } from "./utils/safeStorage"

interface DirectoryNavigationStore {
  currentDirectory: string
  directoryHistory: string[]
  historyIndex: number
  homeDirectory: string
  hasPersistedDirectory: boolean
  isHomeReady: boolean
  isSwitchingDirectory: boolean

  setDirectory: (path: string, options?: { showOverlay?: boolean }) => void
  goBack: () => void
  goForward: () => void
  goToParent: () => void
  goHome: () => Promise<void>
  synchronizeHomeDirectory: (path: string) => void
}

let cachedHomeDirectory: string | null = null
const safeStorage = getSafeStorage()
const persistedLastDirectory = safeStorage.getItem("lastDirectory")
const initialHasPersistedDirectory = typeof persistedLastDirectory === "string" && persistedLastDirectory.length > 0

const invalidateFileSearchCache = (scope?: string | null) => {
  try {
    useFileSearchStore.getState().invalidateDirectory(scope)
  } catch (error) {
    console.warn("Failed to invalidate file search cache:", error)
  }
}

const normalizeDirectoryPath = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) {
    return trimmed
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/^([a-z]):/, (_, letter: string) => letter.toUpperCase() + ":")
  if (normalized.length > 1) {
    return normalized.replace(/\/+$/, "")
  }
  return normalized
}

const resolveTildePath = (path: string, homeDir?: string | null): string => {
  const trimmed = path.trim()
  if (!trimmed.startsWith("~")) {
    return trimmed
  }
  if (trimmed === "~") {
    return homeDir || trimmed
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return homeDir ? `${homeDir}${trimmed.slice(1)}` : trimmed
  }
  return trimmed
}

const resolveDirectoryPath = (path: string, homeDir?: string | null): string => {
  const expanded = resolveTildePath(path, homeDir)
  return normalizeDirectoryPath(expanded)
}

const getStoredHomeDirectory = (): string | null => {
  const raw = safeStorage.getItem("homeDirectory")
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null
  }
  const normalized = normalizeDirectoryPath(raw)
  return normalized.length > 0 ? normalized : null
}

const getStoredLastDirectory = (): string | null => {
  const raw = safeStorage.getItem("lastDirectory")
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null
  }
  const normalized = normalizeDirectoryPath(raw)
  return normalized.length > 0 ? normalized : null
}

const getProcessHomeDirectory = (): string | null => {
  if (typeof process === "undefined") {
    return null
  }

  const env = process?.env
  const nodeHome =
    env?.HOME || env?.USERPROFILE || (env?.HOMEDRIVE && env?.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}` : undefined)
  if (typeof nodeHome === "string" && nodeHome.trim().length > 0) {
    const normalized = normalizeDirectoryPath(nodeHome)
    return normalized.length > 0 ? normalized : null
  }

  const cwd = process?.cwd?.()
  if (typeof cwd === "string" && cwd.trim().length > 0) {
    const normalized = normalizeDirectoryPath(cwd)
    return normalized.length > 0 ? normalized : null
  }

  return null
}

const getHomeDirectory = () => {
  if (typeof window !== "undefined") {
    if (cachedHomeDirectory) return cachedHomeDirectory

    // Reject "/" (filesystem root) as a home candidate. The desktop shell or a
    // stale settings.json can report homeDirectory="/" before the real home is
    // resolved asynchronously; accepting it here makes every directory-scoped
    // request fire with directory=/, which the server rejects with 400
    // ("Directory is not allowed") — breaking the Providers panel, fs, project,
    // and skills endpoints. normalizeHomeCandidate already treats "/" as invalid;
    // mirror that so async home resolution can seed a real path instead.
    const desktopHome = normalizeHomeCandidate(window.__AX_CODE_DESKTOP_HOME__)

    if (desktopHome) {
      cachedHomeDirectory = desktopHome
      safeStorage.setItem("homeDirectory", desktopHome)
      return desktopHome
    }

    const storedHome = normalizeHomeCandidate(getStoredHomeDirectory())
    if (storedHome) {
      cachedHomeDirectory = storedHome
      return storedHome
    }
  }

  const processHome = normalizeHomeCandidate(getProcessHomeDirectory())
  if (processHome) {
    return processHome
  }
  // No real home available yet. Return "" rather than "/" so the module-init
  // `if (initialCurrentDirectory)` guard skips setting a bad directory and async
  // home resolution (synchronizeHomeDirectory) can fill in the real path.
  return ""
}

const normalizeHomeCandidate = (value?: string | null) => {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const normalized = trimmed.replace(/\\/g, "/")
  if (normalized.length > 1) {
    const withoutTrailingSlash = normalized.replace(/\/+$/, "")
    if (withoutTrailingSlash && withoutTrailingSlash.length > 0) {
      if (withoutTrailingSlash === "/") {
        return null
      }
      return withoutTrailingSlash
    }
  }
  if (normalized === "/" || normalized.length === 0) {
    return null
  }
  return normalized
}

const persistResolvedHome = (resolved: string) => {
  cachedHomeDirectory = resolved
  if (typeof window !== "undefined") {
    safeStorage.setItem("homeDirectory", resolved)
  }
  void updateDesktopSettings({ homeDirectory: resolved })
  return resolved
}

const initializeHomeDirectory = async () => {
  const acceptCandidate = (candidate?: string | null) => {
    const normalized = normalizeHomeCandidate(candidate)
    return normalized ? persistResolvedHome(normalized) : null
  }

  try {
    const fsHome = await axCodeClient.getFilesystemHome()
    const resolved = acceptCandidate(fsHome)
    if (resolved) {
      return resolved
    }
  } catch (filesystemError) {
    console.warn("Failed to obtain filesystem home directory:", filesystemError)
  }

  try {
    const info = await axCodeClient.getSystemInfo()
    const resolved = acceptCandidate(info?.homeDirectory)
    if (resolved) {
      return resolved
    }
  } catch (error) {
    console.warn("Failed to get home directory from system info:", error)
  }

  try {
    const desktopHome = await getDesktopHomeDirectory()
    const resolved = acceptCandidate(desktopHome)
    if (resolved) {
      return resolved
    }
  } catch (desktopError) {
    console.warn("Failed to obtain desktop-integrated home directory:", desktopError)
  }

  const fallback = getHomeDirectory()
  const resolvedFallback = acceptCandidate(fallback)
  if (resolvedFallback) {
    return resolvedFallback
  }

  return fallback
}

const initialHomeDirectory = getHomeDirectory()
const initialCurrentDirectory = (() => {
  const persisted = getStoredLastDirectory()
  if (persisted) {
    return resolveDirectoryPath(persisted, initialHomeDirectory)
  }
  return initialHomeDirectory
})()

if (initialCurrentDirectory) {
  axCodeClient.setDirectory(initialCurrentDirectory)
}
const initialIsHomeReady = Boolean(initialHomeDirectory && initialHomeDirectory !== "/")

export const useDirectoryStore = create<DirectoryNavigationStore>()(
  devtools(
    (set, get) => ({
      currentDirectory: initialCurrentDirectory,
      directoryHistory: [initialCurrentDirectory],
      historyIndex: 0,
      homeDirectory: initialHomeDirectory,
      hasPersistedDirectory: initialHasPersistedDirectory,
      isHomeReady: initialIsHomeReady,
      isSwitchingDirectory: false,

      setDirectory: (path: string, options?: { showOverlay?: boolean }) => {
        void options
        const homeDir = cachedHomeDirectory || get().homeDirectory || safeStorage.getItem("homeDirectory")
        const resolvedPath = resolveDirectoryPath(path, homeDir)
        if (streamDebugEnabled()) {
          console.log("[DirectoryStore] setDirectory called with path:", resolvedPath)
        }

        axCodeClient.setDirectory(resolvedPath)
        invalidateFileSearchCache()

        set((state) => {
          const newHistory = [...state.directoryHistory.slice(0, state.historyIndex + 1), resolvedPath]

          safeStorage.setItem("lastDirectory", resolvedPath)
          void updateDesktopSettings({ lastDirectory: resolvedPath })

          return {
            currentDirectory: resolvedPath,
            directoryHistory: newHistory,
            historyIndex: newHistory.length - 1,
            hasPersistedDirectory: true,
            isHomeReady: true,
            isSwitchingDirectory: false,
          }
        })
      },

      goBack: () => {
        const state = get()
        if (state.historyIndex > 0) {
          const newIndex = state.historyIndex - 1
          const newDirectory = state.directoryHistory[newIndex]

          axCodeClient.setDirectory(newDirectory)
          invalidateFileSearchCache()

          safeStorage.setItem("lastDirectory", newDirectory)

          void updateDesktopSettings({ lastDirectory: newDirectory })

          set({
            currentDirectory: newDirectory,
            historyIndex: newIndex,
            hasPersistedDirectory: true,
            isHomeReady: true,
            isSwitchingDirectory: false,
          })
        }
      },

      goForward: () => {
        const state = get()
        if (state.historyIndex < state.directoryHistory.length - 1) {
          const newIndex = state.historyIndex + 1
          const newDirectory = state.directoryHistory[newIndex]

          axCodeClient.setDirectory(newDirectory)
          invalidateFileSearchCache()

          safeStorage.setItem("lastDirectory", newDirectory)

          void updateDesktopSettings({ lastDirectory: newDirectory })

          set({
            currentDirectory: newDirectory,
            historyIndex: newIndex,
            hasPersistedDirectory: true,
            isHomeReady: true,
            isSwitchingDirectory: false,
          })
        }
      },

      goToParent: () => {
        const { currentDirectory, setDirectory } = get()
        const homeDir = cachedHomeDirectory || get().homeDirectory || getHomeDirectory()

        if (currentDirectory === homeDir || currentDirectory === "/") {
          return
        }

        const cleanPath = currentDirectory.endsWith("/") ? currentDirectory.slice(0, -1) : currentDirectory

        const lastSlash = cleanPath.lastIndexOf("/")
        if (lastSlash === -1) {
          const home = cachedHomeDirectory || getHomeDirectory()
          setDirectory(home)
        } else if (lastSlash === 0) {
          setDirectory("/")
        } else {
          setDirectory(cleanPath.substring(0, lastSlash))
        }
      },

      goHome: async () => {
        const homeDir = cachedHomeDirectory || get().homeDirectory || (await initializeHomeDirectory())
        get().setDirectory(homeDir)
      },

      synchronizeHomeDirectory: (homePath: string) => {
        const state = get()
        const resolvedHome = homePath
        cachedHomeDirectory = resolvedHome
        const needsUpdate = state.homeDirectory !== resolvedHome
        const savedLastDirectory = safeStorage.getItem("lastDirectory")
        const hasSavedLastDirectory = typeof savedLastDirectory === "string" && savedLastDirectory.length > 0
        const shouldReplaceCurrent =
          !hasSavedLastDirectory &&
          (state.currentDirectory === "/" || state.currentDirectory === state.homeDirectory || !state.currentDirectory)

        if (!needsUpdate && !shouldReplaceCurrent) {
          if (!state.isHomeReady) {
            set({ isHomeReady: true })
          }
          return
        }

        const resolvedReady = typeof resolvedHome === "string" && resolvedHome !== "" && resolvedHome !== "/"

        const resolvedCurrent = state.currentDirectory
          ? resolveDirectoryPath(state.currentDirectory, resolvedHome)
          : state.currentDirectory
        const resolvedHistory = state.directoryHistory.map((entry) => resolveDirectoryPath(entry, resolvedHome))
        const historyChanged = resolvedHistory.some((entry, index) => entry !== state.directoryHistory[index])
        const currentChanged = Boolean(resolvedCurrent && resolvedCurrent !== state.currentDirectory)

        const updates: Partial<DirectoryNavigationStore> = {
          homeDirectory: resolvedHome,
          hasPersistedDirectory: hasSavedLastDirectory,
          isHomeReady: resolvedReady,
        }

        if (shouldReplaceCurrent) {
          updates.currentDirectory = resolvedHome
          updates.directoryHistory = [resolvedHome]
          updates.historyIndex = 0
          updates.isSwitchingDirectory = false
        } else if (currentChanged || historyChanged) {
          updates.currentDirectory = resolvedCurrent as string
          updates.directoryHistory = resolvedHistory
          updates.historyIndex = Math.min(state.historyIndex, resolvedHistory.length - 1)
          updates.isSwitchingDirectory = false
        }

        set(() => updates as Partial<DirectoryNavigationStore>)

        if ((shouldReplaceCurrent || currentChanged) && resolvedReady) {
          const nextDirectory = shouldReplaceCurrent ? resolvedHome : (resolvedCurrent as string)
          axCodeClient.setDirectory(nextDirectory)
          invalidateFileSearchCache()
          safeStorage.setItem("lastDirectory", nextDirectory)
          void updateDesktopSettings({ lastDirectory: nextDirectory })
        }

        void updateDesktopSettings({ homeDirectory: resolvedHome })
      },
    }),
    {
      name: "directory-store",
    },
  ),
)

if (typeof window !== "undefined") {
  initializeHomeDirectory().then((home) => {
    useDirectoryStore.getState().synchronizeHomeDirectory(home)
  })
}
