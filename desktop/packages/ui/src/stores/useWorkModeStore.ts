import { create } from "zustand"
import { persist } from "zustand/middleware"
import {
  DEFAULT_WORK_MODE,
  parseWorkMode,
  type WorkModeId,
} from "@/lib/workMode"
import { normalizeDirectoryKey } from "@/stores/utils/directoryKey"

type WorkModeState = {
  modeByDirectory: Record<string, WorkModeId>
}

type WorkModeActions = {
  getMode: (directory: string | null | undefined) => WorkModeId
  setMode: (directory: string | null | undefined, mode: WorkModeId) => void
}

type WorkModeStore = WorkModeState & WorkModeActions

export const useWorkModeStore = create<WorkModeStore>()(
  persist(
    (set, get) => ({
      modeByDirectory: {},

      getMode: (directory) => {
        const key = normalizeDirectoryKey(directory)
        return parseWorkMode(get().modeByDirectory[key], DEFAULT_WORK_MODE)
      },

      setMode: (directory, mode) => {
        const key = normalizeDirectoryKey(directory)
        set((state) => ({
          modeByDirectory: {
            ...state.modeByDirectory,
            [key]: parseWorkMode(mode),
          },
        }))
      },
    }),
    {
      name: "ax-code-work-mode",
      partialize: (state) => ({ modeByDirectory: state.modeByDirectory }),
    },
  ),
)
