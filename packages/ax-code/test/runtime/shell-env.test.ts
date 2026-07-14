import { PassThrough } from "node:stream"
import { describe, expect, test, vi } from "vitest"
import { waitForShellEnvCapture } from "../../src/runtime/shell-env"

describe("shell environment capture", () => {
  test("releases a stuck login shell instead of blocking provider startup", async () => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const unref = vi.fn()
    const onTimeout = vi.fn()
    const started = Date.now()

    const result = await waitForShellEnvCapture(
      {
        exited: new Promise<number>(() => {}),
        stdout,
        stderr,
        unref,
      },
      10,
      onTimeout,
    )

    expect(result).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(500)
    expect(onTimeout).toHaveBeenCalledOnce()
    expect(unref).toHaveBeenCalledOnce()
    expect(stdout.destroyed).toBe(true)
    expect(stderr.destroyed).toBe(true)
  })
})
