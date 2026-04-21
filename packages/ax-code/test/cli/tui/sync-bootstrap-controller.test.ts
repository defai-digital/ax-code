import { describe, expect, test } from "bun:test"
import { createBootstrapController } from "../../../src/cli/cmd/tui/context/sync-bootstrap-controller"

describe("tui sync bootstrap controller", () => {
  test("deduplicates concurrent bootstrap runs and allows a new run after completion", async () => {
    let calls = 0
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })

    const controller = createBootstrapController({
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
      run: async () => {
        throw new Error("background async failed")
      },
      onBackgroundFailure(error) {
        warnings.push(String(error))
      },
    })

    controller.runInBackground()
    await Bun.sleep(0)

    expect(warnings).toEqual(["Error: background async failed"])
  })

  test("reports background synchronous throws without throwing to the caller", async () => {
    const warnings: string[] = []
    const controller = createBootstrapController({
      run: () => {
        throw new Error("background sync failed")
      },
      onBackgroundFailure(error) {
        warnings.push(String(error))
      },
    })

    controller.runInBackground()
    await Bun.sleep(0)

    expect(warnings).toEqual(["Error: background sync failed"])
  })
})
