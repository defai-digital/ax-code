import { create } from "zustand"
import { axCodeClient } from "@/lib/ax-code/client"
import { toast } from "@/components/ui"
import { useI18nStore, formatMessage } from "@/lib/i18n/store"
import { normalizeDirectoryKey } from "@/stores/utils/directoryKey"

/**
 * Sandbox (isolation) mode toggle for the desktop UI. The AX Code server
 * persists isolation to ax-code.json scoped by directory. Sandbox is "on"
 * when the isolation mode is not "full-access" (i.e. "read-only" or
 * "workspace-write"). Toggling sandbox off sets mode to "full-access";
 * toggling it back on restores the last restricted mode we saw for the
 * directory (so a configured "read-only" is not silently upgraded to
 * "workspace-write"), defaulting to "workspace-write".
 */

type RestrictedMode = "read-only" | "workspace-write"

const isRestrictedMode = (mode: string): mode is RestrictedMode => mode === "read-only" || mode === "workspace-write"

type SandboxState = {
  sandboxByDirectory: Record<string, boolean>
  pendingByDirectory: Record<string, boolean>
  restrictedModeByDirectory: Record<string, RestrictedMode>
}

type SandboxActions = {
  isSandbox: (directory: string | null | undefined) => boolean | undefined
  isPending: (directory: string | null | undefined) => boolean
  loadSandbox: (directory: string | null | undefined) => Promise<void>
  setSandbox: (directory: string | null | undefined, enabled: boolean) => Promise<void>
}

type SandboxStore = SandboxState & SandboxActions

export const useSandboxStore = create<SandboxStore>()((set, get) => ({
  sandboxByDirectory: {},
  pendingByDirectory: {},
  restrictedModeByDirectory: {},

  isSandbox: (directory) => get().sandboxByDirectory[normalizeDirectoryKey(directory)],
  isPending: (directory) => get().pendingByDirectory[normalizeDirectoryKey(directory)] === true,

  loadSandbox: async (directory) => {
    const key = normalizeDirectoryKey(directory)
    // No "already loaded" latch: isolation can change out-of-band (CLI,
    // other windows) and is not pushed over SSE, so re-fetch whenever a
    // consumer mounts. The last confirmed state stays visible while loading.
    if (get().pendingByDirectory[key]) return

    set((s) => ({ pendingByDirectory: { ...s.pendingByDirectory, [key]: true } }))

    let isolation: Awaited<ReturnType<typeof axCodeClient.getIsolation>> | null = null
    try {
      isolation = await axCodeClient.withDirectory(directory ?? null, async () => {
        return axCodeClient.getIsolation()
      })
    } catch {
      isolation = null
    }

    set((s) => {
      const next: Partial<SandboxState> = {
        pendingByDirectory: { ...s.pendingByDirectory, [key]: false },
      }
      if (isolation !== null) {
        next.sandboxByDirectory = {
          ...s.sandboxByDirectory,
          [key]: isolation.mode !== "full-access",
        }
        if (isRestrictedMode(isolation.mode)) {
          next.restrictedModeByDirectory = { ...s.restrictedModeByDirectory, [key]: isolation.mode }
        }
      }
      return next
    })
  },

  setSandbox: async (directory, enabled) => {
    const key = normalizeDirectoryKey(directory)
    const previous = get().sandboxByDirectory[key]
    if (previous === enabled || get().pendingByDirectory[key]) return

    // Optimistic: reflect the target immediately, mark pending.
    set((s) => ({
      sandboxByDirectory: { ...s.sandboxByDirectory, [key]: enabled },
      pendingByDirectory: { ...s.pendingByDirectory, [key]: true },
    }))

    const mode = enabled ? (get().restrictedModeByDirectory[key] ?? "workspace-write") : "full-access"
    let result: Awaited<ReturnType<typeof axCodeClient.setIsolation>> | null = null
    try {
      result = await axCodeClient.withDirectory(directory ?? null, async () => {
        return axCodeClient.setIsolation(mode)
      })
    } catch {
      result = null
    }

    set((s) => {
      const pendingByDirectory = { ...s.pendingByDirectory, [key]: false }
      if (result === null) {
        // Revert to the last confirmed state (or drop the optimistic value).
        const sandboxByDirectory = { ...s.sandboxByDirectory }
        if (previous === undefined) {
          delete sandboxByDirectory[key]
        } else {
          sandboxByDirectory[key] = previous
        }
        return { sandboxByDirectory, pendingByDirectory }
      }
      const next: Partial<SandboxState> = {
        sandboxByDirectory: { ...s.sandboxByDirectory, [key]: result.mode !== "full-access" },
        pendingByDirectory,
      }
      if (isRestrictedMode(result.mode)) {
        next.restrictedModeByDirectory = { ...s.restrictedModeByDirectory, [key]: result.mode }
      }
      return next
    })

    if (result === null) {
      toast.error(formatMessage(useI18nStore.getState().dictionary, "chat.chatInput.sandbox.updateFailed"))
    }
  },
}))
