import { describe, expect, test, vi } from "vitest"
import { Hono } from "hono"
import { createRateLimitMiddleware, resolveRateLimitClientIP } from "../../src/server/middleware"
import { Log } from "../../src/util/log"

describe("server middleware", () => {
  test("resolves Node.js client IP from Hono node-server incoming socket", () => {
    const warn = vi.fn()
    const context = {
      env: {
        server: {
          incoming: {
            socket: {
              remoteAddress: "203.0.113.10",
              remotePort: 12345,
              remoteFamily: "IPv4",
            },
          },
        },
      },
      req: { raw: {} },
    }

    expect(
      resolveRateLimitClientIP({
        context: context as any,
        log: { warn } as any,
        warnOnce: () => true,
      }),
    ).toBe("203.0.113.10")
    expect(warn).not.toHaveBeenCalled()
  })

  test("skips client IP resolution without a Hono node-server binding", () => {
    const warn = vi.fn()
    const context = {
      env: {},
      req: { raw: {} },
    }

    expect(
      resolveRateLimitClientIP({
        context: context as any,
        log: { warn } as any,
        warnOnce: () => true,
      }),
    ).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  test("ordinary session requests do not use up the fast-accept prompt quota", async () => {
    const app = new Hono()
      .use(createRateLimitMiddleware(Log.create({ service: "test.rate-limit" })))
      .post("/session/:id/message", (c) => c.text("ok"))
      .post("/session/:id/prompt_async", (c) => c.text("ok"))
    for (let i = 0; i < 30; i++) {
      expect((await app.request("/session/ses_a/message", { method: "POST" })).status).toBe(200)
    }
    expect((await app.request("/session/ses_a/prompt_async", { method: "POST" })).status).toBe(200)
  })
})
