import { create } from "zustand"

/**
 * Tracks, per session, when the agent last finished a run during this app
 * session. "Finished with uncommitted changes" UI (sidebar badge, chat nudge)
 * must only fire for sessions whose agent actually ran — never for
 * pre-existing dirty state in a shared directory.
 */
interface RunStateStore {
  runEndedAt: Record<string, number>
  nudgeDismissedAt: Record<string, number>
  markRunEnded: (sessionId: string) => void
  dismissNudge: (sessionId: string) => void
}

export const useRunStateStore = create<RunStateStore>((set) => ({
  runEndedAt: {},
  nudgeDismissedAt: {},

  markRunEnded: (sessionId) => {
    set((state) => ({ runEndedAt: { ...state.runEndedAt, [sessionId]: Date.now() } }))
  },

  dismissNudge: (sessionId) => {
    set((state) => ({ nudgeDismissedAt: { ...state.nudgeDismissedAt, [sessionId]: Date.now() } }))
  },
}))

// Imperative API for non-React code (event handler in sync-context)

export function markSessionRunEnded(sessionId: string): void {
  useRunStateStore.getState().markRunEnded(sessionId)
}

// React hooks for fine-grained subscriptions

export function useSessionRunEndedAt(sessionId: string): number | null {
  return useRunStateStore((s) => s.runEndedAt[sessionId] ?? null)
}

export function useNudgeDismissedAt(sessionId: string): number | null {
  return useRunStateStore((s) => s.nudgeDismissedAt[sessionId] ?? null)
}
