import { expect, test } from "bun:test"
import { Installation } from "../../src/installation"
import { Server } from "../../src/server/server"

test("GET /global/health exposes structured readiness without breaking the stable health flag", async () => {
  const response = await Server.Default().request("/global/health")
  expect(response.status).toBe(200)

  const payload = (await response.json()) as {
    healthy?: boolean
    version?: string
    readiness?: {
      processAlive?: boolean
      apiReady?: boolean
      providersReady?: string
      indexReady?: string
    }
  }

  expect(payload.healthy).toBe(true)
  expect(payload.version).toBe(Installation.VERSION)
  expect(payload.readiness).toEqual({
    processAlive: true,
    apiReady: true,
    providersReady: "unknown",
    indexReady: "unknown",
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
