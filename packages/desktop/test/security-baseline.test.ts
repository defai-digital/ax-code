import { describe, expect, test } from "bun:test"
import { assertDesktopSecurityBaseline, desktopSecurityBaseline, isNavigationAllowed } from "../src/security/baseline"
import { createAttachBackendPlan, createStartBackendPlan } from "../src/lifecycle/sidecar-plan"

describe("desktop security baseline", () => {
  test("keeps least-privilege renderer defaults", () => {
    expect(() => assertDesktopSecurityBaseline()).not.toThrow()
    expect(desktopSecurityBaseline.contextIsolation).toBe(true)
    expect(desktopSecurityBaseline.nodeIntegration).toBe(false)
    expect(desktopSecurityBaseline.sandbox).toBe(true)
    expect(desktopSecurityBaseline.csp).toContain("frame-src http://127.0.0.1:* http://localhost:*")
    expect(desktopSecurityBaseline.exposesRawElectron).toBe(false)
    expect(desktopSecurityBaseline.exposesRawIpcRenderer).toBe(false)
  })

  test("rejects unsafe app shell navigation targets", () => {
    expect(isNavigationAllowed("app://ax-code/index.html")).toBe(true)
    expect(isNavigationAllowed("http://127.0.0.1:3137/")).toBe(true)
    expect(isNavigationAllowed("file:///tmp/index.html")).toBe(false)
    expect(isNavigationAllowed("https://example.com/")).toBe(false)
  })

  test("plans sidecar start and attach modes without in-process server ownership", () => {
    const start = createStartBackendPlan({ directory: "/workspace/ax-code" })
    expect(start).toMatchObject({
      mode: "start",
      loopbackOnly: true,
      generatedAuth: true,
    })
    if (start.mode === "start") {
      expect(start.options.hostname).toBe("127.0.0.1")
      expect(start.options.port).toBe(0)
    }

    const attach = createAttachBackendPlan({ baseUrl: "http://127.0.0.1:4096/", authHeader: "Basic token" })
    expect(attach).toMatchObject({
      mode: "attach",
      baseUrl: "http://127.0.0.1:4096",
      loopbackOnly: true,
      generatedAuth: false,
    })
    if (attach.mode === "attach") {
      expect(attach.headers.authorization).toBe("Basic token")
    }
  })
})
