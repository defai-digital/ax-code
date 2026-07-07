import { create } from "zustand"
import { axCodeClient } from "@/lib/ax-code/client"
import { toast } from "@/components/ui"
import { useI18nStore, formatMessage } from "@/lib/i18n/store"
import { normalizeDirectoryKey } from "@/stores/utils/directoryKey"

/**
 * The AX Code server exposes two layered execution settings, persisted to
 * ax-code.json and scoped by directory:
 *  - `autonomous`: auto-approves safe tools and continues multi-step runs.
 *  - `super_long`: adds a duration ceiling + request pacing on top of
 *    autonomous (the server returns 409 if enabled while autonomous is off).
 *
 * We collapse the two booleans into a single user-facing mode:
 *  - manual     → autonomous off
 *  - autonomous → autonomous on, super-long off
 *  - long-run   → autonomous on, super-long on
 */
export type ExecutionMode = "manual" | "autonomous" | "long-run"

const deriveMode = (autonomous: boolean, superLong: boolean): ExecutionMode => {
  if (!autonomous) return "manual"
  return superLong ? "long-run" : "autonomous"
}

const modeFlags = (mode: ExecutionMode): { autonomous: boolean; superLong: boolean } => ({
  autonomous: mode !== "manual",
  superLong: mode === "long-run",
})

type ExecutionModeState = {
  modeByDirectory: Record<string, ExecutionMode>
  pendingByDirectory: Record<string, boolean>
}

type ExecutionModeActions = {
  getMode: (directory: string | null | undefined) => ExecutionMode | undefined
  isPending: (directory: string | null | undefined) => boolean
  loadMode: (directory: string | null | undefined) => Promise<void>
  setMode: (directory: string | null | undefined, mode: ExecutionMode) => Promise<void>
}

type ExecutionModeStore = ExecutionModeState & ExecutionModeActions

type ApplyModeResult = {
  ok: boolean
  /**
   * The mode the server actually holds after the attempt, derived from which
   * calls landed. Null when nothing is known (no prior confirmed mode and no
   * call landed).
   */
  settled: ExecutionMode | null
}

/**
 * Apply a target mode by toggling the two server flags in a dependency-safe
 * order (autonomous must be on before super-long can be enabled, and off
 * after super-long is disabled). Tracks which writes landed so a
 * mid-sequence failure settles on server truth instead of the stale
 * pre-toggle mode — e.g. switching long-run → manual where super-long-off
 * lands but autonomous-off fails leaves the server in "autonomous", not the
 * previous "long-run".
 */
const applyMode = async (
  directory: string | null | undefined,
  mode: ExecutionMode,
  previous: ExecutionMode | undefined,
): Promise<ApplyModeResult> => {
  const applied: { autonomous: boolean | null; superLong: boolean | null } = previous
    ? { ...modeFlags(previous) }
    : { autonomous: null, superLong: null }
  const settled = (): ExecutionMode | null =>
    applied.autonomous === null || applied.superLong === null
      ? null
      : deriveMode(applied.autonomous, applied.superLong)

  try {
    return await axCodeClient.withDirectory(directory ?? null, async () => {
      if (mode === "manual") {
        const superLong = await axCodeClient.setSuperLongEnabled(false)
        if (superLong === null) return { ok: false, settled: settled() }
        applied.superLong = superLong
        const autonomous = await axCodeClient.setAutonomousEnabled(false)
        if (autonomous === null) return { ok: false, settled: settled() }
        applied.autonomous = autonomous
        return { ok: true, settled: settled() }
      }

      const autonomous = await axCodeClient.setAutonomousEnabled(true)
      if (autonomous === null) return { ok: false, settled: settled() }
      applied.autonomous = autonomous
      const superLong = await axCodeClient.setSuperLongEnabled(mode === "long-run")
      if (superLong === null) return { ok: false, settled: settled() }
      applied.superLong = superLong
      return { ok: true, settled: settled() }
    })
  } catch {
    return { ok: false, settled: settled() }
  }
}

export const useExecutionModeStore = create<ExecutionModeStore>()((set, get) => ({
  modeByDirectory: {},
  pendingByDirectory: {},

  getMode: (directory) => get().modeByDirectory[normalizeDirectoryKey(directory)],
  isPending: (directory) => get().pendingByDirectory[normalizeDirectoryKey(directory)] === true,

  loadMode: async (directory) => {
    const key = normalizeDirectoryKey(directory)
    // No "already loaded" latch: these flags can change out-of-band (CLI,
    // other windows) and are not pushed over SSE, so re-fetch whenever a
    // consumer mounts. The last confirmed mode stays visible while loading.
    if (get().pendingByDirectory[key]) return

    set((s) => ({ pendingByDirectory: { ...s.pendingByDirectory, [key]: true } }))

    let flags: { autonomous: boolean | null; superLong: boolean | null } = { autonomous: null, superLong: null }
    try {
      flags = await axCodeClient.withDirectory(directory ?? null, async () => {
        const [autonomous, superLong] = await Promise.all([
          axCodeClient.getAutonomousEnabled(),
          axCodeClient.getSuperLongEnabled(),
        ])
        return { autonomous, superLong }
      })
    } catch {
      flags = { autonomous: null, superLong: null }
    }

    set((s) => {
      const next: Partial<ExecutionModeState> = {
        pendingByDirectory: { ...s.pendingByDirectory, [key]: false },
      }
      // Leave the mode unset on a failed read so the UI can stay neutral
      // rather than asserting an authoritative state we never confirmed.
      if (flags.autonomous !== null && flags.superLong !== null) {
        next.modeByDirectory = {
          ...s.modeByDirectory,
          [key]: deriveMode(flags.autonomous, flags.superLong),
        }
      }
      return next
    })
  },

  setMode: async (directory, mode) => {
    const key = normalizeDirectoryKey(directory)
    const previous = get().modeByDirectory[key]
    if (previous === mode || get().pendingByDirectory[key]) return

    // Optimistic: reflect the target immediately, mark pending.
    set((s) => ({
      modeByDirectory: { ...s.modeByDirectory, [key]: mode },
      pendingByDirectory: { ...s.pendingByDirectory, [key]: true },
    }))

    const result = await applyMode(directory, mode, previous)

    set((s) => {
      const pendingByDirectory = { ...s.pendingByDirectory, [key]: false }
      if (result.settled === null) {
        // Nothing confirmed: drop the optimistic value so the UI stays
        // neutral until the next load re-reads server state.
        const modeByDirectory = { ...s.modeByDirectory }
        delete modeByDirectory[key]
        return { modeByDirectory, pendingByDirectory }
      }
      // Reflect what the server actually holds — on partial failure this is
      // the mid-transition state, not the pre-toggle mode.
      return {
        modeByDirectory: { ...s.modeByDirectory, [key]: result.settled },
        pendingByDirectory,
      }
    })

    if (!result.ok) {
      toast.error(formatMessage(useI18nStore.getState().dictionary, "chat.chatInput.executionMode.updateFailed"))
    }
  },
}))
