import { Hono } from "hono"
import { basicAuth } from "hono/basic-auth"
import { streamSSE } from "hono/streaming"

import { GlobalBus } from "@/bus/global"
import { AsyncQueue } from "@/util/queue"
import { Flag } from "@/flag/flag"

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
        const workspaceID = c.req.header("x-opencode-workspace")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          const q = new AsyncQueue<string | null>()
          let done = false

          q.push(
            JSON.stringify({
              type: "server.connected",
              properties: {},
            }),
          )

          const SSE_MAX_QUEUE = 1024
          const listener = (event: { directory?: string; payload: unknown }) => {
            if (workspaceID && event.directory && event.directory !== workspaceID) return
            if (q.size >= SSE_MAX_QUEUE) return // backpressure: drop events when queue is full
            q.push(JSON.stringify(event.payload))
          }

          const heartbeat = setInterval(() => {
            if (done) return
            q.push(JSON.stringify({ type: "server.heartbeat", properties: {} }))
          }, 10_000)

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

  export function Listen(input: { hostname: string; port: number }) {
    const app = App()
    const server = Bun.serve({
      hostname: input.hostname,
      port: input.port,
      fetch: app.fetch,
    })
    return {
      hostname: server.hostname,
      port: server.port,
      stop: async () => server.stop(),
    }
  }
}
