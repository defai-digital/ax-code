import { afterEach, describe, expect, test, vi } from "vitest"
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { Shell, descendantsFromSnapshot } from "../../src/shell/shell"
import { tmpdir } from "../fixture/fixture"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("process snapshot descendants", () => {
  test("includes only descendants, with children before their parents", () => {
    expect(descendantsFromSnapshot(42, "42 1\n43 42\n44 43\n45 1\n46 45")).toEqual([44, 43])
  })

  test("ignores invalid records and never returns process-group signal targets", () => {
    expect(descendantsFromSnapshot(42, "0 42\n-1 42\n1.5 42\n9007199254740992 42\n43 42\n44 43 extra")).toEqual([43])
  })

  test("cycles and duplicate rows cannot include the root or duplicate signals", () => {
    expect(descendantsFromSnapshot(42, "42 44\n43 42\n44 43\n43 42")).toEqual([44, 43])
  })

  test("walks deep snapshots without overflowing the call stack", () => {
    const snapshot = Array.from({ length: 10_000 }, (_, i) => `${i + 43} ${i + 42}`).join("\n")
    const descendants = descendantsFromSnapshot(42, snapshot)
    expect(descendants).toHaveLength(10_000)
    expect(descendants[0]).toBe(10_042)
    expect(descendants.at(-1)).toBe(43)
  })

  test("rejects an oversized snapshot instead of returning partial descendants", () => {
    expect(descendantsFromSnapshot(42, "43 42\n".repeat(16_385))).toEqual([])
  })
})

describe("Shell", () => {
  test.skipIf(process.platform === "win32")("a hung ps cannot prevent direct-child cleanup", async () => {
    await using tmp = await tmpdir()
    const executable = path.join(tmp.path, "ps")
    await fs.writeFile(executable, "#!/bin/sh\ntrap '' TERM\nexec sleep 289\n", { mode: 0o755 })
    vi.stubEnv("PATH", `${tmp.path}${path.delimiter}${process.env.PATH}`)
    const kill = vi.fn()
    const started = performance.now()
    await Shell.killTree({ pid: 2_147_483_000, kill })
    expect(kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]])
    expect(performance.now() - started).toBeLessThan(10_000)
  })

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
