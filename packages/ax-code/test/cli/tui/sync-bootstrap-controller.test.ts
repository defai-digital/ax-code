import { describe, expect, test, vi } from "vitest"
import { setTimeout as sleep } from "node:timers/promises"
import { createBootstrapController } from "../../../src/cli/cmd/tui/context/sync-bootstrap-controller"

describe("tui sync bootstrap controller", () => {
  test("deduplicates concurrent bootstrap runs and allows a new run after completion", async () => {
    let calls = 0
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })

    const controller = createBootstrapController({
      name: "test-bootstrap",
      run: async () => {
        calls++
        await pending
      },
    })

    const first = controller.run()
    const second = controller.run()

    expect(first).toBe(second)
    await Promise.resolve()
    expect(calls).toBe(1)

    release?.()
    await first

    await controller.run()
    expect(calls).toBe(2)
  })

  test("clears in-flight state after failures so retries can run", async () => {
    let calls = 0
    const controller = createBootstrapController({
      name: "test-bootstrap",
      run: async () => {
        calls++
        throw new Error(`bootstrap failed ${calls}`)
      },
    })

    await expect(controller.run()).rejects.toThrow("bootstrap failed 1")
    await expect(controller.run()).rejects.toThrow("bootstrap failed 2")
    expect(calls).toBe(2)
  })

  test("reports background async failures without throwing to the caller", async () => {
    const warnings: string[] = []
    const controller = createBootstrapController({
      name: "test-bootstrap",
      run: async () => {
        throw new Error("background async failed")
      },
      onBackgroundFailure(error) {
        warnings.push(String(error))
      },
    })

    controller.runInBackground()
    await sleep(0)

    expect(warnings).toEqual(["Error: background async failed"])
  })

  test("reports background synchronous throws without throwing to the caller", async () => {
    const warnings: string[] = []
    const controller = createBootstrapController({
      name: "test-bootstrap",
      run: () => {
        throw new Error("background sync failed")
      },
      onBackgroundFailure(error) {
        warnings.push(String(error))
      },
    })

    controller.runInBackground()
    await sleep(0)

    expect(warnings).toEqual(["Error: background sync failed"])
  })

  test("keeps background failure handler throws inside the TUI background boundary", async () => {
    const originalError = new Error("bootstrap failed")
    const handlerError = new Error("handler failed")
    const logger = { warn: vi.fn() }
    const controller = createBootstrapController({
      name: "test-bootstrap",
      logger,
      run: async () => {
        throw originalError
      },
      onBackgroundFailure() {
        throw handlerError
      },
    })

    controller.runInBackground()
    await sleep(0)

    expect(logger.warn).toHaveBeenCalledWith("tui background task error handler failed", {
      taskName: "test-bootstrap",
      error: handlerError,
      originalError,
    })
  })
})
