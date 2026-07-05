import { describe, expect, it } from "vitest"

import { registerNotificationRoutes } from "./lib/notifications/routes.js"
import { registerScheduledTaskRoutes } from "./lib/scheduled-tasks/routes.js"
import { createMockRequest, createMockResponse, createRouteRegistry } from "./test-helpers/route-harness.js"

describe("local SSE routes", () => {
  it("serves notification SSE with nginx-safe headers", async () => {
    const { app, getRoute } = createRouteRegistry()
    const clients = new Set()

    registerNotificationRoutes(app, {
      uiAuthController: {
        ensureSessionToken: async () => "ui-token",
      },
      getUiSessionTokenFromRequest: () => "ui-token",
      getUiNotificationClients: () => clients,
      writeSseEvent(res, payload) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
      },
    })

    const handler = getRoute("GET", "/api/notifications/stream")
    const req = createMockRequest()
    const res = createMockResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.getHeader("content-type")).toContain("text/event-stream")
    expect(res.getHeader("cache-control")).toBe("no-cache, no-transform")
    expect(res.getHeader("connection")).toBe("keep-alive")
    expect(res.getHeader("x-accel-buffering")).toBe("no")
    expect(res.flushed).toBe(true)
    expect(res.body).toContain("openchamber:notification-stream-ready")
    expect(clients.has(res)).toBe(true)

    req.emit("close")
    expect(clients.has(res)).toBe(false)
  })

  it("serves OpenChamber SSE with nginx-safe headers", () => {
    const { app, getRoute } = createRouteRegistry()
    const clients = new Set()

    registerScheduledTaskRoutes(app, {
      getOpenChamberEventClients: () => clients,
      writeSseEvent(res, payload) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
      },
    })

    const handler = getRoute("GET", "/api/openchamber/events")
    const req = createMockRequest()
    const res = createMockResponse()

    handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.getHeader("content-type")).toContain("text/event-stream")
    expect(res.getHeader("cache-control")).toBe("no-cache, no-transform")
    expect(res.getHeader("connection")).toBe("keep-alive")
    expect(res.getHeader("x-accel-buffering")).toBe("no")
    expect(res.flushed).toBe(true)
    expect(res.body).toContain("openchamber:event-stream-ready")
    expect(clients.has(res)).toBe(true)

    req.emit("close")
    expect(clients.has(res)).toBe(false)
  })
})
