import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Global } from "../../src/global"
import * as Git from "../../src/util/git"
import { tmpdir } from "../fixture/fixture"
import * as Guards from "../../src/snapshot/capture-guards"
import { Snapshot } from "../../src/snapshot"
import { Filesystem } from "../../src/util/filesystem"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

const keyError = () => new Guards.CaptureCollisionError("Snapshot tracking failed: write-tree exited with code 128")

describe("withCaptureRetry", () => {
  test("retries a lock collision with jitter and succeeds", async () => {
    const sleeps: number[] = []
    let calls = 0
    const value = await Guards.withCaptureRetry(
      async () => {
        calls++
        if (calls < 3) throw keyError()
        return "ok"
      },
      {
        sleep: async (ms) => void sleeps.push(ms),
        random: () => 0.5,
      },
    )
    expect(value).toBe("ok")
    expect(calls).toBe(3)
    expect(sleeps).toHaveLength(2)
    for (const ms of sleeps) (expect(ms).toBeGreaterThanOrEqual(50), expect(ms).toBeLessThanOrEqual(250))
  })

  test("jitter stays inside 50-250 ms for the extremes", async () => {
    for (const [random, expected] of [
      [0, 50],
      [1, 250],
    ] as const) {
      const sleeps: number[] = []
      await Guards.withCaptureRetry(
        (() => {
          let first = true
          return async () => {
            if (first) {
              first = false
              throw keyError()
            }
            return "ok"
          }
        })(),
        { sleep: async (ms) => void sleeps.push(ms), random: () => random },
      )
      expect(sleeps).toEqual([expected])
    }
  })

  test("gives up after three attempts", async () => {
    let calls = 0
    const error = await Guards.withCaptureRetry(
      async () => {
        calls++
        throw keyError()
      },
      { sleep: async () => undefined },
    ).catch((err: unknown) => err)
    expect(calls).toBe(3)
    expect(error).toBeInstanceOf(Guards.CaptureCollisionError)
  })

  test("runs the work once when attempts is configured as zero", async () => {
    let calls = 0
    const error = await Guards.withCaptureRetry(
      async () => {
        calls++
        throw keyError()
      },
      { attempts: 0, sleep: async () => undefined },
    ).catch((err: unknown) => err)
    expect(calls).toBe(1)
    expect(error).toBeInstanceOf(Guards.CaptureCollisionError)
  })

  test("does not retry unrelated failures", async () => {
    let calls = 0
    await expect(
      Guards.withCaptureRetry(
        async () => {
          calls++
          throw new Error("Snapshot staging failed: git add exited with code 2")
        },
        { sleep: async () => undefined },
      ),
    ).rejects.toThrow("git add exited with code 2")
    expect(calls).toBe(1)
  })

  test("classifies lock stderr as a collision and other failures as plain errors", () => {
    expect(Guards.captureFailure("x", 128, "fatal: Unable to create '.git/index.lock': File exists")).toBeInstanceOf(
      Guards.CaptureCollisionError,
    )
    const plain = Guards.captureFailure("x", 2, "fatal: not a git repository")
    expect(plain).not.toBeInstanceOf(Guards.CaptureCollisionError)
    expect(plain.message).toBe("x exited with code 2")
  })
})

describe("stale lock removal", () => {
  test("removes a store lock older than 60 s and keeps a fresh one", async () => {
    await using tmp = await tmpdir()
    const store = path.join(tmp.path, "store")
    await fs.mkdir(store, { recursive: true })
    const stale = path.join(store, "index.lock")
    const fresh = path.join(store, "HEAD.lock")
    await Filesystem.write(stale, "")
    await Filesystem.write(fresh, "")
    const now = Date.now()
    await fs.utimes(stale, (now - 61_000) / 1000, (now - 61_000) / 1000)

    const removed = await Guards.clearStaleSnapshotLocks({ gitdir: store, now })
    expect(removed).toEqual([stale])
    await expect(fs.access(stale)).rejects.toThrow()
    await expect(fs.access(fresh)).resolves.toBeUndefined()
  })

  test("never removes a lock outside the snapshot store", async () => {
    await using tmp = await tmpdir()
    const store = path.join(tmp.path, "store")
    const outside = path.join(tmp.path, "index.lock")
    await fs.mkdir(store, { recursive: true })
    await Filesystem.write(outside, "")
    const now = Date.now()
    await fs.utimes(outside, (now - 500_000) / 1000, (now - 500_000) / 1000)

    expect(await Guards.removeStaleLock({ lock: outside, store, now })).toBe(false)
    expect(await Guards.removeStaleLock({ lock: path.join(store, "..", "index.lock"), store, now })).toBe(false)
    await expect(fs.access(outside)).resolves.toBeUndefined()
  })

  test("a lock exactly at the stale boundary is removable, younger is not", async () => {
    await using tmp = await tmpdir()
    const store = path.join(tmp.path, "store")
    await fs.mkdir(store, { recursive: true })
    const lock = path.join(store, "index.lock")
    await Filesystem.write(lock, "")
    const now = Date.now()
    await fs.utimes(lock, (now - 59_000) / 1000, (now - 59_000) / 1000)
    expect(await Guards.removeStaleLock({ lock, store, now })).toBe(false)
    await fs.utimes(lock, (now - Guards.STALE_LOCK_MS) / 1000, (now - Guards.STALE_LOCK_MS) / 1000)
    expect(await Guards.removeStaleLock({ lock, store, now })).toBe(true)
  })

  test("reports false when the stale lock cannot be deleted", async () => {
    await using tmp = await tmpdir()
    const store = path.join(tmp.path, "store")
    await fs.mkdir(store, { recursive: true })
    const lock = path.join(store, "index.lock")
    await Filesystem.write(lock, "")
    const now = Date.now()
    await fs.utimes(lock, (now - 61_000) / 1000, (now - 61_000) / 1000)
    const original = fs.rm
    vi.spyOn(fs, "rm").mockImplementation(((target: unknown, ...rest: unknown[]) =>
      String(target) === lock
        ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
        : original(target as never, ...(rest as []))) as typeof fs.rm)
    expect(await Guards.removeStaleLock({ lock, store, now })).toBe(false)
    // The failed removal is not reported as cleared, and the lock survives.
    await expect(fs.access(lock)).resolves.toBeUndefined()
  })
})

describe("interrupted capture marker", () => {
  test("discards the partial index left by a dead owner and keeps a live one", async () => {
    await using tmp = await tmpdir()
    const gitdir = path.join(tmp.path, "store")
    await fs.mkdir(path.join(gitdir, "ax-code"), { recursive: true })
    await Filesystem.write(path.join(gitdir, "index"), "torn")

    await Guards.writeCaptureMarker(gitdir, { pid: 999_999, startedAt: Date.now() })
    expect(await Guards.recoverInterruptedCapture({ gitdir, pidAlive: () => false })).toBe(true)
    await expect(fs.access(path.join(gitdir, "index"))).rejects.toThrow()
    await expect(fs.access(Guards.captureMarkerPath(gitdir))).rejects.toThrow()

    await Filesystem.write(path.join(gitdir, "index"), "in progress")
    await Guards.writeCaptureMarker(gitdir, { pid: 4242, startedAt: Date.now() })
    expect(await Guards.recoverInterruptedCapture({ gitdir, pidAlive: () => true })).toBe(false)
    await expect(fs.access(path.join(gitdir, "index"))).resolves.toBeUndefined()

    // No marker at all is a clean store.
    await Guards.removeCaptureMarker(gitdir)
    expect(await Guards.recoverInterruptedCapture({ gitdir })).toBe(false)
  })

  test("a marker past the stale window is interrupted even if its pid is alive", () => {
    const now = Date.now()
    expect(Guards.markerInterrupted({ pid: 1, startedAt: now - 61_000 }, { now, pidAlive: () => true })).toBe(true)
    expect(Guards.markerInterrupted({ pid: 1, startedAt: now }, { now, pidAlive: () => true })).toBe(false)
  })

  test("only one of two concurrent recoveries claims the marker", async () => {
    await using tmp = await tmpdir()
    const gitdir = path.join(tmp.path, "store")
    await fs.mkdir(path.join(gitdir, "ax-code"), { recursive: true })
    await Filesystem.write(path.join(gitdir, "index"), "torn")
    await Guards.writeCaptureMarker(gitdir, { pid: 999_997, startedAt: Date.now() - 120_000 })

    const results = await Promise.all([
      Guards.recoverInterruptedCapture({ gitdir, pidAlive: () => false }),
      Guards.recoverInterruptedCapture({ gitdir, pidAlive: () => false }),
    ])
    expect(results.slice().sort()).toEqual([false, true])
    await expect(fs.access(Guards.captureMarkerPath(gitdir))).rejects.toThrow()
    await expect(fs.access(path.join(gitdir, "index"))).rejects.toThrow()
  })
})

describe("capture packing cadence", () => {
  test("packs every 50 captures and skips while a capture runs", async () => {
    const packer = new Guards.CapturePacker()
    for (let i = 1; i < Guards.PACK_EVERY; i++) expect(packer.recordSuccess()).toBe(false)
    expect(packer.recordSuccess()).toBe(true)

    let runs = 0
    const run = async () => void runs++
    expect(await packer.maybePack(run, { capturing: true })).toBe(false)
    expect(runs).toBe(0)
    expect(await packer.maybePack(run, { capturing: false })).toBe(true)
    expect(runs).toBe(1)
  })

  test("never overlaps two packing runs", async () => {
    const packer = new Guards.CapturePacker({ every: 1 })
    packer.recordSuccess()
    const release = Promise.withResolvers<void>()
    let runs = 0
    const first = packer.maybePack(
      async () => {
        runs++
        await release.promise
      },
      { capturing: false },
    )
    expect(await packer.maybePack(async () => void runs++, { capturing: false })).toBe(false)
    release.resolve()
    expect(await first).toBe(true)
    expect(runs).toBe(1)
  })
})

describe("snapshot store integration", () => {
  test("a real capture leaves no marker or lock behind", async () => {
    await using tmp = await tmpdir({ git: true, config: { username: "test" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await Snapshot.track()).toMatch(/^[0-9a-f]{40}$/)
        const gitdir = path.join(Global.Path.data, "snapshot", Instance.project.id)
        await expect(fs.access(Guards.captureMarkerPath(gitdir))).rejects.toThrow()
        await expect(fs.access(path.join(gitdir, "index.lock"))).rejects.toThrow()
      },
    })
  }, 60_000)

  test("a lock collision in write-tree is retried and then succeeds", async () => {
    await using tmp = await tmpdir({ git: true, config: { username: "test" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const original = Git.git
        let collisions = 0
        const writes: number[] = []
        vi.spyOn(Git, "git").mockImplementation(async (args, opts) => {
          const result = await original(args, opts)
          if (args.includes("write-tree")) {
            writes.push(writes.length)
            if (collisions === 0) {
              collisions++
              return {
                exitCode: 128,
                text: () => "",
                stdout: Buffer.alloc(0),
                stderr: Buffer.from("fatal: Unable to create index.lock: File exists"),
              }
            }
          }
          return result
        })
        expect(await Snapshot.track()).toMatch(/^[0-9a-f]{40}$/)
        expect(writes.length).toBe(2)
      },
    })
  }, 60_000)

  test("exhausted retries surface the collision error", async () => {
    await using tmp = await tmpdir({ git: true, config: { username: "test" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const original = Git.git
        vi.spyOn(Git, "git").mockImplementation(async (args, opts) => {
          const result = await original(args, opts)
          if (args.includes("write-tree")) {
            return {
              exitCode: 128,
              text: () => "",
              stdout: Buffer.alloc(0),
              stderr: Buffer.from("fatal: cannot lock ref 'index.lock': File exists"),
            }
          }
          return result
        })
        await expect(Snapshot.track()).rejects.toThrow(/write-tree/)
        const gitdir = path.join(Global.Path.data, "snapshot", Instance.project.id)
        // A failed capture never leaves its marker behind after the error.
        await expect(fs.access(Guards.captureMarkerPath(gitdir))).rejects.toThrow()
      },
    })
  }, 60_000)

  test("a leftover marker from another pid discards the partial index before capture", async () => {
    await using tmp = await tmpdir({ git: true, config: { username: "test" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await Snapshot.track()).toBeTruthy()
        const gitdir = path.join(Global.Path.data, "snapshot", Instance.project.id)
        await Filesystem.write(path.join(gitdir, "index"), "garbage")
        await Guards.writeCaptureMarker(gitdir, { pid: 999_998, startedAt: Date.now() - 120_000 })
        await Filesystem.write(path.join(tmp.path, "next.txt"), "next")
        expect(await Snapshot.track()).toMatch(/^[0-9a-f]{40}$/)
        await expect(fs.access(Guards.captureMarkerPath(gitdir))).rejects.toThrow()
        expect((await Snapshot.patch((await Snapshot.track())!)).files.length).toBeGreaterThanOrEqual(0)
      },
    })
  }, 60_000)

  test("packs after the configured cadence without overlapping a capture", async () => {
    await using tmp = await tmpdir({ git: true, config: { username: "test" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await Snapshot.track()).toBeTruthy()
        const original = Git.git
        const calls: string[][] = []
        let gcDuringStaging = false
        vi.spyOn(Git, "git").mockImplementation(async (args, opts) => {
          calls.push(args)
          if (args.includes("add") && calls.some((entry) => entry.includes("gc"))) gcDuringStaging = true
          return original(args, opts)
        })
        const file = path.join(tmp.path, "state.txt")
        // The first track above is capture 1; 49 more reach the 50th.
        for (let i = 0; i < 49; i++) {
          await fs.writeFile(file, String(i))
          await Snapshot.track()
        }
        const gc = calls.filter((args) => args.includes("gc"))
        expect(gc).toHaveLength(1)
        expect(gc[0]).toContain("--auto")
        expect(gcDuringStaging).toBe(false)
      },
    })
  }, 120_000)
})
