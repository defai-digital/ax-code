import { describe, expect, test } from "bun:test"
import { assertTrustedRendererBridgeCall, createRendererDesktopBridge } from "../src/bridge/renderer-bridge"
import { parseBridgeCommand, validateBridgeSender } from "../src/bridge/schema"

describe("desktop bridge contract", () => {
  test("accepts only declared bridge commands with valid payloads", () => {
    expect(parseBridgeCommand("platform.capabilities", {}).name).toBe("platform.capabilities")
    expect(parseBridgeCommand("release.checkUpdate", {}).name).toBe("release.checkUpdate")
    expect(parseBridgeCommand("release.downloadUpdate", {}).name).toBe("release.downloadUpdate")
    const attach = parseBridgeCommand("backend.attach", {
      baseUrl: "http://localhost:4096/",
      authHeader: "Basic token",
    })
    expect(attach.payload.baseUrl).toBe("http://localhost:4096/")
    expect(
      parseBridgeCommand("release.openDownloadedUpdate", {
        artifactPath: "/tmp/ax-code-desktop-updates/1.2.4-AX-Code.app.zip",
      }).payload.artifactPath,
    ).toBe("/tmp/ax-code-desktop-updates/1.2.4-AX-Code.app.zip")
    expect(parseBridgeCommand("external.open", { url: "https://example.com" }).payload.url).toBe("https://example.com")
    expect(
      parseBridgeCommand("path.reveal", { path: "/workspace/ax-code/packages/app/src/App.tsx" }).payload.path,
    ).toBe("/workspace/ax-code/packages/app/src/App.tsx")
    expect(
      parseBridgeCommand("editor.open", {
        path: "/workspace/ax-code/packages/app/src/App.tsx",
        line: 42,
        column: 7,
      }).payload,
    ).toEqual({
      path: "/workspace/ax-code/packages/app/src/App.tsx",
      line: 42,
      column: 7,
    })
    expect(
      parseBridgeCommand("notification.show", {
        title: "Scheduled automation queued",
        body: "Daily branch review",
        source: "scheduled-task",
      }).payload.source,
    ).toBe("scheduled-task")

    expect(() => parseBridgeCommand("external.open", { url: "javascript:alert(1)" })).toThrow()
    expect(() => parseBridgeCommand("backend.attach", { baseUrl: "https://example.com/" })).toThrow()
    expect(() => parseBridgeCommand("backend.attach", { baseUrl: "file:///tmp/backend.sock" })).toThrow()
    expect(() => parseBridgeCommand("backend.start", { directory: "" })).toThrow()
    expect(() => parseBridgeCommand("backend.stop", {})).toThrow("Unsupported desktop bridge command: backend.stop")
    expect(() => parseBridgeCommand("release.openDownloadedUpdate", { artifactPath: "" })).toThrow()
    expect(() => parseBridgeCommand("path.reveal", { path: "" })).toThrow()
    expect(() => parseBridgeCommand("editor.open", { path: "", line: 1 })).toThrow()
    expect(() => parseBridgeCommand("editor.open", { path: "/workspace/ax-code", line: 0 })).toThrow()
    expect(() => parseBridgeCommand("notification.show", { title: "", source: "unknown" })).toThrow()
  })

  test("validates desktop sender origin before privileged bridge calls", () => {
    expect(validateBridgeSender({ url: "app://ax-code/index.html" })).toBe(true)
    expect(validateBridgeSender({ url: "app://ax-code/index.html", frameUrl: "app://ax-code/index.html" })).toBe(true)
    expect(
      validateBridgeSender({ url: "app://ax-code/index.html", frameUrl: "app://ax-code/index.html?frame=1" }),
    ).toBe(false)
    expect(validateBridgeSender({ url: "http://127.0.0.1:3137/" })).toBe(false)
    expect(
      validateBridgeSender(
        { url: "http://127.0.0.1:3137/", frameUrl: "http://127.0.0.1:3137/" },
        { trustedOrigins: ["http://127.0.0.1:3137"] },
      ),
    ).toBe(true)
    expect(
      validateBridgeSender(
        { url: "http://127.0.0.1:3138/", frameUrl: "http://127.0.0.1:3138/" },
        { trustedOrigins: ["http://127.0.0.1:3137"] },
      ),
    ).toBe(false)
    expect(validateBridgeSender({ url: "app://ax-code/index.html", frameUrl: "http://localhost:3137/" })).toBe(false)
    expect(
      validateBridgeSender(
        { url: "http://127.0.0.1:3137/", frameUrl: "http://localhost:3137/" },
        { trustedOrigins: ["http://127.0.0.1:3137"] },
      ),
    ).toBe(false)
    expect(validateBridgeSender({ url: "https://attacker.example/" })).toBe(false)
    expect(validateBridgeSender({ url: "file:///tmp/app.html" })).toBe(false)
  })

  test("rejects ADR-023 remote surface senders by default", () => {
    const senders = [
      { surface: "remote host", url: "https://remote.ax-code.example/app" },
      { surface: "tunnel", url: "https://ax-code.trycloudflare.example/app" },
      { surface: "PWA/network", url: "https://app.ax-code.example/" },
      { surface: "VS Code webview", url: "vscode-webview://ax-code-desktop/index.html" },
    ]

    for (const sender of senders) {
      expect(validateBridgeSender({ url: sender.url })).toBe(false)
      expect(
        validateBridgeSender({
          url: sender.url,
          frameUrl: sender.url,
        }),
      ).toBe(false)
    }
  })

  test("never exposes a generic raw invoke without command parsing", async () => {
    const calls: Array<{ name: string; payload: unknown }> = []
    const bridge = createRendererDesktopBridge(async (name, payload) => {
      calls.push({ name, payload })
      return { ok: true }
    })

    await bridge.invoke("diagnostics.exportLogs", { includeBackendLogs: false })

    expect(calls).toEqual([{ name: "diagnostics.exportLogs", payload: { includeBackendLogs: false } }])
    expect(() =>
      assertTrustedRendererBridgeCall({ url: "https://attacker.example/" }, "diagnostics.exportLogs", {
        includeBackendLogs: false,
      }),
    ).toThrow()
  })
})
