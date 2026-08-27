import { Hono } from "hono"
import { basicAuth } from "hono/basic-auth"
import { streamSSE } from "hono/streaming"

import { GlobalBus } from "@/bus/global"
import { AsyncQueue } from "@/util/queue"
import { Flag } from "@/flag/flag"
import { WorkspaceID } from "../schema"
import { Log } from "@/util/log"
import { assertAuthenticatedNetworkBind, normalizeLoopbackHostname } from "@/runtime/listen-security"
import { encodeSsePayload } from "@/util/sse-queue"
import { serve, type ServerHandle } from "@/server/runtime-adapter"
import type { EventJournalEntry } from "@/bus/event-journal"
import type { GlobalBusEvent } from "@/bus/global"
import {
  AX_CODE_WORKSPACE_HEADER,
  LEGACY_OPENCODE_WORKSPACE_HEADER,
  workspaceHeaderValue,
} from "@/util/workspace-headers"

const log = Log.create({ service: "workspace-server" })

export namespace WorkspaceServer {
  export function App() {
    return new Hono()
      .use((c, next) => {
        const password = Flag.AX_CODE_SERVER_PASSWORD
        if (!password) return next()
        const username = Flag.AX_CODE_SERVER_USERNAME ?? "ax-code"
        return basicAuth({ username, password })(c, next)
      })
      .get("/event", async (c) => {
        const rawWorkspaceID = workspaceHeaderValue((name) => c.req.header(name))
        const parsedWorkspaceID = WorkspaceID.zod.safeParse(rawWorkspaceID)
        if (!parsedWorkspaceID.success) {
          return c.json(
            { error: `Missing or invalid ${AX_CODE_WORKSPACE_HEADER} or ${LEGACY_OPENCODE_WORKSPACE_HEADER} header` },
            400,
          )
        }
        const workspaceID = parsedWorkspaceID.data
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          type QueuedFrame = { data: string; id?: string }
          const q = new AsyncQueue<QueuedFrame | null>()
          let done = false
          let unsubscribe = () => {}

          const SSE_MAX_QUEUE = 1024
          const stop = () => {
            if (done) return
            done = true
            clearInterval(heartbeat)
            unsubscribe()
            q.push(null)
          }

          const listener = (entry: EventJournalEntry<GlobalBusEvent>) => {
            if (entry.value.directory !== workspaceID) return
            if (q.size >= SSE_MAX_QUEUE) {
              log.warn("workspace SSE queue full; disconnecting client for resync", {
                workspaceID,
                queueSize: q.size,
              })
              stop()
              return
            }
            q.push({ data: encodeSsePayload(entry.value.payload), id: entry.id })
          }

          const heartbeat = setInterval(() => {
            if (done) return
            if (q.size >= SSE_MAX_QUEUE) return
            q.push({ data: encodeSsePayload({ type: "server.heartbeat", properties: {} }) })
          }, 10_000)
          heartbeat.unref?.()

          const lastEventID = c.req.header("Last-Event-ID")?.trim() || undefined
          const subscription = GlobalBus.subscribeFrom(lastEventID, listener)
          unsubscribe = subscription.unsubscribe

          if (subscription.replay?.type === "replay") {
            const retained = subscription.replay.entries.filter((entry) => entry.value.directory === workspaceID)
            if (retained.length >= SSE_MAX_QUEUE - 1) {
              q.push({
                data: encodeSsePayload({
                  type: "server.resync_required",
                  properties: {
                    reason: "buffer_overflow",
                    cursor: subscription.replay.cursor,
                  },
                }),
                id: subscription.replay.cursor,
              })
            } else {
              for (const entry of retained) {
                listener(entry)
                if (done) break
              }
            }
          } else if (subscription.replay?.type === "gap") {
            q.push({
              data: encodeSsePayload({
                type: "server.resync_required",
                properties: {
                  reason: subscription.replay.reason,
                  cursor: subscription.replay.cursor,
                },
              }),
              id: subscription.replay.cursor,
            })
          }

          if (!done) {
            q.push({
              data: encodeSsePayload({ type: "server.connected", properties: {} }),
              id: subscription.cursor,
            })
          }
          stream.onAbort(stop)

          try {
            for await (const data of q) {
              if (data === null) return
              await stream.writeSSE(data)
            }
          } finally {
            stop()
          }
        })
      })
  }

  // Intentionally not `async`: the bind-security check must throw
  // synchronously (a test asserts `expect(() => Listen(...)).toThrow()`).
  // The actual bind is async (Node), so we return the serve() promise.
  export function Listen(input: { hostname: string; port: number }): Promise<ServerHandle> {
    const hostname = normalizeLoopbackHostname(input.hostname)
    assertAuthenticatedNetworkBind(hostname)
    const app = App()
    // SSE-only (no websockets): pass `fetch` so the adapter skips ws wiring.
    return serve({ fetch: app.fetch, hostname, port: input.port })
  }
}
