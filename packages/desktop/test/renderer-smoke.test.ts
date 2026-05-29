import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { assertRendererSmokeResult, runRendererSmoke, type RendererSmokeResult } from "../src/packaging/renderer-smoke"

describe("renderer browser smoke contract", () => {
  test("fails when renderer dist is missing before starting Electron", async () => {
    await expect(runRendererSmoke({ appDist: "/tmp/ax-code-missing-renderer-dist" })).rejects.toThrow(
      "Renderer dist is missing",
    )
  })

  test("keeps the smoke app protocol handler fail-closed for malformed paths", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "../src/packaging/renderer-smoke.ts"), "utf8")

    expect(source).toContain("safeDecodePathname(url.pathname)")
    expect(source).toContain("function safeDecodePathname(pathname)")
    expect(source).not.toContain("const pathname = decodeURIComponent(url.pathname)")
  })

  test("documents the browser-backed command-center checks", () => {
    const result = {
      rendererUrl: "app://ax-code/index.html",
      appDist: "/workspace/ax-code/packages/desktop/dist/app",
      viewports: [
        {
          width: 1280,
          height: 800,
          checks: {
            nonblankText: 1200,
            appShell: true,
            queueItems: 3,
            sessionButtons: 2,
            ariaLive: true,
            reconnectBanner: true,
            tabCount: 3,
            tabPanel: true,
            focusVisibleRule: true,
            keyboardFlow: {
              visitedCount: 24,
              uniqueFocusCount: 16,
              firstLabel: "Skip to work surface",
              requiredLabels: {
                "Skip to work surface": true,
                "ax-code": true,
                "Send now": true,
                Pause: true,
                Terminal: true,
                Browser: true,
                File: true,
                Run: true,
                Queue: true,
                "Project default model": true,
              },
              visitedLabels: ["Skip to work surface", "ax-code", "Send now", "Pause", "Terminal", "Run", "Queue"],
            },
            accessibilityIssues: [],
            requiredText: {
              "Task queue": true,
              "Event stream": true,
              Approvals: true,
              Review: true,
              Diagnostics: true,
              Worktrees: true,
              Automations: true,
              "Project defaults": true,
              "Backend reload required": true,
              "Runtime probes": true,
              "Code index": true,
              "Branch rank": true,
            },
            actionButtons: {
              Run: true,
              Queue: true,
              Abort: true,
              "Send now": true,
              Pause: true,
              Edit: true,
              Remove: true,
              Always: true,
              "Submit answer": true,
              "Open update": true,
              "Refresh probes": true,
            },
            documentWidth: 1280,
            viewportWidth: 1280,
            overflowElements: [],
          },
        },
      ],
      checks: {
        electronBrowser: true,
        nonblank: true,
        commandCenter: true,
        actions: true,
        accessibility: true,
        desktopViewports: true,
      },
    } satisfies RendererSmokeResult

    expect(result.checks).toMatchObject({
      electronBrowser: true,
      nonblank: true,
      commandCenter: true,
      actions: true,
      accessibility: true,
      desktopViewports: true,
    })
  })

  test("fails when visible content is clipped inside a fixed-width control", () => {
    const result = {
      rendererUrl: "app://ax-code/index.html",
      appDist: "/workspace/ax-code/packages/desktop/dist/app",
      viewports: [
        {
          width: 1280,
          height: 800,
          checks: {
            nonblankText: 1200,
            appShell: true,
            queueItems: 3,
            sessionButtons: 2,
            ariaLive: true,
            reconnectBanner: true,
            tabCount: 3,
            tabPanel: true,
            focusVisibleRule: true,
            keyboardFlow: {
              visitedCount: 24,
              uniqueFocusCount: 16,
              firstLabel: "Skip to work surface",
              requiredLabels: {
                "Skip to work surface": true,
                "ax-code": true,
                "Send now": true,
                Pause: true,
                Terminal: true,
                Browser: true,
                File: true,
                Run: true,
                Queue: true,
                "Project default model": true,
              },
              visitedLabels: ["Skip to work surface", "ax-code", "Send now", "Pause", "Terminal", "Run", "Queue"],
            },
            accessibilityIssues: [],
            requiredText: {
              "Task queue": true,
              "Event stream": true,
              Approvals: true,
              Review: true,
              Diagnostics: true,
              Worktrees: true,
              Automations: true,
              "Project defaults": true,
              "Backend reload required": true,
              "Runtime probes": true,
              "Code index": true,
              "Branch rank": true,
            },
            actionButtons: {
              Run: true,
              Queue: true,
              Abort: true,
              "Send now": true,
              Pause: true,
              Edit: true,
              Remove: true,
              Always: true,
              "Submit answer": true,
              "Open update": true,
              "Refresh probes": true,
            },
            documentWidth: 1280,
            viewportWidth: 1280,
            overflowElements: [
              {
                tag: "small",
                className: "",
                label: "long status label",
                width: 120,
                right: 600,
                clientWidth: 120,
                scrollWidth: 260,
              },
            ],
          },
        },
      ],
      checks: {
        electronBrowser: true,
        nonblank: true,
        commandCenter: true,
        actions: true,
        accessibility: true,
        desktopViewports: true,
      },
    } satisfies RendererSmokeResult

    expect(() => assertRendererSmokeResult(result)).toThrow("clipped or overflowing content")
  })
})
