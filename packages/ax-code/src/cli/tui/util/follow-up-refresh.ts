import { createEffect, createSignal, onCleanup, untrack } from "solid-js"
import z from "zod"
import { mergeFollowUpSnapshot, type FollowUpSdk } from "../component/prompt/durable-follow-up"
import type { useSDK } from "../context/sdk"
import type { SyncStoreState } from "../context/sync-state"
import { directoryRequestHeaders } from "./request-headers"

const REFRESH_TIMEOUT_MS = 10_000
type QueueRows = SyncStoreState["task_queue"]

type FollowUpRefreshOptions = {
  sdk: FollowUpSdk & { event: Pick<ReturnType<typeof useSDK>["event"], "on"> }
  state: Pick<SyncStoreState, "status" | "task_queue">
  sessionID: () => string | undefined
  update: (merge: (current: QueueRows) => QueueRows) => void
  onError: (error: unknown) => void
}

/** One refresh lifecycle for both TUI modes; presentation owns error feedback. */
export function createFollowUpRefresh(options: FollowUpRefreshOptions): void {
  const { sdk } = options
  const [revision, invalidate] = createSignal(0)
  for (const event of ["server.connected", "server.resync_required"] as const) {
    onCleanup(sdk.event.on(event, () => invalidate((value) => value + 1)))
  }
  createEffect(() => {
    revision()
    const sessionID = options.sessionID()
    const directory = sdk.directory
    if (!sessionID || !sdk.sseConnected || options.state.status === "loading") return
    const abort = new AbortController()
    const deleted = new Set<string>()
    const unsubscribe = sdk.event.on("task.queue.deleted", (event) => deleted.add(event.properties.id))
    let listening = true
    const stopListening = (): void => {
      if (!listening) return
      listening = false
      unsubscribe()
    }
    onCleanup(() => {
      abort.abort()
      stopListening()
    })
    const isCurrent = (): boolean => !abort.signal.aborted && sdk.directory === directory
    untrack(() => {
      const before = new Map(options.state.task_queue.map((item) => [item.id, JSON.stringify(item)]))
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(REFRESH_TIMEOUT_MS)])
      const refresh = async (): Promise<void> => {
        try {
          const response = await sdk.fetch(
            `${sdk.url.replace(/\/$/, "")}/task-queue?sessionID=${encodeURIComponent(sessionID)}`,
            { headers: directoryRequestHeaders({ directory }), signal },
          )
          if (!response.ok) throw new Error("Unable to refresh saved follow-ups")
          const rows = z.array(z.unknown()).parse(await response.json())
          signal.throwIfAborted()
          if (!isCurrent()) return
          options.update((current) => mergeFollowUpSnapshot(current, rows, sessionID, before, deleted))
        } catch (error) {
          if (isCurrent()) options.onError(error)
        } finally {
          stopListening()
        }
      }
      void refresh()
    })
  })
}
