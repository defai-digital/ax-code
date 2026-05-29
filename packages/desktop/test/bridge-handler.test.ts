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
      features: {
        terminalPane: true,
        browserPane: true,
        filePane: true,
      },
      scheduledTaskExecution: {
        owner: "desktop-sidecar",
        stopsOnAppQuit: true,
      },
    })
  })

  test("switches desktop backend connections when opening another project", async () => {
    const closed: string[] = []
    const backend = new DesktopBackendManager({
      startBackend: async (options) => {
        const directory = options.directory ?? "unknown"
        return {
          url: directory.endsWith("second") ? "http://127.0.0.1:4556" : "http://127.0.0.1:4555",
          headers: {},
          close: async () => {
            closed.push(directory)
          },
        }
      },
    })
    const invoke = createDesktopBridgeHandler({
      backend,
      sender: { url: "app://ax-code/index.html" },
    })

    await invoke("backend.start", { directory: "/workspace/first" })
    const connection = await invoke("backend.start", { directory: "/workspace/second" })

    expect(closed).toEqual(["/workspace/first"])
    expect(connection).toMatchObject({
      url: "http://127.0.0.1:4556",
      directory: "/workspace/second",
      mode: "start",
    })
    expect(await invoke("app.config", {})).toMatchObject({
      baseUrl: "http://127.0.0.1:4556",
      directory: "/workspace/second",
    })
  })

  test("rejects untrusted senders before command execution", async () => {
    const backend = new DesktopBackendManager({
      startBackend: async () => ({
        url: "http://127.0.0.1:4555",
        headers: {},
        close: async () => undefined,
      }),
    })
    const invoke = createDesktopBridgeHandler({
      backend,
      sender: { url: "https://example.com/" },
    })

    await expect(invoke("diagnostics.read", {})).rejects.toThrow("Untrusted desktop bridge sender")
  })

  test("rejects ADR-023 remote surface senders before desktop bridge execution", async () => {
    const backend = new DesktopBackendManager()
    const senders = [
      { surface: "remote host", url: "https://remote.ax-code.example/app" },
      { surface: "tunnel", url: "https://ax-code.trycloudflare.example/app" },
      { surface: "PWA/network", url: "https://app.ax-code.example/" },
      { surface: "VS Code webview", url: "vscode-webview://ax-code-desktop/index.html" },
    ]

    for (const sender of senders) {
      const invoke = createDesktopBridgeHandler({
        backend,
        sender: { url: sender.url },
        host: {
          async openExternal() {
            throw new Error(`${sender.surface} must not open external URLs`)
          },
          async chooseDirectory() {
            throw new Error(`${sender.surface} must not reach desktop dialogs`)
          },
          async revealPath() {
            throw new Error(`${sender.surface} must not reveal paths`)
          },
          async openEditor() {
            throw new Error(`${sender.surface} must not open editor`)
          },
          async openUpdateArtifact() {
            throw new Error(`${sender.surface} must not open update artifacts`)
          },
          async showNotification() {
            throw new Error(`${sender.surface} must not show notifications`)
          },
        },
      })

      await expect(invoke("dialog.chooseDirectory", { title: "Choose project" })).rejects.toThrow(
        "Untrusted desktop bridge sender",
      )
    }
  })

  test("trusts a loopback dev renderer only when the host plan opts in", async () => {
    const backend = new DesktopBackendManager({
      startBackend: async () => ({
        url: "http://127.0.0.1:4555",
        headers: {},
        close: async () => undefined,
      }),
    })
    const invoke = createDesktopBridgeHandler({
      backend,
      sender: { url: "http://127.0.0.1:5173/" },
      senderValidation: { trustedOrigins: ["http://127.0.0.1:5173"] },
    })

    await expect(invoke("diagnostics.read", {})).resolves.toMatchObject({ status: "idle" })
  })

  test("routes host capabilities through validated bridge commands", async () => {
    const opened: string[] = []
    const revealed: string[] = []
    const editorOpened: unknown[] = []
    const notifications: unknown[] = []
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
        async openExternal(url) {
          opened.push(url)
        },
        async chooseDirectory() {
          return { path: "/workspace/ax-code", canceled: false }
        },
        async revealPath(path) {
          revealed.push(path)
        },
        async openEditor(input) {
          editorOpened.push(input)
        },
        async openUpdateArtifact(path) {
          editorOpened.push({ updateArtifact: path })
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
    await invoke("backend.start", { directory: "/workspace/ax-code" })
    expect(await invoke("path.reveal", { path: "/workspace/ax-code/packages/app/src/App.tsx" })).toBe(true)
    expect(revealed).toEqual(["/workspace/ax-code/packages/app/src/App.tsx"])
    expect(await invoke("editor.open", { path: "/workspace/ax-code/packages/app/src/App.tsx", line: 12 })).toBe(true)
    expect(editorOpened).toEqual([{ path: "/workspace/ax-code/packages/app/src/App.tsx", line: 12 }])
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
        async openEditor() {
          throw new Error("should not open editor")
        },
        async openUpdateArtifact() {
          throw new Error("should not open update artifact")
        },
        async showNotification() {
          throw new Error("should not notify")
        },
      },
    })

    await expect(invoke("external.open", { url: "file:///tmp/secret" })).rejects.toThrow("url must use http or https")
  })

  test("resolves relative host paths against the sidecar directory", async () => {
    const revealed: string[] = []
    const editorOpened: unknown[] = []
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
        async openEditor(input) {
          editorOpened.push(input)
        },
        async openUpdateArtifact(path) {
          editorOpened.push({ updateArtifact: path })
        },
        async showNotification() {
          return false
        },
      },
    })

    await invoke("backend.start", { directory: "/workspace/ax-code" })
    await invoke("path.reveal", { path: "packages/app/src/App.tsx" })
    await invoke("editor.open", { path: "packages/app/src/App.tsx", line: 5, column: 3 })

    expect(revealed).toEqual(["/workspace/ax-code/packages/app/src/App.tsx"])
    expect(editorOpened).toEqual([{ path: "/workspace/ax-code/packages/app/src/App.tsx", line: 5, column: 3 }])
  })

  test("rejects desktop file actions without a connected workspace directory", async () => {
    const backend = new DesktopBackendManager()
    const invoke = createDesktopBridgeHandler({
      backend,
      sender: { url: "app://ax-code/index.html" },
      host: {
        async openExternal() {},
        async chooseDirectory() {
          return { canceled: true }
        },
        async revealPath() {
          throw new Error("should not reveal without a workspace directory")
        },
        async openEditor() {
          throw new Error("should not open without a workspace directory")
        },
        async openUpdateArtifact() {},
        async showNotification() {
          return false
        },
      },
    })

    await expect(invoke("path.reveal", { path: "packages/app/src/App.tsx" })).rejects.toThrow(
      "Desktop file actions require a connected workspace directory.",
    )
    await expect(invoke("editor.open", { path: "/tmp/outside.txt" })).rejects.toThrow(
      "Desktop file actions require a connected workspace directory.",
    )
  })

  test("rejects desktop file actions outside the connected workspace", async () => {
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
        async revealPath() {
          throw new Error("should not reveal outside the workspace")
        },
        async openEditor() {
          throw new Error("should not open outside the workspace")
        },
        async openUpdateArtifact() {},
        async showNotification() {
          return false
        },
      },
    })

    await invoke("backend.start", { directory: "/workspace/ax-code" })

    await expect(invoke("path.reveal", { path: "../secret.txt" })).rejects.toThrow(
      "Desktop file actions must stay inside the connected workspace.",
    )
    await expect(invoke("editor.open", { path: "/workspace/other/project.ts" })).rejects.toThrow(
      "Desktop file actions must stay inside the connected workspace.",
    )
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

    const capabilities = await invoke("platform.capabilities", {})
    expect(capabilities).toMatchObject({
      app: {
        name: "@ax-code/desktop",
      },
      renderer: {
        name: "@ax-code/app",
      },
      desktopBridge: true,
      release: {
        updatePolicy: "disabled-until-release-pipeline",
        signed: false,
        notarized: false,
        updaterConfigured: false,
      },
    })
    const capabilityRecord = capabilities as {
      app?: { version?: unknown }
      renderer?: { version?: unknown }
      capabilityProfiles?: unknown
    }
    expect(typeof capabilityRecord.app?.version).toBe("string")
    expect(typeof capabilityRecord.renderer?.version).toBe("string")
    const profiles = (
      Array.isArray(capabilityRecord.capabilityProfiles) ? capabilityRecord.capabilityProfiles : []
    ) as Array<{ id?: string }>
    expect(profiles.find((profile) => profile.id === "trusted-local-app")).toMatchObject({
      status: "enabled",
      bridge: "trusted-desktop",
    })
    expect(profiles.find((profile) => profile.id === "browser-preview")).toMatchObject({
      status: "enabled",
      bridge: "none",
    })
    expect(profiles.find((profile) => profile.id === "remote-host")).toMatchObject({
      status: "disabled",
      bridge: "none",
    })
  })

  test("checks updates only through the installed release feed", async () => {
    const backend = new DesktopBackendManager()
    const invoke = createDesktopBridgeHandler({
      backend,
      sender: { url: "app://ax-code/index.html" },
    })

    expect(await invoke("release.checkUpdate", {})).toMatchObject({
      status: "disabled",
      reason: "Update checks require an installed AX Code mac release manifest.",
    })
  })

  test("downloads updates only through the installed release feed", async () => {
    const backend = new DesktopBackendManager()
    const invoke = createDesktopBridgeHandler({
      backend,
      sender: { url: "app://ax-code/index.html" },
    })

    expect(await invoke("release.downloadUpdate", {})).toMatchObject({
      status: "disabled",
      reason: "Update checks require an installed AX Code mac release manifest.",
    })
  })

  test("opens downloaded updates only when release gates are enabled", async () => {
    const backend = new DesktopBackendManager()
    const invoke = createDesktopBridgeHandler({
      backend,
      sender: { url: "app://ax-code/index.html" },
    })

    expect(
      await invoke("release.openDownloadedUpdate", { artifactPath: "/tmp/ax-code-desktop-updates/app.zip" }),
    ).toMatchObject({
      status: "disabled",
      reason: "Applying updates requires an installed AX Code mac release manifest.",
    })
  })
})
