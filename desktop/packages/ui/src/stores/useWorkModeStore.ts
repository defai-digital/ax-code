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
  /** Reset to Agent for a directory (or all dirs when directory is null/undefined). Used on new chat. */
  resetToAgent: (directory?: string | null | undefined) => void
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

      resetToAgent: (directory) => {
        if (directory === undefined || directory === null || directory === "") {
          set({ modeByDirectory: {} })
          return
        }
        const key = normalizeDirectoryKey(directory)
        set((state) => ({
          modeByDirectory: {
            ...state.modeByDirectory,
            [key]: DEFAULT_WORK_MODE,
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
