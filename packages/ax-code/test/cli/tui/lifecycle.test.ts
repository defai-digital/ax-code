import { describe, expect, test, vi } from "vitest"
import {
  registerTuiEventListener,
  registerTuiProcessHandler,
  runTuiCleanup,
} from "../../../src/cli/cmd/tui/util/lifecycle"

describe("tui lifecycle helpers", () => {
  test("registers event listeners with an idempotent cleanup", () => {
    const target = new EventTarget()
    const handler = vi.fn()

    const cleanup = registerTuiEventListener(target, "ready", handler, { name: "ready-listener" })
    target.dispatchEvent(new Event("ready"))
    cleanup()
    cleanup()
    target.dispatchEvent(new Event("ready"))

    expect(handler).toHaveBeenCalledTimes(1)
  })

  test("reports cleanup failures without throwing", () => {
    const logger = { warn: vi.fn() }
    const error = new Error("cleanup failed")

    expect(() =>
      runTuiCleanup(
        () => {
          throw error
        },
        { name: "cleanup-task", logger },
      ),
    ).not.toThrow()

    expect(logger.warn).toHaveBeenCalledWith("tui cleanup failed", {
      lifecycleName: "cleanup-task",
      error,
    })
  })

  test("registers process handlers with an idempotent cleanup", () => {
    const handler = vi.fn()
    const before = process.listenerCount("warning")

    const cleanup = registerTuiProcessHandler("warning", handler, { name: "warning-handler" })

    expect(process.listenerCount("warning")).toBe(before + 1)
    cleanup()
    cleanup()
    expect(process.listenerCount("warning")).toBe(before)
  })
})
