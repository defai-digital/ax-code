import { Instance } from "../project/instance"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import type { SessionID } from "./schema"
import { SessionStatus } from "./status"

type PromptRunCallback = {
  resolve(input: MessageV2.WithParts): void
  reject(reason?: unknown): void
}

type PromptRunEntry = {
  abort: AbortController
  running: boolean
  callbacks: PromptRunCallback[]
}

export function createPromptRunState() {
  const state = Instance.state(
    () => {
      const data: Record<string, PromptRunEntry> = {}
      return data
    },
    async (current) => {
      for (const item of Object.values(current)) {
        item.abort.abort()
      }
    },
  )

  return {
    assertNotBusy(sessionID: SessionID) {
      const match = state()[sessionID]
      if (match) throw new Session.BusyError(sessionID)
    },

    start(sessionID: SessionID) {
      const s = state()
      const existing = s[sessionID]
      if (existing?.running) return
      const controller = new AbortController()
      s[sessionID] = {
        abort: controller,
        running: true,
        callbacks: existing?.callbacks ?? [],
      }
      return controller.signal
    },

    resume(sessionID: SessionID) {
      const s = state()
      if (!s[sessionID]?.running) return

      return s[sessionID].abort.signal
    },

    enqueue(sessionID: SessionID, callback: PromptRunCallback) {
      const entry = state()[sessionID]
      if (!entry) return false
      entry.callbacks.push(callback)
      return true
    },

    queuedCallbacks(sessionID: SessionID) {
      return state()[sessionID]?.callbacks ?? []
    },

    markIdle(sessionID: SessionID) {
      const entry = state()[sessionID]
      if (entry) entry.running = false
    },

    shiftQueuedCallback(sessionID: SessionID) {
      return state()[sessionID]?.callbacks.shift()
    },

    async cancel(sessionID: SessionID) {
      const s = state()
      const match = s[sessionID]
      if (!match) {
        await SessionStatus.set(sessionID, { type: "idle" })
        return
      }
      // Snapshot the callbacks list and delete the state entry BEFORE
      // iterating. A concurrent loop() re-entry that ran between zeroing
      // `match.callbacks.length = 0` and `delete s[sessionID]` could
      // otherwise observe a partially-cleared state. Now any re-entry
      // either sees the original state (and gets rejected via the
      // snapshot) or a fresh start with no leftover callbacks.
      const callbacks = match.callbacks.slice()
      match.callbacks.length = 0
      match.abort.abort()
      delete s[sessionID]
      for (const cb of callbacks) {
        cb.reject(new Error("Session ended"))
      }
      await SessionStatus.set(sessionID, { type: "idle" })
    },
  }
}
