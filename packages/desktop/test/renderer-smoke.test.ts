import { describe, expect, test } from "bun:test"
import { runRendererSmoke, type RendererSmokeResult } from "../src/packaging/renderer-smoke"

describe("renderer browser smoke contract", () => {
  test("fails when renderer dist is missing before starting Electron", async () => {
    await expect(runRendererSmoke({ appDist: "/tmp/ax-code-missing-renderer-dist" })).rejects.toThrow(
      "Renderer dist is missing",
    )
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
            tabCount: 3,
            tabPanel: true,
            requiredText: {
              "Task queue": true,
              Approvals: true,
              Review: true,
              Diagnostics: true,
              Worktrees: true,
              Automations: true,
            },
            actionButtons: {
              Run: true,
              Queue: true,
              Abort: true,
              "Send now": true,
              Pause: true,
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
})
