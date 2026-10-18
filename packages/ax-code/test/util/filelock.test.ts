import { describe, expect, test, vi } from "vitest"
import path from "path"
import os from "node:os"
import fs from "fs/promises"
import { FileLock } from "../../src/util/filelock"
import { currentLockHost } from "../../src/util/process-lock"
import { tmpdir } from "../fixture/fixture"

describe("util.filelock", () => {
  test("a cancelled waiter leaves the held lock intact", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")
    using holder = await FileLock.acquire(filepath)
    expect(holder).toBeDefined()
    const body = await fs.readFile(filepath + ".lock", "utf8")
    const controller = new AbortController()
    const reason = new Error("Stop waiting")
    const waiting = FileLock.acquire(filepath, { timeoutMs: 250, signal: controller.signal })
    controller.abort(reason)
    await expect(waiting).rejects.toBe(reason)
    expect(await fs.readFile(filepath + ".lock", "utf8")).toBe(body)
  })

  test("a pre-cancelled acquisition never creates a lock", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")
    const reason = new Error("Already cancelled")
    const acquisition = FileLock.acquire(filepath, { signal: AbortSignal.abort(reason) })
    // Clean up the pre-fix unexpected success so the regression is isolated.
    const result = await acquisition.then(
      (lock) => {
        lock[Symbol.dispose]()
        return undefined
      },
      (error: unknown) => error,
    )
    expect(result).toBe(reason)
    await expect(fs.access(filepath + ".lock")).rejects.toThrow()
  })

  test("releases a lock owned by the current process", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")
    const lockpath = filepath + ".lock"

    const lock = await FileLock.acquire(filepath)
    lock[Symbol.dispose]()

    expect(
      await fs.access(lockpath).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  })

  test("releases the lock after the host name changes mid-hold", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")
    const lockpath = filepath + ".lock"
    const lock = await FileLock.acquire(filepath)

    // The released body is unchanged, so the lock is still ours; comparing the
    // recorded host against the *current* host name would skip the unlink and
    // leave the path blocked for the whole stale window (8h for the index
    // lock), with `disposed` already set so it can never be retried.
    const hostSpy = vi.spyOn(os, "hostname").mockReturnValue("renamed-host")
    try {
      lock[Symbol.dispose]()
    } finally {
      hostSpy.mockRestore()
    }

    expect(
      await fs.access(lockpath).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
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

  test("does not steal a freshly created empty lockfile", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")
    const lockpath = filepath + ".lock"
    await fs.writeFile(lockpath, "")

    await expect(FileLock.acquire(filepath, { timeoutMs: 120, staleMs: 60_000 })).rejects.toThrow(
      "timed out waiting for file lock",
    )
    expect(await fs.readFile(lockpath, "utf-8")).toBe("")
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
      expect(
        await fs.access(lockpath).then(
          () => true,
          () => false,
        ),
      ).toBe(false)
    } finally {
      killSpy.mockRestore()
    }
  })

  // Polling timers must stay ref'd. They were briefly unref'd (see the
  // sleep() note in packages/util/src/timeout.ts): if the poll timer is the only
  // pending work, Node drains the event loop and exits while the caller is
  // still awaiting acquire(), so the awaiting promise never settles. In a CLI
  // process that is a silent exit 13 with no output. The bounded timeoutMs
  // below is what guarantees termination, not the unref.
  test("keeps polling timers referenced while waiting for an active holder", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")
    const lockpath = filepath + ".lock"
    const originalSetTimeout = globalThis.setTimeout
    let unrefCalls = 0
    let pollTimers = 0
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
      pollTimers += 1
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
      // The loop did poll...
      expect(pollTimers).toBeGreaterThan(0)
      // ...and never unref'd, so an awaited acquire cannot be silently dropped.
      expect(unrefCalls).toBe(0)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      killSpy.mockRestore()
      nowSpy.mockRestore()
    }
  })

  test("does not leave an empty lockfile behind when the owner body cannot be written", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")

    const openSpy = vi.spyOn(fs, "open").mockImplementationOnce(async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      handle.writeFile = async () => {
        throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" })
      }
      return handle
    })
    try {
      await expect(FileLock.acquire(filepath, { timeoutMs: 200 })).rejects.toThrow("no space left on device")
    } finally {
      openSpy.mockRestore()
    }

    // The exclusive create already reserved the path. Nothing ever wrote an
    // owner body, and an empty lockfile may not be stolen for
    // EMPTY_LOCK_GRACE_MS, so the failed create must not block the next
    // acquirer for a minute.
    const lock = await FileLock.tryAcquire(filepath)
    expect(lock).toBeDefined()
    lock?.[Symbol.dispose]()
  })

  test("a vanished lockfile is retried, not unlinked", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")
    const lockpath = filepath + ".lock"
    // An empty file another process just created: EEXIST on create, no body,
    // and the stat probe reports ENOENT (the holder unlinked and recreated
    // between our two syscalls). The steal path must report the lock free
    // WITHOUT deleting the fresh file.
    await fs.writeFile(lockpath, "")
    const statSpy = vi
      .spyOn(fs, "stat")
      .mockRejectedValueOnce(Object.assign(new Error("no such file"), { code: "ENOENT" }))
    try {
      await expect(FileLock.acquire(filepath, { timeoutMs: 120 })).rejects.toThrow("timed out waiting for file lock")
    } finally {
      statSpy.mockRestore()
    }
    expect(await fs.readFile(lockpath, "utf8")).toBe("")
  })

  test("a descriptor close failure after the body write does not orphan the lock", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")
    const lockpath = filepath + ".lock"

    const openSpy = vi.spyOn(fs, "open").mockImplementationOnce(async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      const originalClose = handle.close.bind(handle)
      handle.close = async () => {
        await originalClose()
        throw Object.assign(new Error("bad file descriptor"), { code: "EBADF" })
      }
      return handle
    })
    let lock: Disposable | undefined
    try {
      // The body naming this process is already on disk: the acquisition
      // must succeed so the caller holds the release path.
      lock = await FileLock.acquire(filepath, { timeoutMs: 200 })
      expect(JSON.parse(await fs.readFile(lockpath, "utf-8")).pid).toBe(process.pid)
    } finally {
      openSpy.mockRestore()
      lock?.[Symbol.dispose]()
    }
    expect(
      await fs.access(lockpath).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  })

  // Root bypasses directory permissions, so the EPERM probe needs a real
  // unprivileged user to be meaningful.
  test.skipIf(process.platform === "win32" || (process.getuid?.() ?? 0) === 0)(
    "a transient release failure stays retryable",
    async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "state.json")
      const lockpath = filepath + ".lock"
      const lock = await FileLock.acquire(filepath)

      // A read-only parent makes the release unlink fail with EPERM without
      // changing the lockfile itself.
      await fs.chmod(tmp.path, 0o555)
      try {
        lock[Symbol.dispose]()
      } finally {
        await fs.chmod(tmp.path, 0o755)
      }
      // Not released and not latched: the file is still ours to release.
      expect(await fs.readFile(lockpath, "utf-8")).toContain(String(process.pid))
      lock[Symbol.dispose]()
      expect(
        await fs.access(lockpath).then(
          () => true,
          () => false,
        ),
      ).toBe(false)
    },
  )
})
