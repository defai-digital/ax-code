/**
 * Viewport Store — per-session scroll anchors, streaming state, memory.
 * Extracted from session-ui-store for subscription isolation.
 */

import { create } from "zustand"

export type SessionMemoryState = {
  viewportAnchor: number
  /** Last known scrollbar pixel state — saved on every scroll event. */
  scrollPosition?: {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
  }
  isStreaming: boolean
  streamStartTime?: number
  lastAccessedAt: number
  backgroundMessageCount: number
  loadedTurnCount?: number
  hasMoreAbove?: boolean
  hasMoreTurnsAbove?: boolean
  historyLoading?: boolean
  historyComplete?: boolean
  historyLimit?: number
  totalAvailableMessages?: number
  streamingCooldownUntil?: number
  isZombie?: boolean
  lastUserMessageAt?: number
}

export type ViewportState = {
  sessionMemoryState: Map<string, SessionMemoryState>
  isSyncing: boolean

  updateViewportAnchor: (
    sessionId: string,
    anchor: number,
    scrollPosition?: SessionMemoryState["scrollPosition"],
  ) => void
}

// Cap the per-session memory map so it doesn't grow for every session ever
// scrolled. Only the least-recently-accessed sessions past this many lose their
// remembered scroll position, which is reconstructed on next view.
const MAX_SESSION_MEMORY_ENTRIES = 200

export const useViewportStore = create<ViewportState>()((set) => ({
  sessionMemoryState: new Map(),
  isSyncing: false,

  updateViewportAnchor: (sessionId, anchor, scrollPosition) =>
    set((s) => {
      const map = new Map(s.sessionMemoryState)
      const existing = map.get(sessionId) ?? {
        viewportAnchor: 0,
        isStreaming: false,
        lastAccessedAt: Date.now(),
        backgroundMessageCount: 0,
      }
      map.set(sessionId, {
        ...existing,
        viewportAnchor: anchor,
        ...(scrollPosition ? { scrollPosition } : {}),
        lastAccessedAt: Date.now(),
      })
      if (map.size > MAX_SESSION_MEMORY_ENTRIES) {
        // Evict the least-recently-accessed entries. The session just touched
        // above has the newest lastAccessedAt, so it is never in the evicted set.
        const oldestFirst = [...map.entries()].sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)
        // Capture the overflow count BEFORE deleting — map.size shrinks on every
        // delete, so reading it in the loop condition would only evict half the
        // excess and leave the map permanently over cap on bulk overflow.
        const excess = map.size - MAX_SESSION_MEMORY_ENTRIES
        for (let i = 0; i < excess; i++) {
          map.delete(oldestFirst[i][0])
        }
      }
      return { sessionMemoryState: map }
    }),
}))
