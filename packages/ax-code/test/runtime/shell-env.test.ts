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

  test("keeps the env when a background child left the pipe open and it was destroyed after exit", async () => {
    // e.g. a profile that starts ssh-agent: Process.spawn destroys the pipe
    // after exit, which closes it without an end event.
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    stdout.write("API_HOST=example.test\0")
    setTimeout(() => {
      stdout.destroy()
      stderr.destroy()
    }, 5)

    const result = await waitForShellEnvCapture(
      { exited: Promise.resolve(0), stdout, stderr, unref: vi.fn() },
      5_000,
      vi.fn(),
    )

    expect(result).toEqual([0, "API_HOST=example.test\0", ""])
  })
})
