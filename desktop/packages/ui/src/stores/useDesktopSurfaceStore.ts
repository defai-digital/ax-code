import { create } from "zustand"
import { persist } from "zustand/middleware"
import {
  DEFAULT_DESKTOP_SURFACE,
  parseDesktopSurface,
  type DesktopSurfaceId,
} from "@/lib/desktopSurface"

type DesktopSurfaceState = {
  surface: DesktopSurfaceId
}

type DesktopSurfaceActions = {
  setSurface: (surface: DesktopSurfaceId) => void
  toggleSurface: () => void
}

type DesktopSurfaceStore = DesktopSurfaceState & DesktopSurfaceActions

export const useDesktopSurfaceStore = create<DesktopSurfaceStore>()(
  persist(
    (set, get) => ({
      surface: DEFAULT_DESKTOP_SURFACE,

      setSurface: (surface) => {
        set({ surface: parseDesktopSurface(surface) })
      },

      toggleSurface: () => {
        const next: DesktopSurfaceId = get().surface === "code" ? "work" : "code"
        set({ surface: next })
      },
    }),
    {
      name: "ax-code-desktop-surface",
      partialize: (state) => ({ surface: state.surface }),
      merge: (persisted, current) => {
        const raw =
          persisted && typeof persisted === "object"
            ? (persisted as { surface?: unknown }).surface
            : undefined
        return {
          ...current,
          surface: parseDesktopSurface(raw, current.surface),
        }
      },
    },
  ),
)
