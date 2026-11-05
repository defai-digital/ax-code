import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { Hono } from "hono"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import { connect, type Socket } from "node:net"
import { createIpcTransport } from "@ax-code/sdk/headless-ipc"
import { listenIpc, resolveIpcSocketPath, IpcConnection } from "../../src/server/ipc-transport"
import {
  IPC_MAX_FRAME_BYTES,
  IpcFrameTooLargeError,
  decodeIpcFrames,
  encodeIpcMessage,
  readIpcMessages,
  writeIpcMessage,
  type IpcMessage,
} from "../../src/server/ipc-protocol"

const SSE_FRAME_LIMIT_CHARACTERS = 16 * 1024 * 1024

function eventConnection(fetch: (request: Request) => Promise<Response>, options: { stalledWrites?: boolean } = {}) {
  const disconnected = Promise.withResolvers<void>()
  const frames: IpcMessage[] = []
  const socket = {
    destroyed: false,
    write(chunk: Buffer, callback: (error?: Error) => void) {
      frames.push(...decodeIpcFrames(chunk).messages)
      if (!options.stalledWrites) callback()
      return true
    },
    destroy() {
      socket.destroyed = true
      disconnected.resolve()
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
      await disconnected.promise
    },
  }
  const connection = new IpcConnection(fetch, socket as unknown as Socket)
  const handled = connection.handle()
  return {
    frames,
    isClosed: () => socket.destroyed,
    async close() {
      disconnected.resolve()
      await handled
    },
  }
}

describe("ipc event subscription recovery", () => {
  test("delivers CR-only frames before the upstream closes or sends more bytes", async () => {
    vi.useFakeTimers()
    const event = { type: "server.connected", properties: {} }
    const connection = eventConnection(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\r\r`))
            },
          }),
        ),
    )
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(connection.frames).toEqual([{ type: "event", event }])
    } finally {
      await connection.close()
      vi.useRealTimers()
    }
  })

  test.each(["", "\n\n"])("cancels an oversized upstream SSE frame with suffix %j", async (suffix) => {
    vi.useFakeTimers()
    const cancelled = vi.fn()
    const connection = eventConnection(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(`data: ${"x".repeat(SSE_FRAME_LIMIT_CHARACTERS)}${suffix}`))
            },
            cancel: cancelled,
          }),
        ),
    )
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(cancelled).toHaveBeenCalledTimes(1)
      expect(connection.frames).toEqual([])
    } finally {
      await connection.close()
      vi.useRealTimers()
    }
  })

  test("limits each frame rather than the aggregate replay chunk", async () => {
    vi.useFakeTimers()
    const event = { type: "message.updated", properties: { text: "x".repeat(SSE_FRAME_LIMIT_CHARACTERS / 2) } }
    const connection = eventConnection(async () => new Response(`data: ${JSON.stringify(event)}\n\n`.repeat(2)))
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(connection.frames).toHaveLength(2)
      expect(connection.frames.every((frame) => frame.type === "event" && frame.event !== undefined)).toBe(true)
    } finally {
      await connection.close()
      vi.useRealTimers()
    }
  })

  test("a peer that stops reading is disconnected without accumulating new subscriptions", async () => {
    vi.useFakeTimers()
    let calls = 0
    const connection = eventConnection(
      async () => {
        calls++
        return new Response('data: {"type":"server.connected","properties":{}}\n\n')
      },
      { stalledWrites: true },
    )
    try {
      await vi.advanceTimersByTimeAsync(60_251)
      expect(connection.isClosed()).toBe(true)
      expect(calls).toBe(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await connection.close()
      vi.useRealTimers()
    }
  })

  test("SSE CRLF framing survives every transport split", async () => {
    vi.useFakeTimers()
    const event = { type: "server.connected", properties: { split: true } }
    const bytes = new TextEncoder().encode(`id: cursor\r\ndata: ${JSON.stringify(event)}\r\n\r\n`)
    try {
      for (let split = 1; split < bytes.length; split++) {
        const connection = eventConnection(
          async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(bytes.slice(0, split))
                  controller.enqueue(bytes.slice(split))
                  controller.close()
                },
              }),
            ),
        )
        try {
          await vi.advanceTimersByTimeAsync(0)
          expect(connection.frames, `split ${split}`).toEqual([{ type: "event", event }])
        } finally {
          await connection.close()
          await vi.advanceTimersByTimeAsync(0)
        }
      }
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test("disconnect cancels an idle SSE subscription immediately", async () => {
    const cancelled = vi.fn()
    let request!: Request
    const connection = eventConnection(async (input) => {
      request = input
      return new Response(new ReadableStream({ cancel: cancelled }))
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await connection.close()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(request.signal.aborted).toBe(true)
    expect(cancelled).toHaveBeenCalledTimes(1)
  })

  test("retries temporary HTTP failures and resumes the delivered cursor", async () => {
    vi.useFakeTimers()
    let calls = 0
    const cursors: Array<string | null> = []
    const cancelled = vi.fn()
    const connection = eventConnection(async (request) => {
      cursors.push(request.headers.get("Last-Event-ID"))
      if (++calls === 1) return new Response(new ReadableStream({ cancel: cancelled }), { status: 503 })
      if (calls === 2) return new Response('id: delivered\ndata: {"type":"server.connected","properties":{}}\n\n')
      return new Response(new ReadableStream())
    })
    try {
      await vi.advanceTimersByTimeAsync(501)
      expect(calls).toBe(3)
      expect(cursors).toEqual([null, null, "delivered"])
      expect(cancelled).toHaveBeenCalledTimes(1)
      expect(connection.frames).toHaveLength(1)
    } finally {
      await connection.close()
      vi.useRealTimers()
    }
  })

  test.each(["fetch", "idle"])("recovers a stalled %s and stops cleanly", async (stage) => {
    vi.useFakeTimers()
    let calls = 0
    const connection = eventConnection(async () => {
      calls++
      if (stage === "fetch") return new Promise<Response>(() => {})
      return new Response(new ReadableStream())
    })
    try {
      await vi.advanceTimersByTimeAsync(stage === "fetch" ? 10_251 : 60_251)
      expect(calls).toBe(2)
      await connection.close()
      await vi.advanceTimersByTimeAsync(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await connection.close()
      vi.useRealTimers()
    }
  })
})

describe("ipc server transport", () => {
  let socketPath: string
  let server: Awaited<ReturnType<typeof listenIpc>> | undefined

  beforeEach(async () => {
    socketPath = join(canonicalTmpdir(), `ax-code-ipc-server-test-${Date.now()}.sock`)
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

  test("resolves socket paths through the canonical parent directory", () => {
    expect(resolveIpcSocketPath(join(tmpdir(), "ax-code-ipc-server-test.sock"))).toBe(
      join(canonicalTmpdir(), "ax-code-ipc-server-test.sock"),
    )
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
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timed out waiting for IPC event")), 1_000),
        ),
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

  test("closes the connection when a frame header exceeds the maximum size", async () => {
    const app = new Hono()
    const routedPaths: string[] = []
    app.get("/global/health", (c: any) => {
      routedPaths.push(new URL(c.req.url).pathname)
      return c.json({ healthy: true })
    })
    server = await listenIpc({ socketPath, fetch: app.fetch })

    const socket = await connectSocket(socketPath)
    try {
      const header = Buffer.alloc(4)
      header.writeUInt32BE(IPC_MAX_FRAME_BYTES + 1, 0)
      socket.write(header)

      const closed = await new Promise<boolean>((resolve) => {
        socket.once("close", () => resolve(true))
        setTimeout(() => resolve(false), 2_000)
      })

      expect(closed).toBe(true)
      // The oversized frame must never reach the router.
      expect(routedPaths).toEqual([])
    } finally {
      socket.destroy()
    }
  })
})

describe("ipc protocol frame cap", () => {
  test("decodeIpcFrames rejects a header above IPC_MAX_FRAME_BYTES", () => {
    const header = Buffer.alloc(4)
    header.writeUInt32BE(IPC_MAX_FRAME_BYTES + 1, 0)
    const buffer = Buffer.concat([header, Buffer.from([0x01, 0x02, 0x03])])

    expect(() => decodeIpcFrames(buffer)).toThrow(IpcFrameTooLargeError)
  })

  test("encode/decode round-trips a normal message", () => {
    const message: IpcMessage = {
      type: "request",
      id: "round-trip",
      method: "GET",
      path: "/global/health",
    }

    const frame = encodeIpcMessage(message)
    const { messages, remaining } = decodeIpcFrames(Buffer.from(frame))

    expect(messages).toEqual([message])
    expect(remaining.length).toBe(0)
  })
})

function canonicalTmpdir(): string {
  try {
    return realpathSync(tmpdir())
  } catch {
    return tmpdir()
  }
}

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

test("an oversized frame tears the connection down even when the refusal reply cannot be written", async () => {
  // A peer that stopped reading never drains its receive buffer, so the socket
  // write callback never fires. Teardown must not wait on the courtesy reply.
  const socket = {
    destroyed: false,
    write: () => false,
    destroy() {
      socket.destroyed = true
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
      throw new IpcFrameTooLargeError(IPC_MAX_FRAME_BYTES + 1, IPC_MAX_FRAME_BYTES)
    },
  }
  const connection = new IpcConnection(async () => new Response(null, { status: 404 }), socket as unknown as Socket)
  const outcome = await Promise.race([
    connection.handle().then(() => "handled"),
    new Promise<string>((resolve) => setTimeout(() => resolve("stalled"), 2_000)),
  ])
  expect(outcome).toBe("handled")
  expect(socket.destroyed).toBe(true)
})
