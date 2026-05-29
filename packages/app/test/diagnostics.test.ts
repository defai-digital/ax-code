import { describe, expect, test } from "bun:test"
import { createFixtureCommandCenterState } from "../src/projection/replay"
import { createCommandCenterViewModel } from "../src/projection/view-model"
import {
  createAppDiagnosticsReport,
  downloadDesktopUpdateArtifact,
  exportDesktopLogs,
  openDownloadedDesktopUpdateArtifact,
  readDesktopDiagnostics,
} from "../src/runtime/diagnostics"

describe("app diagnostics", () => {
  test("builds a structured fixture diagnostics report without backend secrets", () => {
    const view = createCommandCenterViewModel(createFixtureCommandCenterState())
    const report = createAppDiagnosticsReport({
      config: { mode: "fixture" },
      view,
      eventStream: {
        status: "fixture",
        appliedEvents: 0,
      },
    })

    expect(report.runtime).toMatchObject({
      mode: "fixture",
      authMode: "none",
      networkScope: "fixture",
      features: { terminalPane: true, browserPane: true, filePane: true },
    })
    expect(report.queue).toMatchObject({ total: 3, running: 1, blocked: 1, queued: 1, health: "blocked" })
    expect(report.renderer).toMatchObject({
      name: "@ax-code/app",
      version: "0.0.0",
      selectedSessionID: "ses_architecture",
      evidenceStatus: "ready",
    })
    expect(report.catalog).toMatchObject({
      providers: 3,
      models: 2,
      agents: 3,
      skills: { total: 2, warnings: 1 },
      mcp: { connected: 1, total: 3 },
      lsp: { connected: 2, total: 2, error: 0 },
      codeIndex: { state: "idle", pendingPlans: 1, nodeCount: 420 },
      permissionRules: 4,
    })
    expect(report.security).toMatchObject({
      bridgeAvailable: false,
      contentOrigin: "fixture",
      previewBridgeProfile: "separate-origin",
    })
    expect(JSON.stringify(report)).not.toContain("Authorization")
  })

  test("redacts live auth to configured mode and records scheduler ownership", () => {
    const view = createCommandCenterViewModel(createFixtureCommandCenterState())
    const report = createAppDiagnosticsReport({
      config: {
        mode: "live",
        baseUrl: "http://127.0.0.1:4096",
        headers: { Authorization: "Basic secret" },
        directory: "/workspace/ax-code",
        features: { terminalPane: false, browserPane: true },
        scheduledTaskExecution: { owner: "desktop-sidecar", stopsOnAppQuit: true },
      },
      view,
      eventStream: {
        status: "connected",
        appliedEvents: 7,
        lastEventAt: 1_000,
      },
    })

    expect(report.runtime).toMatchObject({
      mode: "live",
      backendUrl: "http://127.0.0.1:4096",
      directory: "/workspace/ax-code",
      authMode: "configured",
      networkScope: "loopback",
      features: { terminalPane: false, browserPane: true, filePane: true },
      scheduledTaskOwner: "desktop-sidecar",
      scheduledTasksStopOnQuit: true,
    })
    expect(JSON.stringify(report)).not.toContain("Basic secret")
  })

  test("surfaces remote backend network warnings in runtime diagnostics", () => {
    const view = createCommandCenterViewModel(createFixtureCommandCenterState())
    const report = createAppDiagnosticsReport({
      config: {
        mode: "live",
        baseUrl: "https://example.com",
      },
      view,
      eventStream: {
        status: "connecting",
        appliedEvents: 0,
      },
    })

    expect(report.runtime).toMatchObject({
      mode: "live",
      networkScope: "remote",
      networkWarning: "Remote backend URL configured; trusted desktop bridge capabilities require loopback.",
    })
  })

  test("reads desktop diagnostics and log exports through typed bridge commands", async () => {
    const calls: Array<{ name: string; payload: unknown }> = []
    const bridge = {
      async invoke(
        name:
          | "diagnostics.read"
          | "diagnostics.exportLogs"
          | "platform.capabilities"
          | "release.checkUpdate"
          | "release.downloadUpdate"
          | "release.openDownloadedUpdate",
        payload: unknown,
      ) {
        calls.push({ name, payload })
        if (name === "diagnostics.read") {
          return {
            status: "running",
            mode: "start",
            url: "http://127.0.0.1:4096",
            loopbackOnly: true,
            generatedAuth: true,
            logs: [{ stream: "system", line: "ready", time: 1 }],
          }
        }
        if (name === "platform.capabilities") {
          return {
            app: {
              name: "@ax-code/desktop",
              version: "0.0.0",
            },
            renderer: {
              name: "@ax-code/app",
              version: "0.0.0",
            },
            platform: "darwin",
            arch: "arm64",
            desktopBridge: true,
            security: {
              contentOrigin: "custom-protocol",
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
            capabilityProfiles: [
              {
                id: "trusted-local-app",
                label: "Trusted local desktop app",
                status: "enabled",
                bridge: "trusted-desktop",
                commands: ["platform.capabilities", "backend.start"],
              },
              {
                id: "browser-preview",
                label: "Browser preview",
                status: "enabled",
                bridge: "none",
                commands: [],
              },
              {
                id: "remote-host",
                label: "Remote host",
                status: "disabled",
                bridge: "none",
                commands: [],
              },
              {
                id: "tunnel",
                label: "Tunnel",
                status: "disabled",
                bridge: "none",
                commands: [],
              },
              {
                id: "pwa-network",
                label: "PWA/network",
                status: "disabled",
                bridge: "none",
                commands: [],
              },
              {
                id: "vscode-webview",
                label: "VS Code webview",
                status: "disabled",
                bridge: "none",
                commands: [],
              },
            ],
            release: {
              status: "manifest-found",
              updatePolicy: "disabled-until-release-pipeline",
              packageTarget: "mac",
              signed: false,
              notarized: false,
              updaterConfigured: false,
              gates: {
                signing: { configured: false, status: "blocked", reason: "missing identity" },
              },
            },
          }
        }
        if (name === "release.checkUpdate") {
          throw new Error("release.checkUpdate should not run for disabled updater")
        }
        return { text: "2026-05-29T00:00:00.000Z [system] ready" }
      },
    }

    const desktop = await readDesktopDiagnostics(bridge)
    const logs = await exportDesktopLogs(bridge)

    expect(desktop).toMatchObject({
      available: true,
      backend: {
        status: "running",
        mode: "start",
        url: "http://127.0.0.1:4096",
        loopbackOnly: true,
        generatedAuth: true,
        logLines: 1,
      },
      capabilities: {
        app: {
          name: "@ax-code/desktop",
          version: "0.0.0",
        },
        renderer: {
          name: "@ax-code/app",
          version: "0.0.0",
        },
        platform: "darwin",
        arch: "arm64",
        desktopBridge: true,
        security: {
          contentOrigin: "custom-protocol",
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
        capabilityProfiles: [
          {
            id: "trusted-local-app",
            status: "enabled",
            bridge: "trusted-desktop",
            commands: ["platform.capabilities", "backend.start"],
          },
          {
            id: "browser-preview",
            status: "enabled",
            bridge: "none",
            commands: [],
          },
          {
            id: "remote-host",
            status: "disabled",
            bridge: "none",
            commands: [],
          },
          {
            id: "tunnel",
            status: "disabled",
            bridge: "none",
            commands: [],
          },
          {
            id: "pwa-network",
            status: "disabled",
            bridge: "none",
            commands: [],
          },
          {
            id: "vscode-webview",
            status: "disabled",
            bridge: "none",
            commands: [],
          },
        ],
        release: {
          status: "manifest-found",
          updatePolicy: "disabled-until-release-pipeline",
          signed: false,
          updaterConfigured: false,
          gates: {
            signing: { status: "blocked" },
          },
        },
      },
      releaseReadiness: {
        status: "internal-beta",
        blockedGates: [{ name: "signing", reason: "missing identity" }],
      },
    })
    const report = createAppDiagnosticsReport({
      config: { mode: "fixture" },
      view: createCommandCenterViewModel(createFixtureCommandCenterState()),
      eventStream: { status: "fixture", appliedEvents: 0 },
      desktop,
    })
    expect(report.security.capabilityProfiles).toMatchObject({
      enabled: 2,
      disabled: 4,
      remoteDisabled: true,
      previewBridge: "none",
    })
    expect(logs).toMatchObject({
      available: true,
      text: "2026-05-29T00:00:00.000Z [system] ready",
    })
    expect(logs.length).toBe(logs.text.length)
    expect(calls.map((call) => call.name)).toEqual([
      "diagnostics.read",
      "platform.capabilities",
      "diagnostics.exportLogs",
    ])
  })

  test("runs desktop update check when a release feed is configured", async () => {
    const calls: string[] = []
    const bridge = {
      async invoke(
        name:
          | "diagnostics.read"
          | "diagnostics.exportLogs"
          | "platform.capabilities"
          | "release.checkUpdate"
          | "release.downloadUpdate"
          | "release.openDownloadedUpdate",
      ) {
        calls.push(name)
        if (name === "diagnostics.read") return { status: "closed" }
        if (name === "platform.capabilities") {
          return {
            release: {
              status: "manifest-found",
              updatePolicy: "feed-configured",
              packageTarget: "mac",
              signed: true,
              notarized: true,
              updaterConfigured: true,
              updateFeed: {
                url: "https://updates.example.test/ax-code/",
                artifactName: "AX Code.app.zip",
                sha256: "a".repeat(64),
                sizeBytes: 123,
              },
            },
          }
        }
        if (name === "release.checkUpdate") {
          return {
            status: "available",
            currentVersion: "1.2.3",
            latestVersion: "1.2.4",
            artifactUrl: "https://updates.example.test/ax-code/AX%20Code.app.zip",
          }
        }
        return { text: "" }
      },
    }

    const desktop = await readDesktopDiagnostics(bridge)

    expect(calls).toEqual(["diagnostics.read", "platform.capabilities", "release.checkUpdate"])
    expect(desktop.capabilities?.release?.updateFeed).toMatchObject({
      url: "https://updates.example.test/ax-code/",
      artifactName: "AX Code.app.zip",
    })
    expect(desktop.capabilities?.update).toMatchObject({
      status: "available",
      currentVersion: "1.2.3",
      latestVersion: "1.2.4",
    })
    expect(desktop.releaseReadiness).toMatchObject({
      status: "release-ready",
      summary: "Signed, notarized, and update-feed-backed desktop release.",
    })
  })

  test("downloads desktop update artifacts through the typed bridge command", async () => {
    const calls: string[] = []
    const bridge = {
      async invoke(
        name:
          | "diagnostics.read"
          | "diagnostics.exportLogs"
          | "platform.capabilities"
          | "release.checkUpdate"
          | "release.downloadUpdate"
          | "release.openDownloadedUpdate",
      ) {
        calls.push(name)
        if (name === "release.downloadUpdate") {
          return {
            status: "downloaded",
            latestVersion: "1.2.4",
            artifactPath: "/tmp/ax-code-desktop-updates/1.2.4-AX%20Code.app.zip",
            artifactUrl: "https://updates.example.test/ax-code/AX%20Code.app.zip",
            sha256: "b".repeat(64),
            sizeBytes: 456,
          }
        }
        return {}
      },
    }

    const result = await downloadDesktopUpdateArtifact(bridge)

    expect(calls).toEqual(["release.downloadUpdate"])
    expect(result).toMatchObject({
      available: true,
      status: "downloaded",
      latestVersion: "1.2.4",
      artifactPath: "/tmp/ax-code-desktop-updates/1.2.4-AX%20Code.app.zip",
      sha256: "b".repeat(64),
      sizeBytes: 456,
    })
  })

  test("opens downloaded desktop updates through the typed bridge command", async () => {
    const calls: unknown[] = []
    const bridge = {
      async invoke(
        name:
          | "diagnostics.read"
          | "diagnostics.exportLogs"
          | "platform.capabilities"
          | "release.checkUpdate"
          | "release.downloadUpdate"
          | "release.openDownloadedUpdate",
        payload: unknown,
      ) {
        calls.push({ name, payload })
        if (name === "release.openDownloadedUpdate") {
          return {
            status: "opened",
            artifactPath: "/tmp/ax-code-desktop-updates/1.2.4-AX%20Code.app.zip",
          }
        }
        return {}
      },
    }

    const result = await openDownloadedDesktopUpdateArtifact(
      " /tmp/ax-code-desktop-updates/1.2.4-AX%20Code.app.zip ",
      bridge,
    )

    expect(calls).toEqual([
      {
        name: "release.openDownloadedUpdate",
        payload: { artifactPath: "/tmp/ax-code-desktop-updates/1.2.4-AX%20Code.app.zip" },
      },
    ])
    expect(result).toMatchObject({
      available: true,
      status: "opened",
      artifactPath: "/tmp/ax-code-desktop-updates/1.2.4-AX%20Code.app.zip",
    })
  })
})
