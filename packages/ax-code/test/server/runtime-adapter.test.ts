import { describe, expect, test } from "vitest"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { serve, upgradeWebSocket } from "../../src/server/runtime-adapter"

// Covers the runtime adapter on the test runtime (Bun: Bun.serve + hono/bun).
//
// The full websocket *round-trip* is validated by script/poc-ws-spike.ts on
// BOTH runtimes (Bun via hono/bun, Node via @hono/node-ws). It is not asserted
// here because hono/bun's upgradeWebSocket does not deliver messages under the
// `bun test` runner specifically (raw Bun.serve websockets do — so this is a
// test-runner/hono-bun interaction, not a production issue: the production
// `bun` runtime round-trips correctly, per the spike). These tests cover the
// adapter logic `bun test` can exercise reliably: HTTP serve, ws-route
// registration, the EADDRINUSE reject contract, and input validation.

describe("server/runtime-adapter", () => {
  test("serves HTTP on an app that also registers a websocket route", async () => {
    // Registering a ws route via the adapter's upgradeWebSocket must not break
    // the app, and the ws-capable serve path must still serve plain HTTP.
    const app = new Hono()
      .get("/health", (c) => c.text("ok"))
      .get(
        "/ws",
        upgradeWebSocket(() => ({
          onMessage(evt, ws) {
            ws.send(`echo:${evt.data}`)
          },
        })),
      )
    const server = await serve({ app, hostname: "127.0.0.1", port: 0 })
    try {
      expect(server.port).toBeGreaterThan(0)
      const res = await fetch(`http://127.0.0.1:${server.port}/health`)
      expect(await res.text()).toBe("ok")
    } finally {
      await server.stop()
    }
  })

  test("serves an HTTP-only fetch handler (no Hono app, no ws)", async () => {
    const server = await serve({
      fetch: (req) => new Response(`pong:${new URL(req.url).pathname}`),
      hostname: "127.0.0.1",
      port: 0,
    })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/cb`)
      expect(await res.text()).toBe("pong:/cb")
    } finally {
      await server.stop()
    }
  })

  test("force-stops while an SSE response is still open", async () => {
    const app = new Hono().get("/stream", (c) =>
      streamSSE(c, async (stream) => {
        await stream.writeSSE({ data: "ready" })
        await new Promise<void>((resolve) => stream.onAbort(resolve))
      }),
    )
    const server = await serve({ app, hostname: "127.0.0.1", port: 0 })
    const request = new AbortController()
    let stopping: Promise<void> | undefined

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/stream`, { signal: request.signal })
      const reader = response.body?.getReader()
      expect(reader).toBeDefined()
      expect((await reader!.read()).done).toBe(false)

      stopping = server.stop(true)
      let timer: ReturnType<typeof setTimeout> | undefined
      const stopped = await Promise.race([
        stopping.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 500)
        }),
      ])
      if (timer) clearTimeout(timer)
      expect(stopped).toBe(true)
    } finally {
      request.abort()
      await (stopping ?? server.stop(true))
    }
  })

  test("rejects when the requested port is already in use", async () => {
    const first = await serve({
      fetch: () => new Response("ok"),
      hostname: "127.0.0.1",
      port: 0,
    })
    try {
      await expect(
        serve({ fetch: () => new Response("ok"), hostname: "127.0.0.1", port: first.port }),
      ).rejects.toBeDefined()
    } finally {
      await first.stop()
    }
  })

  test("requires either an app or a fetch handler", async () => {
    await expect(serve({ hostname: "127.0.0.1", port: 0 })).rejects.toThrow(/requires either/)
  })
})
