import { describe, expect, test } from "bun:test"
import { assertDesktopSecurityBaseline, desktopSecurityBaseline, isNavigationAllowed } from "../src/security/baseline"
import { desktopCapabilityProfiles, remoteSurfaceRequiredSecurityReviews } from "../src/security/capability-profiles"
import { createAttachBackendPlan, createStartBackendPlan } from "../src/lifecycle/sidecar-plan"

describe("desktop security baseline", () => {
  test("keeps least-privilege renderer defaults", () => {
    expect(() => assertDesktopSecurityBaseline()).not.toThrow()
    expect(desktopSecurityBaseline.contextIsolation).toBe(true)
    expect(desktopSecurityBaseline.nodeIntegration).toBe(false)
    expect(desktopSecurityBaseline.sandbox).toBe(true)
    expect(desktopSecurityBaseline.csp).toContain("connect-src 'self'")
    expect(desktopSecurityBaseline.csp).toContain("http://127.0.0.1:*")
    expect(desktopSecurityBaseline.csp).toContain("http://[::1]:*")
    expect(desktopSecurityBaseline.csp).toContain("https://localhost:*")
    expect(desktopSecurityBaseline.csp).toContain("https://[::1]:*")
    expect(desktopSecurityBaseline.csp).toContain("frame-src http://127.0.0.1:*")
    expect(desktopSecurityBaseline.exposesRawElectron).toBe(false)
    expect(desktopSecurityBaseline.exposesRawIpcRenderer).toBe(false)
  })

  test("rejects unsafe app shell navigation targets", () => {
    expect(isNavigationAllowed("app://ax-code/index.html")).toBe(true)
    expect(isNavigationAllowed("http://127.0.0.1:3137/")).toBe(false)
    expect(isNavigationAllowed("http://localhost:5173/")).toBe(false)
    expect(isNavigationAllowed("app://ax-code.evil/index.html")).toBe(false)
    expect(isNavigationAllowed("http://localhost.evil/")).toBe(false)
    expect(isNavigationAllowed("http://127.0.0.1.evil/")).toBe(false)
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
    const ipv6Attach = createAttachBackendPlan({ baseUrl: "http://[::1]:4096/", authHeader: "Basic token" })
    expect(ipv6Attach).toMatchObject({
      mode: "attach",
      baseUrl: "http://[::1]:4096",
      loopbackOnly: true,
    })
    const httpsAttach = createAttachBackendPlan({ baseUrl: "https://localhost:4096/", authHeader: "Basic token" })
    expect(httpsAttach).toMatchObject({
      mode: "attach",
      baseUrl: "https://localhost:4096",
      loopbackOnly: true,
    })
    expect(() => createAttachBackendPlan({ baseUrl: "https://example.com/" })).toThrow(
      "Attached desktop backend URL must use a loopback host.",
    )
    expect(() => createAttachBackendPlan({ baseUrl: "file:///tmp/backend.sock" })).toThrow(
      "Attached desktop backend URL must use HTTP or HTTPS.",
    )
  })

  test("keeps desktop, preview, and remote capability profiles separate", () => {
    const trusted = desktopCapabilityProfiles.find((profile) => profile.id === "trusted-local-app")
    const preview = desktopCapabilityProfiles.find((profile) => profile.id === "browser-preview")
    const remoteProfiles = desktopCapabilityProfiles.filter((profile) =>
      ["remote-host", "tunnel", "pwa-network", "vscode-webview"].includes(profile.id),
    )

    expect(trusted).toMatchObject({
      status: "enabled",
      bridge: "trusted-desktop",
      network: "loopback-only",
    })
    expect(trusted?.commands).toContain("backend.start")
    expect(trusted?.commands).toContain("release.openDownloadedUpdate")
    expect(preview).toMatchObject({
      status: "enabled",
      bridge: "none",
      localResources: "none",
      gate: "ADR-021",
    })
    expect(remoteProfiles).toHaveLength(4)
    expect(Object.fromEntries(remoteProfiles.map((profile) => [profile.id, profile.gate]))).toEqual({
      "remote-host": "ADR-023 RSG-1",
      tunnel: "ADR-023 RSG-2",
      "pwa-network": "ADR-023 RSG-3",
      "vscode-webview": "ADR-023 RSG-4",
    })
    for (const profile of remoteProfiles) {
      expect(profile.status).toBe("disabled")
      expect(profile.bridge).toBe("none")
      expect(profile.commands).toEqual([])
      expect(profile.threatModel?.length).toBeGreaterThan(40)
      for (const review of remoteSurfaceRequiredSecurityReviews) {
        expect(profile.securityReviews).toContain(review)
      }
    }
  })
})
