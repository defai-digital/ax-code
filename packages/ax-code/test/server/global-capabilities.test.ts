import { expect, test } from "bun:test"
import { Installation } from "../../src/installation"
import { Server } from "../../src/server/server"

test("GET /global/health exposes structured readiness without breaking the stable health flag", async () => {
  const response = await Server.Default().request("/global/health")
  expect(response.status).toBe(200)

  const payload = (await response.json()) as {
    healthy?: boolean
    version?: string
    startup?: {
      startedAt?: number
      uptimeMs?: number
      checkedAt?: number
    }
    readiness?: {
      processAlive?: boolean
      apiReady?: boolean
      providersReady?: string
      indexReady?: string
    }
    runtime?: {
      directory?: string
      services?: Array<{
        name?: string
        state?: string
        pendingTasks?: number
      }>
      taskSummary?: Record<string, number>
    }
  }

  expect(payload.healthy).toBe(true)
  expect(payload.version).toBe(Installation.VERSION)
  expect(payload.startup?.startedAt).toEqual(expect.any(Number))
  expect(payload.startup?.uptimeMs).toEqual(expect.any(Number))
  expect(payload.startup?.checkedAt).toEqual(expect.any(Number))
  expect(payload.readiness).toMatchObject({
    processAlive: true,
    apiReady: true,
  })
  expect(["ready", "degraded", "unknown"]).toContain(payload.readiness?.providersReady ?? "")
  expect(["ready", "degraded", "unknown"]).toContain(payload.readiness?.indexReady ?? "")
  expect(payload.runtime?.directory).toEqual(expect.any(String))
  expect(Array.isArray(payload.runtime?.services)).toBe(true)
  expect(payload.runtime?.taskSummary).toMatchObject({
    queued: expect.any(Number),
    running: expect.any(Number),
    completed: expect.any(Number),
    failed: expect.any(Number),
    aborted: expect.any(Number),
  })
})

test("GET /global/capabilities exposes desktop integration contract metadata", async () => {
  const response = await Server.Default().request("/global/capabilities")
  expect(response.status).toBe(200)

  const payload = (await response.json()) as {
    schemaVersion?: number
    product?: string
    version?: string
    compatibility?: {
      sdkHeadless?: {
        supportsExplicitBinary?: boolean
        supportsExplicitArgs?: boolean
        supportsStructuredDiagnostics?: boolean
        authSchemes?: string[]
        defaultTransport?: string
      }
    }
    endpoints?: Record<string, string>
    features?: Record<string, boolean>
    events?: Record<string, string>
  }

  expect(payload.schemaVersion).toBe(1)
  expect(payload.product).toBe("ax-code")
  expect(payload.version).toBe(Installation.VERSION)
  expect(payload.compatibility?.sdkHeadless).toMatchObject({
    supportsExplicitBinary: true,
    supportsExplicitArgs: true,
    supportsStructuredDiagnostics: true,
    authSchemes: ["basic"],
    defaultTransport: "http-sse",
  })
  expect(payload.endpoints).toMatchObject({
    health: "/global/health",
    events: "/global/event",
    capabilityCatalog: "/capability",
    fileSearch: "/find/file",
    sessions: "/session",
  })
  expect(payload.features).toMatchObject({
    sessions: true,
    globalEvents: true,
    fileSearch: true,
    skills: true,
    plugins: true,
    mcp: true,
    worktrees: true,
  })
  expect(payload.events).toMatchObject({
    heartbeat: "server.heartbeat",
    connected: "server.connected",
    sessionStatus: "session.status",
    sessionError: "session.error",
  })
})
