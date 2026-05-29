import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DESKTOP_BRIDGE_CHANNEL, createElectronHostPlan, isAppNavigationAllowed } from "../src/electron/config"
import {
  applyWindowSecurity,
  configureDesktopRuntimeForLoopback,
  connectInitialDesktopBackend,
  connectInitialDesktopBackendAfterWindow,
  createMainWindow,
  createAppProtocolResponse,
  desktopResponseHeadersForRequest,
  desktopBridgeSenderFromEvent,
  desktopProtocolContentType,
  installDesktopAppLifecycleHandlers,
  installDesktopSingleInstanceLock,
  registerAppSchemeAsPrivileged,
  resolveAppProtocolFile,
  shouldWarnBeforeScheduledShutdown,
  warnBeforeScheduledShutdown,
} from "../src/electron/host"
import {
  DESKTOP_MENU_COMMAND_CHANNEL,
  createDesktopApplicationMenuTemplate,
  installDesktopApplicationMenu,
  sendDesktopMenuCommand,
} from "../src/electron/menu"
import { DesktopBackendManager } from "../src/lifecycle/backend-manager"

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
    expect(plan.allowedNavigation).toEqual(["app://ax-code"])
    expect(plan.trustedBridgeOrigins).toEqual([])
  })

  test("supports only the configured loopback dev renderer without allowing remote navigation", () => {
    const plan = createElectronHostPlan({
      dev: true,
      rendererUrl: "http://127.0.0.1:5173",
      preloadPath: "/workspace/ax-code/packages/desktop/src/preload.cjs",
    })

    expect(plan.renderer).toEqual({ kind: "dev", url: "http://127.0.0.1:5173" })
    expect(plan.trustedBridgeOrigins).toEqual(["http://127.0.0.1:5173"])
    expect(isAppNavigationAllowed("app://ax-code/index.html", plan)).toBe(true)
    expect(isAppNavigationAllowed("http://127.0.0.1:5173", plan)).toBe(true)
    expect(isAppNavigationAllowed("http://127.0.0.1:5174", plan)).toBe(false)
    expect(isAppNavigationAllowed("http://localhost:5173", plan)).toBe(false)
    expect(isAppNavigationAllowed("app://ax-code.evil/index.html", plan)).toBe(false)
    expect(isAppNavigationAllowed("http://localhost.evil/", plan)).toBe(false)
    expect(isAppNavigationAllowed("https://example.com/", plan)).toBe(false)
    expect(isAppNavigationAllowed("file:///tmp/app.html", plan)).toBe(false)
  })

  test("rejects non-loopback dev renderer URLs before trusting bridge origins", () => {
    expect(() =>
      createElectronHostPlan({
        dev: true,
        rendererUrl: "https://example.com",
        preloadPath: "/workspace/ax-code/packages/desktop/src/preload.cjs",
      }),
    ).toThrow("Desktop dev renderer URL must be a loopback HTTP(S) URL.")
    expect(() =>
      createElectronHostPlan({
        rendererUrl: "file:///tmp/app.html",
        preloadPath: "/workspace/ax-code/packages/desktop/src/preload.cjs",
      }),
    ).toThrow("Desktop dev renderer URL must be a loopback HTTP(S) URL.")
    expect(() =>
      createElectronHostPlan({
        rendererUrl: "http://localhost.evil:5173",
        preloadPath: "/workspace/ax-code/packages/desktop/src/preload.cjs",
      }),
    ).toThrow("Desktop dev renderer URL must be a loopback HTTP(S) URL.")

    const ipv6Plan = createElectronHostPlan({
      rendererUrl: "http://[::1]:5173/",
      preloadPath: "/workspace/ax-code/packages/desktop/src/preload.cjs",
    })
    expect(ipv6Plan.renderer).toEqual({ kind: "dev", url: "http://[::1]:5173" })
    expect(ipv6Plan.trustedBridgeOrigins).toEqual(["http://[::1]:5173"])
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
      expect(resolveAppProtocolFile(renderer, "app://ax-code/%E0%A4%A")).toBeUndefined()
      expect(desktopProtocolContentType("index.html")).toBe("text/html; charset=utf-8")
      expect(desktopProtocolContentType("app.css")).toBe("text/css; charset=utf-8")

      const ok = await createAppProtocolResponse(renderer, new Request("app://ax-code/index.html"))
      expect(ok.status).toBe(200)
      expect(ok.headers.get("content-type")).toBe("text/html; charset=utf-8")
      expect(await ok.text()).toContain("ok")

      const missing = await createAppProtocolResponse(renderer, new Request("app://ax-code/missing.js"))
      expect(missing.status).toBe(404)

      const malformed = await createAppProtocolResponse(renderer, new Request("app://ax-code/%E0%A4%A"))
      expect(malformed.status).toBe(404)
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

  test("bypasses proxies for desktop loopback traffic before app ready", () => {
    const calls: Array<[string, string | undefined]> = []
    const env = {
      NO_PROXY: "example.com,localhost",
      no_proxy: "",
    } as NodeJS.ProcessEnv

    configureDesktopRuntimeForLoopback(
      {
        app: {
          disableHardwareAcceleration() {
            calls.push(["disableHardwareAcceleration", undefined])
          },
          commandLine: {
            appendSwitch(name: string, value?: string) {
              calls.push([name, value])
            },
          },
        },
      },
      env,
    )

    expect(calls).toContainEqual(["disableHardwareAcceleration", undefined])
    expect(calls).toContainEqual(["disable-gpu", undefined])
    expect(calls).toContainEqual(["proxy-bypass-list", "<-loopback>"])
    expect(env.NO_PROXY?.split(",")).toEqual(["example.com", "localhost", "127.0.0.1", "::1"])
    expect(env.no_proxy?.split(",")).toEqual(["127.0.0.1", "localhost", "::1"])
  })

  test("keeps the desktop host startable when an initial attach URL is invalid", async () => {
    const manager = new DesktopBackendManager({
      now: fixedClock([1, 2, 3]),
      startBackend: async () => {
        throw new Error("should not start")
      },
    })

    const connected = await connectInitialDesktopBackend(manager, {
      attachUrl: "file:///tmp/backend.sock",
      authHeader: "Basic secret",
    })

    expect(connected).toBe(false)
    expect(manager.getConnection()).toBeUndefined()
    expect(manager.diagnostics()).toMatchObject({
      status: "failed",
      mode: "attach",
      error: "Attached desktop backend URL must use HTTP or HTTPS.",
      startedAt: 1,
      stoppedAt: 2,
    })
    expect(JSON.stringify(manager.diagnostics())).not.toContain("Basic secret")
  })

  test("keeps the desktop host startable when initial sidecar startup fails", async () => {
    const manager = new DesktopBackendManager({
      startBackend: async () => {
        throw new Error("sidecar unavailable")
      },
    })

    const connected = await connectInitialDesktopBackend(manager, {
      directory: "/workspace/ax-code",
    })

    expect(connected).toBe(false)
    expect(manager.getConnection()).toBeUndefined()
    expect(manager.diagnostics()).toMatchObject({
      status: "failed",
      mode: "start",
      error: "sidecar unavailable",
    })
  })

  test("keeps the desktop window available while initial sidecar startup resolves", async () => {
    let resolveStart!: (value: {
      url: string
      headers: Record<string, string>
      close(): Promise<void>
    }) => void
    const reloads: string[] = []
    const manager = new DesktopBackendManager({
      startBackend: async () =>
        new Promise((resolve) => {
          resolveStart = resolve
        }),
    })

    const task = connectInitialDesktopBackendAfterWindow(
      manager,
      {
        directory: "/workspace/ax-code",
      },
      {
        webContents: {
          reloadIgnoringCache() {
            reloads.push("reloadIgnoringCache")
          },
          reload() {
            reloads.push("reload")
          },
        },
      },
    )

    expect(manager.diagnostics()).toMatchObject({
      status: "starting",
      mode: "start",
    })
    expect(reloads).toEqual([])

    resolveStart({
      url: "http://127.0.0.1:4555",
      headers: {},
      close: async () => {},
    })

    await expect(task).resolves.toBe(true)
    expect(manager.diagnostics()).toMatchObject({
      status: "running",
      mode: "start",
      url: "http://127.0.0.1:4555",
    })
    expect(reloads).toEqual(["reloadIgnoringCache"])
  })

  test("does not reload the desktop renderer when initial sidecar startup fails", async () => {
    const reloads: string[] = []
    const manager = new DesktopBackendManager({
      startBackend: async () => {
        throw new Error("sidecar unavailable")
      },
    })

    const task = connectInitialDesktopBackendAfterWindow(
      manager,
      {
        directory: "/workspace/ax-code",
      },
      {
        webContents: {
          reloadIgnoringCache() {
            reloads.push("reloadIgnoringCache")
          },
        },
      },
    )

    await expect(task).resolves.toBe(false)
    expect(manager.diagnostics()).toMatchObject({
      status: "failed",
      mode: "start",
      error: "sidecar unavailable",
    })
    expect(reloads).toEqual([])
  })

  test("does not open devtools for a normal desktop window", async () => {
    const calls: string[] = []
    const plan = createElectronHostPlan({
      appDist: "/workspace/ax-code/packages/app/dist",
      preloadPath: "/workspace/ax-code/packages/desktop/src/preload.cjs",
    })
    class FakeBrowserWindow {
      webContents = {
        session: {
          webRequest: {
            onHeadersReceived() {
              calls.push("headers")
            },
          },
        },
        setWindowOpenHandler() {
          calls.push("window-open-handler")
        },
        on(event: string) {
          calls.push(`webcontents:${event}`)
        },
        openDevTools() {
          calls.push("devtools")
        },
      }

      once(event: string, callback: () => void) {
        calls.push(`once:${event}`)
        callback()
      }

      async loadURL(url: string) {
        calls.push(`load:${url}`)
      }

      show() {
        calls.push("show")
      }
    }

    await createMainWindow(
      {
        BrowserWindow: FakeBrowserWindow,
        shell: {
          openExternal() {
            calls.push("external")
          },
        },
      } as never,
      plan,
    )

    expect(calls).toContain("load:app://ax-code/index.html")
    expect(calls).not.toContain("devtools")
  })

  test("shows the desktop window before renderer loading finishes", async () => {
    const calls: string[] = []
    let resolveLoad!: () => void
    const plan = createElectronHostPlan({
      appDist: "/workspace/ax-code/packages/app/dist",
      preloadPath: "/workspace/ax-code/packages/desktop/src/preload.cjs",
    })
    class FakeBrowserWindow {
      webContents = {
        session: {
          webRequest: {
            onHeadersReceived() {
              calls.push("headers")
            },
          },
        },
        setWindowOpenHandler() {
          calls.push("window-open-handler")
        },
        on(event: string) {
          calls.push(`webcontents:${event}`)
        },
      }

      once(event: string, callback: () => void) {
        calls.push(`once:${event}`)
        if (event === "ready-to-show") callback()
      }

      async loadURL(url: string) {
        calls.push(`load:${url}`)
        await new Promise<void>((resolve) => {
          resolveLoad = resolve
        })
      }

      show() {
        calls.push("show")
      }
    }

    await createMainWindow(
      {
        BrowserWindow: FakeBrowserWindow,
        shell: {
          openExternal() {}
        },
      } as never,
      plan,
    )

    const firstShow = calls.indexOf("show")
    const load = calls.indexOf("load:app://ax-code/index.html")
    expect(firstShow).toBeGreaterThanOrEqual(0)
    expect(load).toBeGreaterThan(firstShow)

    resolveLoad()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls.filter((call) => call === "show").length).toBeGreaterThanOrEqual(2)
  })

  test("records renderer crash diagnostics for maintainer log export", async () => {
    const webContentsHandlers = new Map<string, (...args: unknown[]) => void>()
    const windowHandlers = new Map<string, (...args: unknown[]) => void>()
    const logs: string[] = []
    const plan = createElectronHostPlan({
      appDist: "/workspace/ax-code/packages/app/dist",
      preloadPath: "/workspace/ax-code/packages/desktop/src/preload.cjs",
    })
    class FakeBrowserWindow {
      webContents = {
        session: {
          webRequest: {
            onHeadersReceived() {},
          },
        },
        setWindowOpenHandler() {},
        on(event: string, handler: (...args: unknown[]) => void) {
          webContentsHandlers.set(event, handler)
        },
      }

      on(event: string, handler: (...args: unknown[]) => void) {
        windowHandlers.set(event, handler)
      }

      once(_event: string, callback: () => void) {
        callback()
      }

      async loadURL() {}

      show() {}
    }

    await createMainWindow(
      {
        BrowserWindow: FakeBrowserWindow,
        shell: {
          openExternal() {},
        },
      } as never,
      plan,
      {
        diagnostics: {
          recordSystemLog(line) {
            logs.push(line)
          },
        },
      },
    )

    webContentsHandlers.get("render-process-gone")?.({}, { reason: "crashed", exitCode: 9 })
    windowHandlers.get("unresponsive")?.()
    windowHandlers.get("responsive")?.()
    webContentsHandlers
      .get("did-fail-load")
      ?.({}, -102, "CONNECTION_REFUSED", "http://127.0.0.1:5173/?token=secret#section", true)
    webContentsHandlers.get("did-fail-load")?.({}, -3, "ABORTED", "http://127.0.0.1:5173/frame", false)

    expect(logs).toEqual([
      "renderer process gone: reason=crashed exitCode=9",
      "renderer unresponsive",
      "renderer responsive",
      "renderer load failed: code=-102 description=CONNECTION_REFUSED url=http://127.0.0.1:5173/",
    ])
    expect(logs.join("\n")).not.toContain("token=secret")
  })

  test("builds a native menu that emits renderer-safe intents", () => {
    const commands: string[] = []
    const template = createDesktopApplicationMenuTemplate({
      platform: "darwin",
      sendCommand(command) {
        commands.push(command)
      },
    })

    const fileMenu = template.find((item) => item.label === "File")
    const runMenu = template.find((item) => item.label === "Run")
    const newSession = fileMenu?.submenu?.find((item) => item.label === "New Session")
    const queueDraft = runMenu?.submenu?.find((item) => item.label === "Queue Draft")

    expect(template[0]?.label).toBe("AX Code")
    expect(newSession?.accelerator).toBe("CommandOrControl+N")
    expect(queueDraft?.accelerator).toBe("CommandOrControl+Shift+Enter")

    newSession?.click?.()
    queueDraft?.click?.()
    expect(commands).toEqual(["session.new", "composer.queue"])
  })

  test("installs the native menu without exposing privileged runtime shortcuts", () => {
    let installedTemplate: unknown
    const sent: unknown[] = []
    const installed = installDesktopApplicationMenu(
      {
        Menu: {
          buildFromTemplate(template: unknown) {
            installedTemplate = template
            return { template }
          },
          setApplicationMenu(menu: unknown) {
            installedTemplate = menu
          },
        },
      },
      () => ({
        webContents: {
          send(channel: string, payload: unknown) {
            sent.push({ channel, payload })
          },
        },
      }),
      "linux",
    )

    expect(installed).toBe(true)
    const menu = installedTemplate as {
      template: Array<{ label?: string; submenu?: Array<{ label?: string; click?: () => void }> }>
    }
    const runMenu = menu.template.find((item) => item.label === "Run")
    runMenu?.submenu?.find((item) => item.label === "Run Draft")?.click?.()
    expect(sent).toEqual([{ channel: DESKTOP_MENU_COMMAND_CHANNEL, payload: { command: "composer.run" } }])
  })

  test("sends menu commands only to a live renderer window", () => {
    const sent: unknown[] = []
    const liveWindow = {
      webContents: {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload })
        },
      },
    }

    expect(sendDesktopMenuCommand(liveWindow, "session.new")).toBe(true)
    expect(
      sendDesktopMenuCommand({ isDestroyed: () => true, webContents: liveWindow.webContents }, "session.new"),
    ).toBe(false)
    expect(sent).toEqual([{ channel: DESKTOP_MENU_COMMAND_CHANNEL, payload: { command: "session.new" } }])
  })

  test("opens only safe denied window URLs externally", () => {
    let handler: ((input: { url: string }) => { action: string }) | undefined
    let navigate: ((event: { preventDefault(): void }, url: string) => void) | undefined
    let permissionRequest:
      | ((webContents: unknown, permission: string, callback: (allowed: boolean) => void, details: unknown) => void)
      | undefined
    let permissionCheck: ((webContents: unknown, permission: string, requestingOrigin: string, details: unknown) => boolean)
      | undefined
    const opened: string[] = []
    let prevented = 0
    const plan = createElectronHostPlan({
      appDist: "/workspace/ax-code/packages/app/dist",
      preloadPath: "/workspace/ax-code/packages/desktop/src/preload.cjs",
    })

    applyWindowSecurity(
      {
        shell: {
          openExternal(url: string) {
            opened.push(url)
          },
        },
      } as never,
      {
        webContents: {
          setWindowOpenHandler(input: typeof handler) {
            handler = input
          },
          on(event: string, input: typeof navigate) {
            if (event === "will-navigate") navigate = input
          },
          session: {
            webRequest: {
              onHeadersReceived() {},
            },
            setPermissionRequestHandler(input: typeof permissionRequest) {
              permissionRequest = input
            },
            setPermissionCheckHandler(input: typeof permissionCheck) {
              permissionCheck = input
            },
          },
        },
      },
      plan,
    )

    expect(handler?.({ url: "app://ax-code/settings" })).toEqual({ action: "allow" })
    expect(handler?.({ url: "https://example.com/" })).toEqual({ action: "deny" })
    expect(handler?.({ url: "file:///tmp/secret.txt" })).toEqual({ action: "deny" })
    expect(handler?.({ url: "javascript:alert(1)" })).toEqual({ action: "deny" })
    navigate?.(
      {
        preventDefault() {
          prevented++
        },
      },
      "app://ax-code/settings",
    )
    navigate?.(
      {
        preventDefault() {
          prevented++
        },
      },
      "https://example.com/docs",
    )
    navigate?.(
      {
        preventDefault() {
          prevented++
        },
      },
      "file:///tmp/secret.txt",
    )
    navigate?.(
      {
        preventDefault() {
          prevented++
        },
      },
      "javascript:alert(1)",
    )

    expect(opened).toEqual(["https://example.com/", "https://example.com/docs"])
    expect(prevented).toBe(3)

    const permissionDecisions: boolean[] = []
    permissionRequest?.(
      { id: 1 },
      "media",
      (allowed) => {
        permissionDecisions.push(allowed)
      },
      { requestingUrl: "app://ax-code/index.html" },
    )
    expect(permissionDecisions).toEqual([false])
    expect(permissionCheck?.({ id: 1 }, "notifications", "app://ax-code/index.html", {})).toBe(false)
  })

  test("does not leak rejected external navigation handoffs", async () => {
    let handler: ((input: { url: string }) => { action: string }) | undefined
    let navigate: ((event: { preventDefault(): void }, url: string) => void) | undefined
    const opened: string[] = []
    const plan = createElectronHostPlan({
      appDist: "/workspace/ax-code/packages/app/dist",
      preloadPath: "/workspace/ax-code/packages/desktop/src/preload.cjs",
    })

    applyWindowSecurity(
      {
        shell: {
          async openExternal(url: string) {
            opened.push(url)
            throw new Error("open failed")
          },
        },
      } as never,
      {
        webContents: {
          setWindowOpenHandler(input: typeof handler) {
            handler = input
          },
          on(event: string, input: typeof navigate) {
            if (event === "will-navigate") navigate = input
          },
          session: {
            webRequest: {
              onHeadersReceived() {},
            },
          },
        },
      },
      plan,
    )

    expect(() => handler?.({ url: "https://example.com/" })).not.toThrow()
    expect(() =>
      navigate?.(
        {
          preventDefault() {},
        },
        "https://example.com/docs",
      ),
    ).not.toThrow()
    await Promise.resolve()

    expect(opened).toEqual(["https://example.com/", "https://example.com/docs"])
  })

  test("scopes desktop CSP injection to the app renderer instead of loopback previews", () => {
    const packagedPlan = createElectronHostPlan({
      appDist: "/workspace/ax-code/packages/app/dist",
      preloadPath: "/workspace/ax-code/packages/desktop/src/preload.cjs",
    })
    const devPlan = createElectronHostPlan({
      rendererUrl: "http://127.0.0.1:5173",
      preloadPath: "/workspace/ax-code/packages/desktop/src/preload.cjs",
    })

    expect(
      desktopResponseHeadersForRequest(packagedPlan, {
        url: "app://ax-code/index.html",
        responseHeaders: { "x-test": ["1"] },
      }),
    ).toMatchObject({
      "x-test": ["1"],
      "Content-Security-Policy": [expect.stringContaining("default-src 'self'")],
    })
    expect(
      desktopResponseHeadersForRequest(packagedPlan, {
        url: "http://127.0.0.1:3000/",
        responseHeaders: { "x-preview": ["1"] },
      }),
    ).toEqual({ "x-preview": ["1"] })
    expect(
      desktopResponseHeadersForRequest(devPlan, {
        url: "http://127.0.0.1:5173/src/main.tsx",
        responseHeaders: {},
      }),
    ).toMatchObject({
      "Content-Security-Policy": [expect.stringContaining("default-src 'self'")],
    })
    expect(
      desktopResponseHeadersForRequest(devPlan, {
        url: "http://127.0.0.1:5174/",
        responseHeaders: {},
      }),
    ).toEqual({})
  })

  test("builds bridge sender identity from the top-level web contents URL", () => {
    expect(
      desktopBridgeSenderFromEvent({
        sender: { getURL: () => "app://ax-code/index.html" },
        senderFrame: { url: "http://localhost:3137/preview" },
      }),
    ).toEqual({
      url: "app://ax-code/index.html",
      frameUrl: "http://localhost:3137/preview",
    })
  })

  test("keeps production startup free of fixed debug log side effects", () => {
    const mainSource = readFileSync(path.resolve(import.meta.dirname, "../src/main.ts"), "utf8")
    const hostSource = readFileSync(path.resolve(import.meta.dirname, "../src/electron/host.ts"), "utf8")

    expect(mainSource).not.toContain("ax-code-debug.log")
    expect(hostSource).not.toContain("ax-code-debug.log")
  })

  test("does not block Electron ready behind top-level host startup await", () => {
    const mainSource = readFileSync(path.resolve(import.meta.dirname, "../src/main.ts"), "utf8")

    expect(mainSource).not.toContain("await startElectronDesktopHost")
    expect(mainSource).toContain("void startElectronDesktopHost")
  })

  test("quits before backend startup when another instance owns the single-instance lock", () => {
    const handlers = new Map<string, () => unknown>()
    let quitCount = 0
    let createCount = 0

    const locked = installDesktopSingleInstanceLock({
      electron: {
        app: {
          requestSingleInstanceLock() {
            return false
          },
          on(event: string, handler: () => unknown) {
            handlers.set(event, handler)
          },
          quit() {
            quitCount++
          },
        },
        BrowserWindow: {
          getAllWindows() {
            return []
          },
        },
      } as never,
      async createWindow() {
        createCount++
        return {}
      },
    })

    expect(locked).toBe(false)
    expect(quitCount).toBe(1)
    expect(createCount).toBe(0)
    expect(handlers.has("second-instance")).toBe(false)
  })

  test("focuses an existing desktop window when a second instance is opened", async () => {
    const handlers = new Map<string, () => unknown>()
    let createCount = 0
    let restoreCount = 0
    let showCount = 0
    let focusCount = 0

    const locked = installDesktopSingleInstanceLock({
      electron: {
        app: {
          requestSingleInstanceLock() {
            return true
          },
          on(event: string, handler: () => unknown) {
            handlers.set(event, handler)
          },
          quit() {},
        },
        BrowserWindow: {
          getAllWindows() {
            return [
              {
                isDestroyed: () => false,
                isVisible: () => false,
                isMinimized: () => true,
                restore() {
                  restoreCount++
                },
                show() {
                  showCount++
                },
                focus() {
                  focusCount++
                },
              },
            ]
          },
        },
      } as never,
      async createWindow() {
        createCount++
        return {}
      },
    })

    expect(locked).toBe(true)
    await handlers.get("second-instance")?.()

    expect(createCount).toBe(0)
    expect(restoreCount).toBe(1)
    expect(showCount).toBe(1)
    expect(focusCount).toBe(1)
  })

  test("does not create a second-instance window before startup is ready", async () => {
    const handlers = new Map<string, () => unknown>()
    let createCount = 0
    let ready = false

    const locked = installDesktopSingleInstanceLock({
      electron: {
        app: {
          requestSingleInstanceLock() {
            return true
          },
          on(event: string, handler: () => unknown) {
            handlers.set(event, handler)
          },
          quit() {},
        },
        BrowserWindow: {
          getAllWindows() {
            return []
          },
        },
      } as never,
      async createWindow() {
        createCount++
        return {}
      },
      canCreateWindow() {
        return ready
      },
    })

    expect(locked).toBe(true)
    await handlers.get("second-instance")?.()
    expect(createCount).toBe(0)

    ready = true
    await handlers.get("second-instance")?.()
    expect(createCount).toBe(1)
  })

  test("keeps macOS sidecar alive after closing the last window and recreates on activate", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>()
    let closeCount = 0
    let quitCount = 0
    let createCount = 0
    let preventQuitCount = 0
    let windows: unknown[] = [{}]
    installDesktopAppLifecycleHandlers({
      platform: "darwin",
      electron: {
        app: {
          on(event: string, handler: () => unknown) {
            handlers.set(event, handler)
          },
          quit() {
            quitCount++
          },
        },
        BrowserWindow: {
          getAllWindows() {
            return windows
          },
        },
        dialog: {
          async showMessageBox() {
            return { response: 0 }
          },
        },
      } as never,
      backend: {
        async close() {
          closeCount++
        },
        getConnection() {
          return {
            mode: "start" as const,
            url: "http://127.0.0.1:4555",
            headers: {},
            loopbackOnly: true,
            generatedAuth: true,
          }
        },
      },
      async createWindow() {
        createCount++
        return {}
      },
    })

    await handlers.get("window-all-closed")?.()
    expect(closeCount).toBe(0)
    expect(quitCount).toBe(0)

    windows = []
    await handlers.get("activate")?.()
    expect(createCount).toBe(1)

    handlers.get("before-quit")?.({
      preventDefault() {
        preventQuitCount++
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await handlers.get("window-all-closed")?.()
    expect(closeCount).toBe(1)
    expect(preventQuitCount).toBe(1)
    expect(quitCount).toBe(1)
  })

  test("defers native quit until the scheduled backend shutdown warning and close finish", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>()
    let preventQuitCount = 0
    let quitCount = 0
    let closeCount = 0
    let resolveDialog!: (value: { response: number }) => void
    let resolveClose!: () => void
    const dialogShown = new Promise<void>((resolve) => {
      installDesktopAppLifecycleHandlers({
        platform: "darwin",
        electron: {
          app: {
            on(event: string, handler: (...args: any[]) => unknown) {
              handlers.set(event, handler)
            },
            quit() {
              quitCount++
            },
          },
          BrowserWindow: {
            getAllWindows() {
              return []
            },
          },
          dialog: {
            showMessageBox() {
              resolve()
              return new Promise<{ response: number }>((dialogResolve) => {
                resolveDialog = dialogResolve
              })
            },
          },
        } as never,
        backend: {
          async close() {
            await new Promise<void>((closeResolve) => {
              resolveClose = closeResolve
            })
            closeCount++
          },
          getConnection() {
            return {
              mode: "start" as const,
              url: "http://127.0.0.1:4555",
              headers: {},
              loopbackOnly: true,
              generatedAuth: true,
            }
          },
        },
        async createWindow() {
          return {}
        },
      })
    })

    handlers.get("before-quit")?.({
      preventDefault() {
        preventQuitCount++
      },
    })

    await dialogShown
    expect(preventQuitCount).toBe(1)
    expect(quitCount).toBe(0)
    expect(closeCount).toBe(0)

    resolveDialog({ response: 0 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(quitCount).toBe(0)
    expect(closeCount).toBe(0)

    resolveClose()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(closeCount).toBe(1)
    expect(quitCount).toBe(1)
  })

  test("continues native quit without leaking a rejection when backend close fails", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>()
    let preventQuitCount = 0
    let quitCount = 0
    installDesktopAppLifecycleHandlers({
      platform: "darwin",
      electron: {
        app: {
          on(event: string, handler: (...args: any[]) => unknown) {
            handlers.set(event, handler)
          },
          quit() {
            quitCount++
          },
        },
        BrowserWindow: {
          getAllWindows() {
            return []
          },
        },
        dialog: {
          async showMessageBox() {
            return { response: 0 }
          },
        },
      } as never,
      backend: {
        async close() {
          throw new Error("close failed")
        },
        getConnection() {
          return undefined
        },
      },
      async createWindow() {
        return {}
      },
    })

    handlers.get("before-quit")?.({
      preventDefault() {
        preventQuitCount++
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(preventQuitCount).toBe(1)
    expect(quitCount).toBe(1)
  })

  test("shows an existing macOS window on activate instead of creating a duplicate", async () => {
    const handlers = new Map<string, () => unknown>()
    let createCount = 0
    let restoreCount = 0
    let showCount = 0
    let focusCount = 0
    installDesktopAppLifecycleHandlers({
      platform: "darwin",
      electron: {
        app: {
          on(event: string, handler: () => unknown) {
            handlers.set(event, handler)
          },
          quit() {},
        },
        BrowserWindow: {
          getAllWindows() {
            return [
              {
                isDestroyed: () => false,
                isVisible: () => false,
                isMinimized: () => true,
                restore() {
                  restoreCount++
                },
                show() {
                  showCount++
                },
                focus() {
                  focusCount++
                },
              },
            ]
          },
        },
        dialog: {
          async showMessageBox() {
            return { response: 0 }
          },
        },
      } as never,
      backend: {
        async close() {},
        getConnection() {
          return undefined
        },
      },
      async createWindow() {
        createCount++
        return {}
      },
    })

    await handlers.get("activate")?.()

    expect(createCount).toBe(0)
    expect(restoreCount).toBe(1)
    expect(showCount).toBe(1)
    expect(focusCount).toBe(1)
  })

  test("closes the backend when a non-macOS app window lifecycle ends", async () => {
    const handlers = new Map<string, () => unknown>()
    let closeCount = 0
    let quitCount = 0
    installDesktopAppLifecycleHandlers({
      platform: "linux",
      electron: {
        app: {
          on(event: string, handler: () => unknown) {
            handlers.set(event, handler)
          },
          quit() {
            quitCount++
          },
        },
        BrowserWindow: {
          getAllWindows() {
            return []
          },
        },
        dialog: {
          async showMessageBox() {
            return { response: 0 }
          },
        },
      } as never,
      backend: {
        async close() {
          closeCount++
        },
        getConnection() {
          return undefined
        },
      },
      async createWindow() {
        return {}
      },
    })

    await handlers.get("window-all-closed")?.()
    expect(closeCount).toBe(1)
    expect(quitCount).toBe(1)
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

function fixedClock(values: number[]) {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)] ?? 0
}
