import { describe, expect, test } from "bun:test"
import { createFixtureCommandCenterState } from "../src/projection/replay"
import { createCommandCenterViewModel } from "../src/projection/view-model"
import { createAppDiagnosticsReport, exportDesktopLogs, readDesktopDiagnostics } from "../src/runtime/diagnostics"

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

    expect(report.runtime).toMatchObject({ mode: "fixture", authMode: "none" })
    expect(report.queue).toMatchObject({ total: 3, running: 1, blocked: 1, queued: 1, health: "blocked" })
    expect(report.renderer).toMatchObject({
      name: "@ax-code/app",
      version: "0.0.0",
      selectedSessionID: "ses_architecture",
      evidenceStatus: "ready",
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
      scheduledTaskOwner: "desktop-sidecar",
      scheduledTasksStopOnQuit: true,
    })
    expect(JSON.stringify(report)).not.toContain("Basic secret")
  })

  test("reads desktop diagnostics and log exports through typed bridge commands", async () => {
    const calls: Array<{ name: string; payload: unknown }> = []
    const bridge = {
      async invoke(name: "diagnostics.read" | "diagnostics.exportLogs" | "platform.capabilities", payload: unknown) {
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
            platform: "darwin",
            arch: "arm64",
            desktopBridge: true,
            security: {
              contentOrigin: "custom-protocol",
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
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
        platform: "darwin",
        arch: "arm64",
        desktopBridge: true,
        security: {
          contentOrigin: "custom-protocol",
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
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
})
