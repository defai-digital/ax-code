import { ChildProcess } from "node:child_process"
import { PassThrough } from "node:stream"
import { describe, expect, test, vi } from "vitest"
import { createProcess } from "../src/process"

const launch = vi.hoisted(() => vi.fn())
vi.mock("cross-spawn", () => ({ default: launch }))

describe("process output drain", () => {
  for (const terminal of ["end", "close", "error"] as const) {
    test(`releases output listeners after ${terminal}`, async () => {
      const child = new ChildProcess()
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      child.stdout = stdout
      child.stderr = stderr
      launch.mockReturnValueOnce(child)
      const process = createProcess(async () => undefined)
      const pending = process.run(["fixture"])
      stdout.write("complete output")
      stderr.end()
      if (terminal === "end") stdout.end()
      else if (terminal === "close") stdout.destroy()
      else stdout.destroy(new Error("pipe closed"))
      child.emit("exit", 0, null)
      child.emit("close", 0, null)
      const result = await pending
      expect(result.stdout.toString()).toBe("complete output")
      for (const stream of [stdout, stderr]) {
        for (const event of ["data", "end", "close", "error"]) expect(stream.listenerCount(event)).toBe(0)
      }
    })
  }
})

describe("process timeout", () => {
  test("terminates the whole tree at once instead of signalling only the direct child", async () => {
    vi.useFakeTimers()
    try {
      const child = new ChildProcess()
      const kill = vi.spyOn(child, "kill")
      Object.defineProperty(child, "pid", { value: 4242 })
      launch.mockReturnValueOnce(child)
      const killTree = vi.fn(async () => {
        child.emit("exit", null, "SIGTERM")
      })
      const proc = createProcess(killTree).spawn(["fixture"], { timeout: 100 })
      await vi.advanceTimersByTimeAsync(100)
      expect(killTree).toHaveBeenCalledTimes(1)
      expect(kill).not.toHaveBeenCalled()
      await expect(proc.exited).resolves.toBe(124)
    } finally {
      vi.useRealTimers()
    }
  })

  test("run forwards detached to spawn", async () => {
    const child = new ChildProcess()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    child.stdout = stdout
    child.stderr = stderr
    launch.mockReturnValueOnce(child)
    const pending = createProcess(async () => undefined).run(["fixture"], { detached: true })
    stdout.end()
    stderr.end()
    child.emit("exit", 0, null)
    await pending
    expect(launch.mock.calls.at(-1)?.[2]).toMatchObject({ detached: true })
  })
})
