import { expect, test, vi } from "vitest"
import { Hono } from "hono"
import { Pty } from "../../src/pty"
import { PtyID } from "../../src/pty/schema"
import { PtyRoutes } from "../../src/server/routes/pty"
import { serve } from "../../src/server/runtime-adapter"

test("PTY route upgrades a real socket and forwards replay, input, and close", async () => {
  const id = PtyID.make("pty_websocket_qualification")
  const get = vi.spyOn(Pty, "get").mockResolvedValue({
    id,
    title: "test",
    command: "test",
    args: [],
    cwd: process.cwd(),
    status: "running",
    pid: 1,
  })
  const onClose = vi.fn()
  const connect = vi.spyOn(Pty, "connect").mockImplementation(async (_id, socket, cursor) => {
    socket.send("ready:" + cursor)
    return { onMessage: (message) => socket.send("reply:" + String(message)), onClose }
  })
  const app = new Hono().route("/pty", PtyRoutes())
  const server = await serve({ app, hostname: "127.0.0.1", port: 0 })
  const socket = new WebSocket("ws://127.0.0.1:" + server.port + "/pty/" + id + "/connect?cursor=7")
  try {
    const output: string[] = []
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("PTY socket roundtrip timed out")), 5000)
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error("PTY upgrade failed"))
      }
      socket.onmessage = (event) => {
        output.push(String(event.data))
        if (event.data === "ready:7") socket.send("input")
        if (event.data === "reply:input") {
          clearTimeout(timer)
          resolve()
        }
      }
    })
    expect(output).toEqual(["ready:7", "reply:input"])
    expect(get).toHaveBeenCalledWith(id)
    expect(connect).toHaveBeenCalledWith(id, expect.anything(), 7)
    socket.close()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  } finally {
    socket.close()
    await server.stop(true)
    get.mockRestore()
    connect.mockRestore()
  }
})
