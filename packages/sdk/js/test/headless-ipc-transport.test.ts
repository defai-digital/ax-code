import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import { createIpcTransport } from "../src/headless/ipc-transport.js"
import { readIpcMessages, writeIpcMessage } from "../src/headless/ipc-protocol.js"
import type { IpcRequestMessage } from "../src/headless/ipc-protocol.js"

describe("ipc transport client", () => {
  let server: Server
  let socketPath: string
  let lastRequest: IpcRequestMessage | undefined
  const sockets = new Set<Socket>()

  beforeEach(async () => {
    socketPath = join(tmpdir(), `ax-code-ipc-client-test-${Date.now()}.sock`)
    lastRequest = undefined
    sockets.clear()
    server = createServer((socket) => {
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
      handleSocket(socket)
    })
    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  })

  afterEach(async () => {
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    server.close()
    await rm(socketPath, { force: true })
  })

  function handleSocket(socket: Socket) {
    handleSocketMessages(socket).catch(() => undefined)
  }

  async function handleSocketMessages(socket: Socket) {
    try {
      for await (const message of readIpcMessages(socket)) {
        if (message.type === "request") {
          lastRequest = message
          if (message.path === "/global/health") {
            await writeIpcMessage(socket, {
              type: "response",
              id: message.id,
              status: 200,
              body: { healthy: true },
            })
          } else if (message.path === "/session") {
            await writeIpcMessage(socket, {
              type: "response",
              id: message.id,
              status: 200,
              body: { id: "sess-1" },
            })
          } else if (message.path === "/error") {
            await writeIpcMessage(socket, {
              type: "error",
              id: message.id,
              code: "TEST_ERROR",
              message: "something went wrong",
            })
          } else if (message.path === "/not-found") {
            await writeIpcMessage(socket, {
              type: "response",
              id: message.id,
              status: 404,
              body: { error: "missing" },
            })
          } else if (message.path === "/session/sess-1/prompt_async") {
            await writeIpcMessage(socket, {
              type: "response",
              id: message.id,
              status: 202,
            })
          } else if (message.path === "/session/sess-1/abort") {
            await writeIpcMessage(socket, {
              type: "response",
              id: message.id,
              status: 200,
              body: true,
            })
          } else {
            await writeIpcMessage(socket, {
              type: "response",
              id: message.id,
              status: 200,
              body: true,
            })
          }
        }
      }
    } finally {
      socket.destroy()
    }
  }

  test("round-trips a request and response", async () => {
    const transport = createIpcTransport({ socketPath })
    try {
      const health = await transport.requestJson<{ healthy: boolean }>({
        path: "/global/health",
        method: "GET",
      })
      expect(health).toEqual({ healthy: true })
      expect(lastRequest?.method).toBe("GET")
      expect(lastRequest?.path).toBe("/global/health")
    } finally {
      await transport.close?.()
    }
  })

  test("includes directory and workspace headers", async () => {
    const transport = createIpcTransport({
      socketPath,
      directory: "/tmp/project",
      experimental_workspaceID: "ws-1",
    })
    try {
      await transport.requestJson<unknown>({ path: "/session", method: "POST" })
      expect(lastRequest?.headers?.["x-ax-code-directory"]).toBe("/tmp/project")
      expect(lastRequest?.headers?.["x-ax-code-workspace-id"]).toBe("ws-1")
    } finally {
      await transport.close?.()
    }
  })

  test("propagates error responses", async () => {
    const transport = createIpcTransport({ socketPath })
    try {
      await expect(transport.requestJson<unknown>({ path: "/error", method: "GET" })).rejects.toThrow(
        "something went wrong",
      )
    } finally {
      await transport.close?.()
    }
  })

  test("rejects non-ok route responses", async () => {
    const transport = createIpcTransport({ socketPath })
    try {
      await expect(transport.requestJson<unknown>({ path: "/not-found", method: "GET" })).rejects.toThrow(
        'Headless runtime request failed (404): {"error":"missing"}',
      )
    } finally {
      await transport.close?.()
    }
  })

  test("preserves command response status", async () => {
    const transport = createIpcTransport({ socketPath })
    try {
      await expect(
        transport.sendCommand({
          type: "session.prompt",
          mode: "async",
          sessionID: "sess-1",
          body: { parts: [] },
        }),
      ).resolves.toEqual({ accepted: true, status: 202 })

      await expect(
        transport.sendCommand({
          type: "session.abort",
          sessionID: "sess-1",
        }),
      ).resolves.toEqual({ accepted: true, status: 200, body: true })
    } finally {
      await transport.close?.()
    }
  })

  test("yields events pushed by the server", async () => {
    const transport = createIpcTransport({ socketPath })
    try {
      // Ensure the connection handshake is complete before subscribing.
      await transport.requestJson<unknown>({ path: "/global/health", method: "GET" })

      const events = [{ type: "server.connected" }, { type: "session.created", properties: { info: { id: "sess-1" } } }]

      const received: unknown[] = []
      const subscription = transport.subscribe()

      // Broadcast events after the subscription is active.
      await new Promise((resolve) => setTimeout(resolve, 50))
      for (const event of events) {
        for (const socket of sockets) {
          await writeIpcMessage(socket, { type: "event", event })
        }
      }

      for await (const event of subscription) {
        received.push(event)
        if (received.length === events.length) break
      }

      expect(received).toEqual(events)
    } finally {
      await transport.close?.()
    }
  })
})
