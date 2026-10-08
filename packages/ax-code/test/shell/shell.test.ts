import { afterEach, describe, expect, test, vi } from "vitest"
import { spawn } from "node:child_process"
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

  test.skipIf(process.platform === "win32")(
    "still escalates descendants when signaling the direct child throws",
    async () => {
      const child = spawn("sh", ["-c", "trap '' TERM; sleep 289 & echo $!; wait"], {
        stdio: ["ignore", "pipe", "ignore"],
      })
      const grandchild = await new Promise<number>((resolve, reject) => {
        child.once("error", reject)
        child.stdout.once("data", (data) => resolve(Number(String(data).trim())))
      })
      const alive = () => {
        try {
          process.kill(grandchild, 0)
          return true
        } catch {
          return false
        }
      }
      try {
        expect(alive()).toBe(true)
        await Shell.killTree({
          pid: child.pid,
          kill: () => {
            throw new Error("Direct child signal failed")
          },
        })
        await vi.waitFor(() => expect(alive()).toBe(false), { timeout: 2000 })
      } finally {
        if (alive()) process.kill(grandchild, "SIGKILL")
        child.kill("SIGKILL")
      }
    },
  )

  test.skipIf(process.platform === "win32")(
    "reaps descendants of a child that is not a process group leader",
    async () => {
      const child = spawn("sh", ["-c", "sleep 289 & echo $!; wait"], { stdio: ["ignore", "pipe", "ignore"] })
      const grandchild = await new Promise<number>((resolve, reject) => {
        child.once("error", reject)
        child.stdout.once("data", (data) => resolve(Number(String(data).trim())))
      })
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0)
          return true
        } catch {
          return false
        }
      }
      try {
        expect(alive(grandchild)).toBe(true)
        await Shell.killTree({
          pid: child.pid,
          kill: (signal) => child.kill(signal),
        })
        await vi.waitFor(() => expect(alive(grandchild)).toBe(false), { timeout: 2000 })
      } finally {
        if (alive(grandchild)) process.kill(grandchild, "SIGKILL")
        child.kill("SIGKILL")
      }
    },
  )
})
