import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { Hono } from "hono"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import { createIpcTransport } from "@ax-code/sdk/headless-ipc"
import { listenIpc } from "../../src/server/ipc-transport"

describe("ipc server transport", () => {
  let socketPath: string
  let server: Awaited<ReturnType<typeof listenIpc>> | undefined

  beforeEach(async () => {
    socketPath = join(tmpdir(), `ax-code-ipc-server-test-${Date.now()}.sock`)
  })

  afterEach(async () => {
    await server?.stop(true)
    server = undefined
    await rm(socketPath, { force: true })
  })

  function createTestApp(): Hono {
    const app = new Hono()
    app.get("/global/health", (c: any) => c.json({ healthy: true, version: "test" }))
    app.get("/global/capabilities", (c: any) =>
      c.json({
        schemaVersion: 1,
        product: "ax-code",
        version: "test",
        compatibility: {
          minDesktopVersion: null,
          sdkHeadless: {
            schemaVersion: 1,
            supportsManagedLifecycle: true,
            supportsExplicitBinary: true,
            supportsExplicitArgs: true,
            supportsStructuredDiagnostics: true,
            authSchemes: ["basic"],
            defaultTransport: "http-sse",
          },
        },
        endpoints: {
          health: "/global/health",
          events: "/global/event",
          config: "/global/config",
          capabilityCatalog: "/capability",
          fileSearch: "/find/file",
          sessions: "/session",
          providers: "/config/providers",
          agents: "/agent",
        },
        features: {
          sessions: true,
          asyncPrompt: true,
          globalEvents: true,
          fileSearch: true,
          skills: true,
          plugins: true,
          mcp: true,
          worktrees: true,
          providerManagement: true,
          usage: true,
        },
        events: {
          heartbeat: "server.heartbeat",
          connected: "server.connected",
          sessionCreated: "session.created",
          sessionStatus: "session.status",
          sessionError: "session.error",
          permission: "permission",
          question: "question",
        },
      }),
    )
    app.post("/session", async (c: any) => {
      const body = await c.req.json()
      return c.json({ id: "sess-1", title: body.title })
    })
    app.post("/session/:id/prompt_async", async (c: any) => c.json(true))
    app.get("/global/event", (c: any) => {
      const encoder = new TextEncoder()
      const events = [
        { type: "server.connected", properties: {} },
        { type: "session.created", properties: { info: { id: "sess-1", title: "IPC test" } } },
      ]
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const event of events) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
            }
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    })
    return app
  }

  test("routes requests through the Hono app", async () => {
    const app = createTestApp()
    server = await listenIpc({ socketPath, fetch: app.fetch })

    const transport = createIpcTransport({ socketPath })
    try {
      const health = await transport.requestJson<{ healthy: boolean }>({
        path: "/global/health",
        method: "GET",
      })
      expect(health).toEqual({ healthy: true, version: "test" })

      const session = await transport.requestJson<{ id: string; title?: string }>({
        path: "/session",
        method: "POST",
        body: { title: "IPC test" },
      })
      expect(session).toEqual({ id: "sess-1", title: "IPC test" })
    } finally {
      await transport.close?.()
    }
  })

  test("streams SSE events over IPC", async () => {
    const app = createTestApp()
    server = await listenIpc({ socketPath, fetch: app.fetch })

    const transport = createIpcTransport({ socketPath })
    try {
      const received: unknown[] = []
      for await (const event of transport.subscribe()) {
        received.push(event)
        if (received.length === 2) break
      }

      expect(received).toEqual([
        { type: "server.connected", properties: {} },
        { type: "session.created", properties: { info: { id: "sess-1", title: "IPC test" } } },
      ])
    } finally {
      await transport.close?.()
    }
  })
})
