import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { ChildProcess } from "node:child_process"
import launch from "cross-spawn"
import { expect, test, vi } from "vitest"

vi.mock("cross-spawn", () => ({ default: vi.fn() }))

test("retains pipe data and natural EOF delivered after the parent exit event", async () => {
  vi.resetModules()
  const { Process } = await import("../../src/util/process")
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = Object.assign(new EventEmitter(), { stdout, stderr }) as unknown as ChildProcess
  vi.mocked(launch).mockReturnValueOnce(child)
  let ended = false
  stdout.once("end", () => {
    ended = true
  })
  const result = Process.run(["delayed-pipe-fixture"])
  child.emit("exit", 0, null)
  setTimeout(() => {
    stdout.end("final output")
    stderr.end("final diagnostic")
    child.emit("close", 0, null)
  }, 10)
  const output = await result
  expect(output.stdout.toString()).toBe("final output")
  expect(output.stderr.toString()).toBe("final diagnostic")
  expect(ended).toBe(true)
  expect(child).toHaveProperty("outputTruncated", false)
})

test("marks forced EOF as incomplete without discarding buffered pipe data", async () => {
  vi.resetModules()
  const { Process } = await import("../../src/util/process")
  vi.useFakeTimers()
  try {
    const stdout = new PassThrough()
    const fixture = Object.assign(new EventEmitter(), { stdout }) as unknown as ChildProcess
    vi.mocked(launch).mockReturnValueOnce(fixture)
    const child = Process.spawn(["inherited-pipe-fixture"], { stdout: "pipe" })
    stdout.write("retained output")
    const drained = Process.drain(stdout)
    child.emit("exit", 0, null)

    await vi.advanceTimersByTimeAsync(100)

    expect((await drained).toString()).toBe("retained output")
    expect(child.outputTruncated).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})

test("unrefs the timeout timer when the child is unref'd", async () => {
  vi.resetModules()
  const { Process } = await import("../../src/util/process")
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() }) as unknown as ChildProcess
  vi.mocked(launch).mockReturnValueOnce(child)
  const timer = { unref: vi.fn() }
  const setTimeoutSpy = vi
    .spyOn(globalThis, "setTimeout")
    .mockReturnValue(timer as unknown as ReturnType<typeof setTimeout>)
  try {
    Process.spawn(["unref-timeout-fixture"], { unref: true, timeout: 30000 })
    expect(timer.unref).toHaveBeenCalledTimes(1)
  } finally {
    setTimeoutSpy.mockRestore()
  }
})
