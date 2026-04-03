import { useGlobalSync } from "@/context/global-sync"
import { decode64 } from "@/utils/base64"
import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"

export const offlineProviders = new Set(["ax-studio", "ollama", "lmstudio"])

export function isOfflineProvider(id: string) {
  return offlineProviders.has(id)
}

// kept for backwards compat — online providers listed first in UI
export const popularProviders = ["anthropic", "openai", "google", "github-copilot", "groq", "xai", "deepseek"]

export function useProviders() {
  const globalSync = useGlobalSync()
  const params = useParams()
  const dir = createMemo(() => decode64(params.dir) ?? "")
  const providers = () => {
    if (dir()) {
      const [projectStore] = globalSync.child(dir())
      if (projectStore.provider.all.length > 0) return projectStore.provider
    }
    return globalSync.data.provider
  }
  return {
    all: () => providers().all,
    default: () => providers().default,
    popular: () => providers().all.filter((p) => !offlineProviders.has(p.id)),
    connected: () => {
      const connected = new Set(providers().connected)
      return providers().all.filter((p) => connected.has(p.id))
    },
    paid: () => {
      const connected = new Set(providers().connected)
      return providers().all.filter(
        (p) => connected.has(p.id),
      )
    },
  }
}
