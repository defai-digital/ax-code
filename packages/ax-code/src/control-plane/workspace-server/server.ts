import { Hono } from "hono"
import { basicAuth } from "hono/basic-auth"
import { streamSSE } from "hono/streaming"

import { GlobalBus, type GlobalBusEvent } from "@/bus/global"
import { Flag } from "@/flag/flag"
import { WorkspaceID } from "../schema"
import { Log } from "@/util/log"
import { assertAuthenticatedNetworkBind, normalizeLoopbackHostname } from "@/runtime/listen-security"
import { encodeSsePayload } from "@/util/sse-queue"
import { serve, type ServerHandle } from "@/server/runtime-adapter"
import { EventStream } from "@/server/event-stream"
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
        return streamSSE(c, (stream) =>
          EventStream.run<GlobalBusEvent>(stream, {
            label: "workspace",
            cursor: c.req.header("Last-Event-ID")?.trim() || undefined,
            subscribe: (cursor, listener) => GlobalBus.subscribeFrom(cursor, listener),
            filter: (event) => event.directory === workspaceID,
            project: (entry) => ({ data: encodeSsePayload(entry.value.payload), id: entry.id }),
            maxQueueSize: 1024,
            heartbeatQueueLimit: 1024,
          }),
        )
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
