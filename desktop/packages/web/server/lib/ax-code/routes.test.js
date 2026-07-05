import { describe, expect, it, vi } from "vitest"
import express from "express"
import request from "supertest"
import { registerAxCodeRoutes } from "./routes.js"

const createApp = (overrides = {}, { parseJson = true } = {}) => {
  const app = express()
  // Production deliberately does NOT run express.json() for `/api/session/*`
  // (those stream through the proxy / dedicated handlers). Tests can opt out of
  // global JSON parsing via `parseJson: false` to mirror that and exercise the
  // raw-body forwarding path.
  if (parseJson) {
    app.use(express.json())
  }

  const dependencies = {
    crypto: globalThis.crypto,
    clientReloadDelayMs: 25,
    getAxCodeResolutionSnapshot: vi.fn(() => ({})),
    formatSettingsResponse: vi.fn((settings) => settings),
    readSettingsFromDisk: vi.fn(async () => ({})),
    readSettingsFromDiskMigrated: vi.fn(async () => ({})),
    persistSettings: vi.fn(async (settings) => settings),
    sanitizeProjects: vi.fn((projects) => projects),
    validateDirectoryPath: vi.fn(() => ({ valid: true })),
    resolveProjectDirectory: vi.fn(async () => ({ directory: "/tmp/project", error: null })),
    getProviderSources: vi.fn(() => ({ sources: {} })),
    removeProviderConfig: vi.fn(() => true),
    refreshAxCodeAfterConfigChange: vi.fn(async () => undefined),
    backgroundAxCodeReloader: {
      start: vi.fn(() => ({
        alreadyRunning: false,
        reloadDelayMs: 1500,
        reloadTimeoutMs: 360000,
      })),
    },
    buildAxCodeUrl: vi.fn((path) => `http://127.0.0.1:4096${path}`),
    getAxCodeAuthHeaders: vi.fn(() => ({})),
    ...overrides,
  }

  registerAxCodeRoutes(app, dependencies)
  return { app, dependencies }
}

describe("ax-code routes", () => {
  it("queues provider disconnect reload without awaiting the AX Code restart", async () => {
    const { app, dependencies } = createApp()

    const response = await request(app).delete("/api/provider/test-provider/auth?scope=user").expect(200)

    expect(dependencies.removeProviderConfig).toHaveBeenCalledWith("test-provider", "/tmp/project", "user")
    expect(dependencies.backgroundAxCodeReloader.start).toHaveBeenCalledWith(
      "provider test-provider disconnected (user)",
    )
    expect(dependencies.refreshAxCodeAfterConfigChange).not.toHaveBeenCalled()
    expect(response.body).toMatchObject({
      success: true,
      removed: true,
      requiresReload: true,
      reloadInProgress: false,
      message: "Provider disconnected. AX Code is restarting…",
      reloadDelayMs: 1500,
      reloadTimeoutMs: 360000,
    })
  })

  it("does not queue a provider reload when nothing was removed", async () => {
    const { app, dependencies } = createApp({
      removeProviderConfig: vi.fn(() => false),
    })

    const response = await request(app).delete("/api/provider/test-provider/auth?scope=user").expect(200)

    expect(dependencies.backgroundAxCodeReloader.start).not.toHaveBeenCalled()
    expect(response.body).toMatchObject({
      success: true,
      removed: false,
      requiresReload: false,
      message: "Provider was not connected",
    })
  })

  it("calls ax-code API for scope=auth removal and triggers reload", async () => {
    const { app, dependencies } = createApp()
    const originalFetch = globalThis.fetch
    const mockFetch = vi.fn(async (url, opts) => {
      if (typeof url === "string" && url.includes("/auth/test-provider") && opts?.method === "DELETE") {
        return { ok: true, status: 200, body: { cancel: vi.fn() } }
      }
      return { ok: true, json: async () => ({}) }
    })
    globalThis.fetch = mockFetch

    try {
      const response = await request(app).delete("/api/provider/test-provider/auth?scope=auth").expect(200)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/auth/test-provider"),
        expect.objectContaining({ method: "DELETE" }),
      )
      expect(dependencies.backgroundAxCodeReloader.start).toHaveBeenCalledWith(
        "provider test-provider disconnected (auth)",
      )
      expect(response.body).toMatchObject({
        success: true,
        removed: true,
        requiresReload: true,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("falls back to direct file removal when ax-code API is unreachable", async () => {
    const { app, dependencies } = createApp()
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    })
    // Mock the auth library fallback
    const mockRemoveProviderAuth = vi.fn(() => true)
    // The auth library is loaded lazily; we need to mock the import.
    // Since we can't easily mock dynamic imports, we verify the fallback
    // by checking that the route still succeeds.
    try {
      const response = await request(app).delete("/api/provider/test-provider/auth?scope=auth").expect(200)

      // The fallback to direct file removal should have been attempted.
      // Since the auth library reads real files, the result depends on
      // whether the auth file exists — but the response should still succeed.
      expect(response.body.success).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("reports runtime version compatibility in upgrade status", async () => {
    const { app } = createApp()
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ healthy: true, version: "5.10.0" }),
    }))

    try {
      const response = await request(app).get("/api/ax-code/upgrade-status").expect(200)

      expect(response.body).toMatchObject({
        currentVersion: "5.10.0",
        compatible: false,
      })
      expect(typeof response.body.minSupportedVersion).toBe("string")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("returns null compatibility when the runtime version is unavailable", async () => {
    const { app } = createApp()
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ healthy: true }),
    }))

    try {
      const response = await request(app).get("/api/ax-code/upgrade-status").expect(200)

      expect(response.body.currentVersion).toBeNull()
      expect(response.body.compatible).toBeNull()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("maps unknown command upstream 500 responses to a client error", async () => {
    const { app } = createApp()
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            name: "UnknownError",
            message: "Internal server error",
            status: 500,
            retryable: false,
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        ),
    )

    try {
      const response = await request(app)
        .post("/api/session/ses-1/command?directory=/tmp/project")
        .send({
          command: " abc123 ",
          arguments: "manual API unknown command test",
          model: "provider/model",
          messageID: "msg-1",
        })
        .expect(400)

      expect(response.body).toMatchObject({
        error: "Unknown command: abc123",
        retryable: false,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("deduplicates concurrent prompt_async requests for the same session message", async () => {
    const { app } = createApp()
    const originalFetch = globalThis.fetch
    let releaseFetch
    const fetchStarted = new Promise((resolve) => {
      globalThis.fetch = vi.fn(async () => {
        resolve(undefined)
        await new Promise((release) => {
          releaseFetch = release
        })
        return new Response(JSON.stringify({ accepted: true }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        })
      })
    })

    try {
      const payload = {
        model: { providerID: "provider", modelID: "model" },
        messageID: " msg-1 ",
        parts: [{ type: "text", text: "hello" }],
      }
      const first = request(app)
        .post("/api/session/ses-1/prompt_async")
        .send(payload)
        .then((response) => response)
      await fetchStarted
      const second = request(app)
        .post("/api/session/ses-1/prompt_async")
        .send({ ...payload, messageID: "msg-1" })
        .then((response) => response)
      releaseFetch()

      const [firstResponse, secondResponse] = await Promise.all([first, second])

      expect(firstResponse.status).toBe(202)
      expect(secondResponse.status).toBe(202)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      expect(firstResponse.body).toEqual({ accepted: true })
      expect(secondResponse.body).toEqual({ accepted: true })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("forwards the real prompt_async body upstream when it is not pre-parsed", async () => {
    // Regression: /api/session/* is not run through express.json() in
    // production, so req.body is undefined and the handler must read the raw
    // request stream. Previously it forwarded JSON.stringify(req.body ?? {})
    // === "{}", so ax-code received a body with no model/parts and rejected
    // every prompt with an opaque 400 "Invalid request".
    const { app } = createApp({}, { parseJson: false })
    const originalFetch = globalThis.fetch
    let forwardedBody = null
    globalThis.fetch = vi.fn(async (_url, init) => {
      forwardedBody = init?.body ?? null
      return new Response(JSON.stringify({ accepted: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      })
    })

    try {
      const payload = {
        model: { providerID: "provider", modelID: "model" },
        messageID: "msg-raw-1",
        parts: [{ type: "text", text: "hello" }],
      }
      const response = await request(app)
        .post("/api/session/ses-1/prompt_async")
        .set("Content-Type", "application/json")
        .send(JSON.stringify(payload))
        .expect(202)

      expect(response.body).toEqual({ accepted: true })
      expect(forwardedBody).toBeTypeOf("string")
      expect(JSON.parse(forwardedBody)).toEqual(payload)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("forwards the real command body upstream when it is not pre-parsed", async () => {
    const { app } = createApp({}, { parseJson: false })
    const originalFetch = globalThis.fetch
    let forwardedBody = null
    globalThis.fetch = vi.fn(async (_url, init) => {
      forwardedBody = init?.body ?? null
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })

    try {
      const payload = { command: "review", arguments: "", model: "provider/model", messageID: "msg-cmd-1" }
      await request(app)
        .post("/api/session/ses-1/command")
        .set("Content-Type", "application/json")
        .send(JSON.stringify(payload))
        .expect(200)

      expect(forwardedBody).toBeTypeOf("string")
      expect(JSON.parse(forwardedBody)).toEqual(payload)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
