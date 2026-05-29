import { describe, expect, test } from "bun:test"
import { createDesktopBridgeHandler } from "../src/bridge/handler"
import { DesktopBackendManager } from "../src/lifecycle/backend-manager"

describe("desktop bridge handler", () => {
  test("routes validated backend commands to backend manager", async () => {
    const backend = new DesktopBackendManager({
      startBackend: async () => ({
        url: "http://127.0.0.1:4555",
        headers: { Authorization: "Basic generated" },
        close: async () => undefined,
      }),
    })
    const invoke = createDesktopBridgeHandler({
      backend,
      sender: { url: "app://ax-code/index.html" },
    })

    const connection = await invoke("backend.start", { directory: "/workspace/ax-code" })

    expect(connection).toMatchObject({
      url: "http://127.0.0.1:4555",
      generatedAuth: true,
    })
    expect(await invoke("diagnostics.read", {})).toMatchObject({
      status: "running",
      url: "http://127.0.0.1:4555",
    })
    expect(await invoke("app.config", {})).toEqual({
      mode: "live",
      baseUrl: "http://127.0.0.1:4555",
      headers: { Authorization: "Basic generated" },
      directory: "/workspace/ax-code",
      scheduledTaskExecution: {
        owner: "desktop-sidecar",
        stopsOnAppQuit: true,
      },
    })
  })

  test("rejects untrusted senders before command execution", async () => {
    const backend = new DesktopBackendManager()
    const invoke = createDesktopBridgeHandler({
      backend,
      sender: { url: "https://example.com/" },
    })

    await expect(invoke("diagnostics.read", {})).rejects.toThrow("Untrusted desktop bridge sender")
  })

  test("routes host capabilities through validated bridge commands", async () => {
    const opened: string[] = []
    const revealed: string[] = []
    const notifications: unknown[] = []
    const backend = new DesktopBackendManager()
    const invoke = createDesktopBridgeHandler({
      backend,
      sender: { url: "app://ax-code/index.html" },
      host: {
        async openExternal(url) {
          opened.push(url)
        },
        async chooseDirectory() {
          return { path: "/workspace/ax-code", canceled: false }
        },
        async revealPath(path) {
          revealed.push(path)
        },
        async showNotification(input) {
          notifications.push(input)
          return true
        },
      },
    })

    expect(await invoke("external.open", { url: "https://example.com/docs" })).toBe(true)
    expect(opened).toEqual(["https://example.com/docs"])
    expect(await invoke("dialog.chooseDirectory", { title: "Choose project" })).toEqual({
      path: "/workspace/ax-code",
      canceled: false,
    })
    expect(await invoke("path.reveal", { path: "/workspace/ax-code/packages/app/src/App.tsx" })).toBe(true)
    expect(revealed).toEqual(["/workspace/ax-code/packages/app/src/App.tsx"])
    expect(
      await invoke("notification.show", {
        title: "Scheduled automation queued",
        body: "Daily branch review",
        source: "scheduled-task",
      }),
    ).toBe(true)
    expect(notifications).toEqual([
      {
        title: "Scheduled automation queued",
        body: "Daily branch review",
        source: "scheduled-task",
      },
    ])
  })

  test("rejects unsafe external URLs before host capability execution", async () => {
    const backend = new DesktopBackendManager()
    const invoke = createDesktopBridgeHandler({
      backend,
      sender: { url: "app://ax-code/index.html" },
      host: {
        async openExternal() {
          throw new Error("should not open")
        },
        async chooseDirectory() {
          return { canceled: true }
        },
        async revealPath() {
          throw new Error("should not reveal")
        },
        async showNotification() {
          throw new Error("should not notify")
        },
      },
    })

    await expect(invoke("external.open", { url: "file:///tmp/secret" })).rejects.toThrow("url must use http or https")
  })

  test("resolves relative reveal paths against the sidecar directory", async () => {
    const revealed: string[] = []
    const backend = new DesktopBackendManager({
      startBackend: async () => ({
        url: "http://127.0.0.1:4555",
        headers: {},
        close: async () => undefined,
      }),
    })
    const invoke = createDesktopBridgeHandler({
      backend,
      sender: { url: "app://ax-code/index.html" },
      host: {
        async openExternal() {},
        async chooseDirectory() {
          return { canceled: true }
        },
        async revealPath(path) {
          revealed.push(path)
        },
        async showNotification() {
          return false
        },
      },
    })

    await invoke("backend.start", { directory: "/workspace/ax-code" })
    await invoke("path.reveal", { path: "packages/app/src/App.tsx" })

    expect(revealed).toEqual(["/workspace/ax-code/packages/app/src/App.tsx"])
  })

  test("does not expose backend auth headers through diagnostics", async () => {
    const backend = new DesktopBackendManager({
      startBackend: async () => ({
        url: "http://127.0.0.1:4555",
        headers: { Authorization: "Basic generated" },
        close: async () => undefined,
      }),
    })
    const invoke = createDesktopBridgeHandler({
      backend,
      sender: { url: "app://ax-code/index.html" },
    })

    await invoke("backend.start", { directory: "/workspace/ax-code" })
    const diagnosticsText = JSON.stringify(await invoke("diagnostics.read", {}))

    expect(diagnosticsText).not.toContain("Basic generated")
    expect(diagnosticsText).not.toContain("Authorization")
  })

  test("exposes release update policy diagnostics through platform capabilities", async () => {
    const backend = new DesktopBackendManager()
    const invoke = createDesktopBridgeHandler({
      backend,
      sender: { url: "app://ax-code/index.html" },
    })

    expect(await invoke("platform.capabilities", {})).toMatchObject({
      desktopBridge: true,
      release: {
        updatePolicy: "disabled-until-release-pipeline",
        signed: false,
        notarized: false,
        updaterConfigured: false,
      },
    })
  })
})
