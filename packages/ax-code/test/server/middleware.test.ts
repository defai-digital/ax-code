import { describe, expect, test, vi } from "vitest"
import { resolveRateLimitClientIP } from "../../src/server/middleware"

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
})
