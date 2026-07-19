import { describe, expect, test, vi } from "vitest"
import path from "path"
import fs from "fs/promises"
import { FileLock } from "../../src/util/filelock"
import { currentLockHost } from "../../src/util/process-lock"
import { tmpdir } from "../fixture/fixture"

describe("util.filelock", () => {
  test("releases a lock owned by the current process", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")
    const lockpath = filepath + ".lock"

    const lock = await FileLock.acquire(filepath)
    lock[Symbol.dispose]()

    expect(await fs.access(lockpath).then(() => true, () => false)).toBe(false)
  })

  test("does not delete a lock after ownership changes", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")
    const lockpath = filepath + ".lock"
    const lock = await FileLock.acquire(filepath)
    const otherOwner = {
      pid: process.pid + 1,
      startedAt: Date.now(),
      host: currentLockHost(),
    }

    await fs.writeFile(lockpath, JSON.stringify(otherOwner))
    lock[Symbol.dispose]()

    expect(JSON.parse(await fs.readFile(lockpath, "utf-8"))).toEqual(otherOwner)
  })

  test("does not steal a lock when its body cannot be read", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")
    const lockpath = filepath + ".lock"
    const otherOwner = {
      pid: process.pid + 1,
      startedAt: Date.now(),
      host: currentLockHost(),
    }
    await fs.writeFile(lockpath, JSON.stringify(otherOwner))

    const readError = Object.assign(new Error("lock body is unreadable"), { code: "EACCES" })
    const readSpy = vi.spyOn(fs, "readFile").mockRejectedValueOnce(readError)

    try {
      await expect(FileLock.acquire(filepath, { timeoutMs: 5 })).rejects.toThrow("lock body is unreadable")
      expect(JSON.parse(await fs.readFile(lockpath, "utf-8"))).toEqual(otherOwner)
    } finally {
      readSpy.mockRestore()
    }
  })

  test("steals a lock older than the configured stale age", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")
    const lockpath = filepath + ".lock"
    await fs.writeFile(
      lockpath,
      JSON.stringify({
        pid: process.pid + 1,
        startedAt: Date.now() - 120_000,
        host: currentLockHost(),
      }),
    )

    // Live-looking PID but age exceeds staleMs → must steal.
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as any)
    try {
      const lock = await FileLock.acquire(filepath, { timeoutMs: 200, staleMs: 30_000 })
      lock[Symbol.dispose]()
      expect(await fs.access(lockpath).then(() => true, () => false)).toBe(false)
    } finally {
      killSpy.mockRestore()
    }
  })

  test("unreferences polling timers while waiting for an active holder", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")
    const lockpath = filepath + ".lock"
    const originalSetTimeout = globalThis.setTimeout
    let unrefCalls = 0
    let nowCalls = 0

    await fs.writeFile(
      lockpath,
      JSON.stringify({
        pid: process.pid + 1,
        startedAt: 1_000,
        host: currentLockHost(),
      }),
    )

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as any)
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      nowCalls += 1
      return nowCalls >= 5 ? 2_010 : 2_000
    })

    globalThis.setTimeout = ((fn: (...args: any[]) => void, _ms?: number, ...args: any[]) => {
      originalSetTimeout(() => fn(...args), 0)
      return {
        unref() {
          unrefCalls += 1
          return this
        },
      } as any
    }) as typeof setTimeout

    try {
      await expect(FileLock.acquire(filepath, { timeoutMs: 5, staleMs: 60_000 })).rejects.toThrow(
        "timed out waiting for file lock",
      )
      expect(unrefCalls).toBeGreaterThan(0)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      killSpy.mockRestore()
      nowSpy.mockRestore()
    }
  })
})
