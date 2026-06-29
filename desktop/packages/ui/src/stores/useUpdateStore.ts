import { create } from "zustand"
import type { UpdateInfo, UpdateProgress } from "@/lib/desktop"
import {
  checkForDesktopUpdates,
  downloadDesktopUpdate,
  restartToApplyUpdate,
  isDesktopLocalOriginActive,
  isDesktopShell,
  isElectronShell,
  isWebRuntime,
} from "@/lib/desktop"
import { API_ENDPOINTS } from "@/lib/http"

export type UpdateState = {
  checking: boolean
  available: boolean
  downloading: boolean
  downloaded: boolean
  info: UpdateInfo | null
  progress: UpdateProgress | null
  error: string | null
  runtimeType: "desktop" | "web" | null
  lastChecked: number | null
  nextCheckInSec: number | null
}

interface UpdateStore extends UpdateState {
  checkForUpdates: () => Promise<number | null>
  downloadUpdate: () => Promise<void>
  restartToUpdate: () => Promise<void>
  dismiss: () => void
  reset: () => void
}

type ClientRuntime = "desktop" | "web"
const UPDATE_FAILED_MESSAGE = "Update failed. Please try again or open the release page."
const RESTART_FAILED_MESSAGE = "Failed to restart AX Code Desktop."
let updateCheckRequestId = 0

function mapRuntimeParams(runtime: ClientRuntime): URLSearchParams {
  const params = new URLSearchParams()
  if (runtime === "desktop") {
    params.set("appType", isElectronShell() ? "desktop-electron" : "desktop-tauri")
    return params
  }

  params.set("appType", "web")
  return params
}

async function checkForWebUpdates(runtime: ClientRuntime, currentVersion?: string): Promise<UpdateInfo | null> {
  try {
    const params = mapRuntimeParams(runtime)
    if (currentVersion) params.set("currentVersion", currentVersion)
    const response = await fetch(`${API_ENDPOINTS.openchamber.updateCheck}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    })

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`)
    }

    const data = await response.json()
    return {
      available: data.available ?? false,
      version: data.version,
      currentVersion: data.currentVersion ?? "unknown",
      body: data.body,
      nextSuggestedCheckInSec:
        typeof data.nextSuggestedCheckInSec === "number" && Number.isFinite(data.nextSuggestedCheckInSec)
          ? data.nextSuggestedCheckInSec
          : undefined,
      packageManager: data.packageManager,
      updateCommand: data.updateCommand,
    }
  } catch (error) {
    console.warn("Failed to check for updates:", error)
    return null
  }
}

function detectRuntimeType(): "desktop" | "web" | null {
  if (isDesktopShell()) {
    // Only use the native updater when we're on the local instance.
    // When viewing a remote host inside the desktop shell, treat update as web update.
    return isDesktopLocalOriginActive() ? "desktop" : "web"
  }
  if (isWebRuntime()) return "web"
  return null
}

const initialState: UpdateState = {
  checking: false,
  available: false,
  downloading: false,
  downloaded: false,
  info: null,
  progress: null,
  error: null,
  runtimeType: null,
  lastChecked: null,
  nextCheckInSec: null,
}

export const useUpdateStore = create<UpdateStore>()((set, get) => ({
  ...initialState,

  checkForUpdates: async () => {
    const runtime = detectRuntimeType()
    if (!runtime) return null

    const requestId = ++updateCheckRequestId
    const isCurrentRequest = () => requestId === updateCheckRequestId
    set({ checking: true, error: null, runtimeType: runtime })

    try {
      let info: UpdateInfo | null = null
      let suggestedSec: number | null = null

      if (runtime === "desktop") {
        // The desktop shell updates itself via its native updater
        // (electron-updater against the AX Code Desktop GitHub releases). That
        // result is authoritative — do not consult the OpenChamber npm/web
        // update API here, or the dialog would surface OpenChamber's package
        // version and changelog instead of AX Code's.
        const desktopInfo = await checkForDesktopUpdates()
        if (!isCurrentRequest()) return null
        if (desktopInfo?.error) {
          console.warn("Desktop update check failed:", desktopInfo.error)
          set({
            checking: false,
            available: false,
            error: UPDATE_FAILED_MESSAGE,
            lastChecked: Date.now(),
            nextCheckInSec: null,
          })
          return null
        }
        set({
          checking: false,
          available: desktopInfo?.available ?? false,
          info: desktopInfo,
          lastChecked: Date.now(),
          nextCheckInSec: null,
        })

        return null
      } else if (runtime === "web") {
        info = await checkForWebUpdates("web")
        if (!isCurrentRequest()) return null
        suggestedSec = info?.nextSuggestedCheckInSec ?? null
      }

      set({
        checking: false,
        available: info?.available ?? false,
        info,
        lastChecked: Date.now(),
        nextCheckInSec: suggestedSec,
      })
      return suggestedSec
    } catch {
      if (!isCurrentRequest()) return null
      set({
        checking: false,
        error: UPDATE_FAILED_MESSAGE,
      })
      return null
    }
  },

  downloadUpdate: async () => {
    const { available, runtimeType } = get()

    // For web runtime, there's no download - user uses in-app update or CLI
    if (runtimeType !== "desktop" || !available) {
      return
    }

    const requestId = ++updateCheckRequestId
    const isCurrentRequest = () => requestId === updateCheckRequestId
    set({ downloading: true, error: null, progress: null })

    try {
      const desktopInfo = await checkForDesktopUpdates()
      if (!isCurrentRequest()) return
      if (desktopInfo?.error) {
        console.warn("Desktop update recheck failed:", desktopInfo.error)
        throw new Error(UPDATE_FAILED_MESSAGE)
      }
      if (!desktopInfo?.available) {
        throw new Error("Update detected, but desktop package is not ready yet. Retry in a moment.")
      }

      set((state) => ({
        info: state.info
          ? {
              ...state.info,
              ...desktopInfo,
              // Keep the richer sidecar-sourced changelog; desktopInfo.body is
              // often the bare "See release notes at..." fallback from the
              // updater and would otherwise clobber the nice changelog.
              body: state.info.body || desktopInfo.body,
              available: state.info.available,
            }
          : desktopInfo,
      }))

      const ok = await downloadDesktopUpdate((progress) => {
        if (!isCurrentRequest()) return
        set({ progress })
      })
      if (!isCurrentRequest()) return
      if (!ok) {
        throw new Error("Desktop update only works on Local instance")
      }
      set({ downloading: false, downloaded: true })
    } catch (error) {
      console.warn("Failed to download desktop update:", error)
      if (!isCurrentRequest()) return
      set({
        downloading: false,
        error: UPDATE_FAILED_MESSAGE,
      })
    }
  },

  restartToUpdate: async () => {
    const { downloaded, runtimeType } = get()

    if (runtimeType !== "desktop" || !downloaded) {
      return
    }

    try {
      const ok = await restartToApplyUpdate()
      if (!ok) {
        throw new Error("Desktop restart only works on Local instance")
      }
    } catch (error) {
      console.warn("Failed to restart for desktop update:", error)
      set({
        error: RESTART_FAILED_MESSAGE,
      })
    }
  },

  dismiss: () => {
    set({ available: false, downloaded: false, info: null })
  },

  reset: () => {
    updateCheckRequestId += 1
    set(initialState)
  },
}))
