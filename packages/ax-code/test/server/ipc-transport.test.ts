import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { Hono } from "hono"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import { connect, type Socket } from "node:net"
import { createIpcTransport } from "@ax-code/sdk/headless-ipc"
import { listenIpc } from "../../src/server/ipc-transport"
import { readIpcMessages, writeIpcMessage, type IpcMessage } from "../../src/server/ipc-protocol"

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
    app.get("/global/event", () => {
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

  test("forwards trailing SSE events at EOF", async () => {
    const event = { type: "server.connected", properties: { eof: true } }
    const encoder = new TextEncoder()
    const app = new Hono()
    app.get("/global/event", () => {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}`))
            controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    })
    server = await listenIpc({ socketPath, fetch: app.fetch })

    const transport = createIpcTransport({ socketPath })
    try {
      const subscription = transport.subscribe()[Symbol.asyncIterator]()
      const next = await Promise.race([
        subscription.next(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out waiting for IPC event")), 1_000)),
      ])
      expect(next).toEqual({ value: event, done: false })
    } finally {
      await transport.close?.()
    }
  })

  test("rejects malformed requests without routing or closing the connection", async () => {
    const app = new Hono()
    const routedPaths: string[] = []
    app.get("/global/health", (c: any) => {
      routedPaths.push(new URL(c.req.url).pathname)
      return c.json({ healthy: true })
    })
    server = await listenIpc({ socketPath, fetch: app.fetch })

    const socket = await connectSocket(socketPath)
    try {
      const messages = readIpcMessages(socket)[Symbol.asyncIterator]()
      await writeIpcMessage(socket, {
        type: "request",
        id: "bad",
        method: "GET",
      } as any)
      await writeIpcMessage(socket, {
        type: "request",
        id: "good",
        method: "GET",
        path: "/global/health",
      })

      const bad = await nextIpcMessage(messages)
      const good = await nextIpcMessage(messages)

      expect(bad).toMatchObject({
        type: "error",
        id: "bad",
        code: "IPC_INVALID_REQUEST",
      })
      expect(good).toEqual({
        type: "response",
        id: "good",
        status: 200,
        body: { healthy: true },
      })
      expect(routedPaths).toEqual(["/global/health"])
    } finally {
      socket.destroy()
    }
  })
})

function connectSocket(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath, () => {
      socket.off("error", reject)
      resolve(socket)
    })
    socket.once("error", reject)
  })
}

async function nextIpcMessage(iterator: AsyncIterator<IpcMessage>): Promise<IpcMessage> {
  const result = await Promise.race([
    iterator.next(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out waiting for IPC message")), 1_000)),
  ])
  if (result.done) throw new Error("IPC stream ended before the next message")
  return result.value
}
