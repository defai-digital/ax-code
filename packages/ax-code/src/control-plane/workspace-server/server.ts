import { Hono } from "hono"
import { basicAuth } from "hono/basic-auth"
import { streamSSE } from "hono/streaming"

import { GlobalBus } from "@/bus/global"
import { AsyncQueue } from "@/util/queue"
import { Flag } from "@/flag/flag"
import { WorkspaceID } from "../schema"
import { Log } from "@/util/log"
import { assertAuthenticatedNetworkBind } from "@/runtime/listen-security"
import { pushSseFrame } from "@/util/sse-queue"
import { serve, type ServerHandle } from "@/server/runtime-adapter"
import { LEGACY_OPENCODE_WORKSPACE_HEADER } from "@/util/workspace-headers"

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
        const rawWorkspaceID = c.req.header(LEGACY_OPENCODE_WORKSPACE_HEADER)
        const parsedWorkspaceID = WorkspaceID.zod.safeParse(rawWorkspaceID)
        if (!parsedWorkspaceID.success) {
          return c.json({ error: `Missing or invalid ${LEGACY_OPENCODE_WORKSPACE_HEADER} header` }, 400)
        }
        const workspaceID = parsedWorkspaceID.data
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          const q = new AsyncQueue<string | null>()
          let done = false
          let dropped = 0

          q.push(
            JSON.stringify({
              type: "server.connected",
              properties: {},
            }),
          )

          const SSE_MAX_QUEUE = 1024
          const listener = (event: { directory?: string; payload: unknown }) => {
            if (event.directory !== workspaceID) return
            if (q.size >= SSE_MAX_QUEUE) {
              dropped++
              if (dropped === 1 || dropped % 100 === 0) {
                log.warn("workspace SSE queue full; dropping events", {
                  workspaceID,
                  queueSize: q.size,
                  dropped,
                })
              }
              return
            }
            void pushSseFrame(q, event.payload, { maxQueueSize: SSE_MAX_QUEUE })
          }

          const heartbeat = setInterval(() => {
            if (done) return
            if (q.size >= SSE_MAX_QUEUE) return
            q.push(JSON.stringify({ type: "server.heartbeat", properties: {} }))
          }, 10_000)
          heartbeat.unref?.()

          const stop = () => {
            if (done) return
            done = true
            clearInterval(heartbeat)
            GlobalBus.off("event", listener)
            q.push(null)
          }

          GlobalBus.on("event", listener)
          stream.onAbort(stop)

          try {
            for await (const data of q) {
              if (data === null) return
              await stream.writeSSE({ data })
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
    assertAuthenticatedNetworkBind(input.hostname)
    const app = App()
    // SSE-only (no websockets): pass `fetch` so the adapter skips ws wiring.
    return serve({ fetch: app.fetch, hostname: input.hostname, port: input.port })
  }
}
