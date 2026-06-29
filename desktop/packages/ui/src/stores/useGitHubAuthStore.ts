import { create } from "zustand"
import type { GitHubAuthStatus, RuntimeAPIs } from "@/lib/api/types"
import { API_ENDPOINTS } from "@/lib/http"

type GitHubAuthStatusWithError = GitHubAuthStatus & { error?: string }

type GitHubAuthStore = {
  status: GitHubAuthStatusWithError | null
  isLoading: boolean
  hasChecked: boolean
  setStatus: (status: GitHubAuthStatusWithError | null) => void
  refreshStatus: (
    runtimeGitHub?: RuntimeAPIs["github"],
    options?: { force?: boolean },
  ) => Promise<GitHubAuthStatusWithError | null>
}

const fetchStatus = async (runtimeGitHub?: RuntimeAPIs["github"]): Promise<GitHubAuthStatusWithError> => {
  if (runtimeGitHub) {
    const payload = await runtimeGitHub.authStatus()
    return payload as GitHubAuthStatus
  }

  const response = await fetch(API_ENDPOINTS.github.authStatus, {
    method: "GET",
    headers: { Accept: "application/json" },
  })
  const payload = (await response.json().catch(() => null)) as GitHubAuthStatusWithError | null
  if (!response.ok || !payload) {
    throw new Error(payload?.error || response.statusText || "Failed to load GitHub status")
  }
  return payload
}

const runtimeGitHubIds = new WeakMap<object, number>()
const inFlightAuthRefreshes = new Map<string, Promise<GitHubAuthStatusWithError | null>>()
let runtimeGitHubSequence = 0
let authRefreshSequence = 0
let latestAuthRefreshRequestId = 0
let lastResolvedAuthRefreshKey: string | null = null

const getAuthRefreshKey = (runtimeGitHub?: RuntimeAPIs["github"]): string => {
  if (!runtimeGitHub) {
    return "http"
  }
  const runtimeObject = runtimeGitHub as object
  const existing = runtimeGitHubIds.get(runtimeObject)
  if (existing) {
    return `runtime:${existing}`
  }
  const id = ++runtimeGitHubSequence
  runtimeGitHubIds.set(runtimeObject, id)
  return `runtime:${id}`
}

export const useGitHubAuthStore = create<GitHubAuthStore>((set, get) => ({
  status: null,
  isLoading: false,
  hasChecked: false,
  setStatus: (status) => set({ status, hasChecked: true }),
  refreshStatus: async (runtimeGitHub, options) => {
    const { hasChecked, status } = get()
    const refreshKey = getAuthRefreshKey(runtimeGitHub)
    if (hasChecked && !options?.force && lastResolvedAuthRefreshKey === refreshKey) {
      return status
    }

    const inFlight = inFlightAuthRefreshes.get(refreshKey)
    if (inFlight) return inFlight

    set({ isLoading: true })
    const requestId = ++authRefreshSequence
    latestAuthRefreshRequestId = requestId
    const request = (async () => {
      try {
        const payload = await fetchStatus(runtimeGitHub)
        if (latestAuthRefreshRequestId === requestId) {
          lastResolvedAuthRefreshKey = refreshKey
          set({ status: payload, isLoading: false, hasChecked: true })
        }
        return payload
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (latestAuthRefreshRequestId === requestId) {
          lastResolvedAuthRefreshKey = refreshKey
          set({
            status: { connected: false, error: message },
            isLoading: false,
            hasChecked: true,
          })
        }
        return null
      }
    })().finally(() => {
      if (inFlightAuthRefreshes.get(refreshKey) === request) {
        inFlightAuthRefreshes.delete(refreshKey)
      }
    })

    inFlightAuthRefreshes.set(refreshKey, request)
    return request
  },
}))
