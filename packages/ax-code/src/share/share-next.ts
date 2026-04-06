import { Bus } from "@/bus"
import { Account } from "@/account"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { ProviderID, ModelID } from "@/provider/schema"
import { Session } from "@/session"
import type { SessionID } from "@/session/schema"
import { MessageV2 } from "@/session/message-v2"
import { Database, eq } from "@/storage/db"
import { SessionShareTable } from "./share.sql"
import { Log } from "@/util/log"
import type * as SDK from "@ax-code/sdk/v2"

export namespace ShareNext {
  const log = Log.create({ service: "share-next" })

  type ApiEndpoints = {
    create: string
    sync: (shareId: string) => string
    remove: (shareId: string) => string
    data: (shareId: string) => string
  }

  function apiEndpoints(resource: string): ApiEndpoints {
    return {
      create: `/api/${resource}`,
      sync: (shareId) => `/api/${resource}/${shareId}/sync`,
      remove: (shareId) => `/api/${resource}/${shareId}`,
      data: (shareId) => `/api/${resource}/${shareId}/data`,
    }
  }

  const legacyApi = apiEndpoints("share")
  const consoleApi = apiEndpoints("shares")

  export async function url() {
    const req = await request()
    return req.baseUrl
  }

  export async function request(): Promise<{
    headers: Record<string, string>
    api: ApiEndpoints
    baseUrl: string
  }> {
    const headers: Record<string, string> = {}

    const active = await Account.active()
    if (!active?.active_org_id) {
      const baseUrl = await Config.get().then((x) => x.enterprise?.url ?? "https://opncd.ai")
      return { headers, api: legacyApi, baseUrl }
    }

    const token = await Account.token(active.id)
    if (!token) {
      throw new Error("No active account token available for sharing")
    }

    headers["authorization"] = `Bearer ${token}`
    headers["x-org-id"] = active.active_org_id
    return { headers, api: consoleApi, baseUrl: active.url }
  }

  const disabled = process.env["AX_CODE_DISABLE_SHARE"] === "true" || process.env["AX_CODE_DISABLE_SHARE"] === "1"

  // Track active subscriptions so repeated init() calls do not stack up
  // duplicate listeners. Each entry is an unsubscribe function returned
  // by Bus.subscribe.
  let activeUnsubs: Array<() => void> = []

  export async function init() {
    if (disabled) return
    // Idempotent: tear down any prior subscriptions before rewiring so a
    // second init() (bootstrap re-entry, tests) cannot accumulate
    // duplicate sync requests for every event.
    dispose()
    const safeSync = async (sessionID: SessionID, data: Data[], source: string) => {
      await sync(sessionID, data).catch((error) => {
        log.warn("share sync failed", { sessionID, source, error })
      })
    }
    activeUnsubs.push(
      Bus.subscribe(Session.Event.Updated, async (evt) => {
        await safeSync(evt.properties.info.id, [
          {
            type: "session",
            data: evt.properties.info,
          },
        ], "session.updated")
      }),
    )
    activeUnsubs.push(
      Bus.subscribe(MessageV2.Event.Updated, async (evt) => {
        await safeSync(evt.properties.info.sessionID, [
          {
            type: "message",
            data: evt.properties.info,
          },
        ], "message.updated")
        if (evt.properties.info.role === "user") {
          await safeSync(evt.properties.info.sessionID, [
            {
              type: "model",
              data: [
                await Provider.getModel(evt.properties.info.model.providerID, evt.properties.info.model.modelID).then(
                  (m) => m,
                ),
              ],
            },
          ], "message.updated.model")
        }
      }),
    )
    activeUnsubs.push(
      Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        await safeSync(evt.properties.part.sessionID, [
          {
            type: "part",
            data: evt.properties.part,
          },
        ], "part.updated")
      }),
    )
    activeUnsubs.push(
      Bus.subscribe(Session.Event.Diff, async (evt) => {
        await safeSync(evt.properties.sessionID, [
          {
            type: "session_diff",
            data: evt.properties.diff,
          },
        ], "session.diff")
      }),
    )
  }

  export function dispose() {
    for (const unsub of activeUnsubs) unsub()
    activeUnsubs = []
    for (const [, entry] of queue) clearTimeout(entry.timeout)
    queue.clear()
    inflight.clear()
  }

  export async function create(sessionID: SessionID) {
    if (disabled) return { id: "", url: "", secret: "" }
    log.info("creating share", { sessionID })
    const req = await request()
    const response = await fetch(`${req.baseUrl}${req.api.create}`, {
      method: "POST",
      headers: { ...req.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionID: sessionID }),
    })

    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to create share (${response.status}): ${message || response.statusText}`)
    }

    const result = (await response.json()) as { id: string; url: string; secret: string }

    Database.use((db) =>
      db
        .insert(SessionShareTable)
        .values({ session_id: sessionID, id: result.id, secret: result.secret, url: result.url })
        .onConflictDoUpdate({
          target: SessionShareTable.session_id,
          set: { id: result.id, secret: result.secret, url: result.url },
        })
        .run(),
    )
    void fullSync(sessionID).catch((error) => {
      log.warn("full share sync failed", { sessionID, error })
    })
    return result
  }

  function get(sessionID: SessionID) {
    const row = Database.use((db) =>
      db.select().from(SessionShareTable).where(eq(SessionShareTable.session_id, sessionID)).get(),
    )
    if (!row) return
    return { id: row.id, secret: row.secret, url: row.url }
  }

  type Data =
    | {
        type: "session"
        data: SDK.Session
      }
    | {
        type: "message"
        data: SDK.Message
      }
    | {
        type: "part"
        data: SDK.Part
      }
    | {
        type: "session_diff"
        data: SDK.FileDiff[]
      }
    | {
        type: "model"
        data: SDK.Model[]
      }

  function key(item: Data) {
    switch (item.type) {
      case "session":
        return "session"
      case "message":
        return `message/${item.data.id}`
      case "part":
        return `part/${item.data.messageID}/${item.data.id}`
      case "session_diff":
        return "session_diff"
      case "model":
        return "model"
    }
  }

  const queue = new Map<string, { timeout: NodeJS.Timeout; data: Map<string, Data> }>()
  // Per-session in-flight guard. Between `queue.delete(sessionID)`
  // and the `await fetch()` inside the flush closure, a new sync()
  // for the same sessionID would create a second queue entry — its
  // timer could fire while the first fetch is still in progress,
  // producing duplicate POSTs with overlapping data. This set keeps
  // the second caller merging into a fresh queue entry but blocks
  // its flush until the in-flight one completes.
  const inflight = new Set<string>()
  async function sync(sessionID: SessionID, data: Data[]) {
    if (disabled) return
    const existing = queue.get(sessionID)
    if (existing) {
      for (const item of data) {
        existing.data.set(key(item), item)
      }
      return
    }

    const dataMap = new Map<string, Data>()
    for (const item of data) {
      dataMap.set(key(item), item)
    }

    const flush = () => {
      void (async () => {
        if (inflight.has(sessionID)) return
        const queued = queue.get(sessionID)
        if (!queued) return
        const share = get(sessionID)
        if (!share) {
          queue.delete(sessionID)
          return
        }

        // Keep the queue entry until we know the POST succeeded,
        // and schedule a retry timer on failure. The previous
        // implementation called `queue.delete` up front, so any
        // fetch failure (transient network blip, 5xx from the
        // share server) permanently dropped every message / part
        // accumulated during the 1s debounce window with no retry
        // path. Now we delete on success and re-schedule the
        // flush on failure so data survives transient errors.
        inflight.add(sessionID)
        let success = false
        try {
          const req = await request()
          const response = await fetch(`${req.baseUrl}${req.api.sync(share.id)}`, {
            method: "POST",
            headers: { ...req.headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              secret: share.secret,
              data: Array.from(queued.data.values()),
            }),
          })

          if (!response.ok) {
            log.warn("failed to sync share", { sessionID, shareID: share.id, status: response.status })
          } else {
            success = true
          }
        } finally {
          inflight.delete(sessionID)
          const current = queue.get(sessionID)
          if (success) {
            // Only delete if the queue still points at the same
            // entry we just flushed — a concurrent sync() may have
            // merged new items into it, in which case the entry
            // still holds unsent data that needs a fresh flush
            // timer.
            if (current === queued && current.data.size === queued.data.size) {
              queue.delete(sessionID)
            } else if (current) {
              // Concurrent additions merged in during the fetch.
              // The delta hasn't been flushed — schedule a retry.
              current.timeout = setTimeout(flush, 1000)
            }
          } else if (current) {
            // Failed flush: keep the entry and schedule a retry.
            // 5s backoff so we don't hammer a broken share server.
            current.timeout = setTimeout(flush, 5000)
          }
        }
      })().catch((error) => {
        inflight.delete(sessionID)
        log.warn("share sync timer failed", { sessionID, error })
      })
    }
    const timeout = setTimeout(flush, 1000)
    queue.set(sessionID, { timeout, data: dataMap })
  }

  export async function remove(sessionID: SessionID) {
    if (disabled) return
    log.info("removing share", { sessionID })
    const pending = queue.get(sessionID)
    if (pending) {
      clearTimeout(pending.timeout)
      queue.delete(sessionID)
    }
    const share = get(sessionID)
    if (!share) return

    const req = await request()
    const response = await fetch(`${req.baseUrl}${req.api.remove(share.id)}`, {
      method: "DELETE",
      headers: { ...req.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: share.secret,
      }),
    })

    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to remove share (${response.status}): ${message || response.statusText}`)
    }

    Database.use((db) => db.delete(SessionShareTable).where(eq(SessionShareTable.session_id, sessionID)).run())
  }

  const FULL_SYNC_CHUNK_SIZE = 50

  async function fullSync(sessionID: SessionID) {
    log.info("full sync", { sessionID })
    const session = await Session.get(sessionID)
    const diffs = await Session.diff(sessionID)

    const modelMap = new Map<string, SDK.UserMessage["model"]>()
    const chunks: Data[][] = []
    let chunk: Data[] = []

    for await (const msg of MessageV2.stream(sessionID)) {
      if (msg.info.role === "user") {
        const m = (msg.info as SDK.UserMessage).model
        modelMap.set(`${m.providerID}/${m.modelID}`, m)
      }
      chunk.push({ type: "message", data: msg.info })
      for (const part of msg.parts) chunk.push({ type: "part", data: part })
      if (chunk.length >= FULL_SYNC_CHUNK_SIZE) {
        chunks.push(chunk)
        chunk = []
      }
    }
    if (chunk.length > 0) chunks.push(chunk)

    const models = await Promise.all(
      Array.from(modelMap.values()).map((m) =>
        Provider.getModel(ProviderID.make(m.providerID), ModelID.make(m.modelID)).then((item) => item),
      ),
    )

    // First chunk includes session metadata, models, and diffs
    const first: Data[] = [
      { type: "session", data: session },
      { type: "model", data: models },
      { type: "session_diff", data: diffs },
    ]
    if (chunks.length > 0) first.push(...chunks[0])
    await sync(sessionID, first)

    // Remaining chunks sent sequentially
    for (let i = 1; i < chunks.length; i++) {
      await sync(sessionID, chunks[i])
    }
  }
}
