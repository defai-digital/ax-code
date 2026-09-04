import { afterEach, describe, expect, test, vi } from "vitest"
import { Shell } from "../../src/shell/shell"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("Shell", () => {
  test("rejects unsupported Windows shell executables regardless of extension casing", () => {
    expect(Shell.isAcceptable("C:\\Program Files\\fish\\fish.exe", "win32")).toBe(false)
    expect(Shell.isAcceptable("C:\\Program Files\\fish\\FISH.EXE", "win32")).toBe(false)
    expect(Shell.isAcceptable("C:\\Program Files\\nushell\\nu.CMD", "win32")).toBe(false)
    expect(Shell.isAcceptable("C:\\Windows\\System32\\cmd.exe", "win32")).toBe(true)
    expect(Shell.isAcceptable("C:\\Program Files\\Git\\bin\\bash.EXE", "win32")).toBe(true)
  })

  test("rejects unsupported POSIX shell basenames", () => {
    expect(Shell.isAcceptable("/usr/bin/fish", "linux")).toBe(false)
    expect(Shell.isAcceptable("/usr/local/bin/nu", "darwin")).toBe(false)
    expect(Shell.isAcceptable("/bin/bash", "linux")).toBe(true)
  })

  test.skipIf(process.platform === "win32")(
    "escalates a live process group after its leader reports that it exited",
    async () => {
      vi.useFakeTimers()
      const signals: Array<[number, NodeJS.Signals | number | undefined]> = []
      vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
        signals.push([pid, signal as NodeJS.Signals | number | undefined])
        return true
      })
      const pending = Shell.killTree(
        { pid: 42_424, kill: vi.fn() },
        {
          exited: () => true,
        },
      )

      await vi.advanceTimersByTimeAsync(200)
      await pending

      expect(signals).toEqual([
        [-42_424, "SIGTERM"],
        [-42_424, 0],
        [-42_424, "SIGKILL"],
      ])
    },
  )
})
