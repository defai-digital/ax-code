import { Hono } from "hono"
import { streamSSE } from "hono/streaming"

import { GlobalBus } from "@/bus/global"
import { AsyncQueue } from "@/util/queue"

export namespace WorkspaceServer {
  export function App() {
    return new Hono().get("/event", async (c) => {
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

        const listener = (event: { directory?: string; payload: unknown }) => {
          if (workspaceID && event.directory && event.directory !== workspaceID) return
          q.push(JSON.stringify(event.payload))
        }

        const stop = () => {
          if (done) return
          done = true
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
