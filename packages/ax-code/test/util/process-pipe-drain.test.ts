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
})
