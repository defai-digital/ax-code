import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DESKTOP_BRIDGE_CHANNEL, createElectronHostPlan, isAppNavigationAllowed } from "../src/electron/config"
import {
  createAppProtocolResponse,
  desktopProtocolContentType,
  registerAppSchemeAsPrivileged,
  resolveAppProtocolFile,
  shouldWarnBeforeScheduledShutdown,
  warnBeforeScheduledShutdown,
} from "../src/electron/host"

describe("electron host plan", () => {
  test("uses custom app protocol and locked-down renderer options for packaged content", () => {
    const plan = createElectronHostPlan({
      appDist: "/workspace/ax-code/packages/app/dist",
      preloadPath: "/workspace/ax-code/packages/desktop/src/preload.cjs",
    })

    expect(plan.renderer).toEqual({
      kind: "packaged",
      appDist: "/workspace/ax-code/packages/app/dist",
    })
    expect(plan.bridgeChannel).toBe(DESKTOP_BRIDGE_CHANNEL)
    expect(plan.window.webPreferences).toEqual({
      preload: "/workspace/ax-code/packages/desktop/src/preload.cjs",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    })
    expect(plan.csp).toContain("object-src 'none'")
  })

  test("supports trusted loopback dev renderer without allowing remote navigation", () => {
    const plan = createElectronHostPlan({
      dev: true,
      rendererUrl: "http://127.0.0.1:5173",
      preloadPath: "/workspace/ax-code/packages/desktop/src/preload.cjs",
    })

    expect(plan.renderer).toEqual({ kind: "dev", url: "http://127.0.0.1:5173" })
    expect(isAppNavigationAllowed("app://ax-code/index.html", plan)).toBe(true)
    expect(isAppNavigationAllowed("http://127.0.0.1:5173", plan)).toBe(true)
    expect(isAppNavigationAllowed("https://example.com/", plan)).toBe(false)
    expect(isAppNavigationAllowed("file:///tmp/app.html", plan)).toBe(false)
  })

  test("serves packaged renderer assets without file-url fetch or path traversal", async () => {
    const appDist = mkdtempSync(path.join(tmpdir(), "ax-code-app-protocol-"))
    writeFileSync(path.join(appDist, "index.html"), "<main>ok</main>")
    writeFileSync(path.join(appDist, "app.css"), "body{}")
    const renderer = { kind: "packaged" as const, appDist }
    try {
      expect(resolveAppProtocolFile(renderer, "app://ax-code/index.html")).toBe(path.join(appDist, "index.html"))
      expect(resolveAppProtocolFile(renderer, "app://other/index.html")).toBeUndefined()
      expect(resolveAppProtocolFile(renderer, "app://ax-code/%2e%2e%2fsecret.txt")).toBeUndefined()
      expect(desktopProtocolContentType("index.html")).toBe("text/html; charset=utf-8")
      expect(desktopProtocolContentType("app.css")).toBe("text/css; charset=utf-8")

      const ok = await createAppProtocolResponse(renderer, new Request("app://ax-code/index.html"))
      expect(ok.status).toBe(200)
      expect(ok.headers.get("content-type")).toBe("text/html; charset=utf-8")
      expect(await ok.text()).toContain("ok")

      const missing = await createAppProtocolResponse(renderer, new Request("app://ax-code/missing.js"))
      expect(missing.status).toBe(404)
    } finally {
      rmSync(appDist, { recursive: true, force: true })
    }
  })

  test("registers packaged app scheme before Electron ready", () => {
    const calls: unknown[] = []
    const plan = createElectronHostPlan({
      appDist: "/workspace/ax-code/packages/app/dist",
      preloadPath: "/workspace/ax-code/packages/desktop/src/preload.cjs",
    })
    registerAppSchemeAsPrivileged(
      {
        protocol: {
          registerSchemesAsPrivileged(input: unknown) {
            calls.push(input)
          },
        },
      },
      plan,
    )
    expect(JSON.stringify(calls[0])).toContain('"scheme":"app"')
    expect(JSON.stringify(calls[0])).toContain('"secure":true')
  })

  test("warns before closing a sidecar-owned scheduled backend", async () => {
    const messages: unknown[] = []
    const electron = {
      dialog: {
        async showMessageBox(input: unknown) {
          messages.push(input)
          return { response: 0 }
        },
      },
    }
    const sidecarBackend = {
      getConnection() {
        return {
          url: "http://127.0.0.1:4555",
          headers: {},
          mode: "start" as const,
          loopbackOnly: true,
          generatedAuth: true,
          directory: "/workspace/ax-code",
        }
      },
    }
    const attachedBackend = {
      getConnection() {
        return {
          url: "http://127.0.0.1:4555",
          headers: {},
          mode: "attach" as const,
          loopbackOnly: true,
          generatedAuth: false,
        }
      },
    }

    expect(shouldWarnBeforeScheduledShutdown(sidecarBackend)).toBe(true)
    expect(shouldWarnBeforeScheduledShutdown(attachedBackend)).toBe(false)
    expect(await warnBeforeScheduledShutdown(electron, sidecarBackend)).toBe(true)
    expect(await warnBeforeScheduledShutdown(electron, attachedBackend)).toBe(false)
    expect(messages).toHaveLength(1)
    expect(JSON.stringify(messages[0])).toContain("Scheduled automations owned by this desktop backend")
  })
})
