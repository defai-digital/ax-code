import { describe, expect, test } from "bun:test"
import { IndexLock } from "../../src/code-intelligence/lockfile"
import type { ProjectID } from "../../src/project/schema"
import { Log } from "../../src/util/log"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"

Log.init({ print: false })

// The lockfile is keyed by ProjectID. We fabricate project ids per
// test so they don't collide — the real branded type is just a
// string underneath, so a cast is enough for a unit test.
function mkProjectID(tag: string): ProjectID {
  return `lockfile-test-${tag}-${Math.random().toString(36).slice(2, 8)}` as unknown as ProjectID
}

async function lockPath(projectID: ProjectID): Promise<string> {
  return path.join(Global.Path.data, "locks", `code-index-${projectID}.lock`)
}

describe("IndexLock", () => {
  test("acquire creates a file and dispose removes it", async () => {
    const id = mkProjectID("basic")
    const target = await lockPath(id)
    await IndexLock.__reset(id)

    const handle = await IndexLock.tryAcquire(id)
    expect(handle).toBeDefined()

    // File exists while held.
    const existsBefore = await fs
      .access(target)
      .then(() => true)
      .catch(() => false)
    expect(existsBefore).toBe(true)

    handle![Symbol.dispose]()
    // Give the async unlink a tick to run.
    await new Promise((r) => setTimeout(r, 50))
    const existsAfter = await fs
      .access(target)
      .then(() => true)
      .catch(() => false)
    expect(existsAfter).toBe(false)
  })

  test("tryAcquire returns undefined when the lock is held by a live process", async () => {
    const id = mkProjectID("contend")
    await IndexLock.__reset(id)

    // Simulate a foreign holder by writing a lockfile with a PID that
    // is guaranteed alive (our own pid) but not ours — for the purpose
    // of the staleness check, the code refuses to steal our own pid.
    // So we use pid 1 (init) which is guaranteed alive on all unix
    // systems and is definitely not us.
    const target = await lockPath(id)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, JSON.stringify({ pid: 1, startedAt: Date.now(), host: process.env.HOSTNAME ?? "" }))

    const handle = await IndexLock.tryAcquire(id)
    expect(handle).toBeUndefined()

    // Cleanup.
    await IndexLock.__reset(id)
  })

  test("tryAcquire steals a lock whose holder pid is dead", async () => {
    const id = mkProjectID("stale-pid")
    await IndexLock.__reset(id)

    const target = await lockPath(id)
    await fs.mkdir(path.dirname(target), { recursive: true })
    // PID 0 is never a real process on linux/macos, so process.kill(0, 0)
    // will ESRCH. The host field matches ours so the steal path runs.
    await fs.writeFile(
      target,
      JSON.stringify({ pid: 99999999, startedAt: Date.now(), host: process.env.HOSTNAME ?? "" }),
    )

    const handle = await IndexLock.tryAcquire(id)
    expect(handle).toBeDefined()
    handle![Symbol.dispose]()
    await IndexLock.__reset(id)
  })

  test("tryAcquire steals a lock older than the staleness threshold", async () => {
    const id = mkProjectID("stale-age")
    await IndexLock.__reset(id)

    const target = await lockPath(id)
    await fs.mkdir(path.dirname(target), { recursive: true })
    // Write a lock with pid=1 (alive) but startedAt 24h ago — well past
    // the 8h staleness threshold.
    await fs.writeFile(
      target,
      JSON.stringify({
        pid: 1,
        startedAt: Date.now() - 24 * 60 * 60 * 1000,
        host: process.env.HOSTNAME ?? "",
      }),
    )

    const handle = await IndexLock.tryAcquire(id)
    expect(handle).toBeDefined()
    handle![Symbol.dispose]()
    await IndexLock.__reset(id)
  })

  test("acquire waits and eventually succeeds after the holder releases", async () => {
    const id = mkProjectID("wait")
    await IndexLock.__reset(id)

    const first = await IndexLock.tryAcquire(id)
    expect(first).toBeDefined()

    let waitObserved = false
    const acquirePromise = IndexLock.acquire(id, {
      timeoutMs: 5_000,
      onWait: () => {
        waitObserved = true
      },
    })

    // Give the acquire loop a chance to observe the held lock and
    // schedule a retry, then release the first holder.
    await new Promise((r) => setTimeout(r, 100))
    first![Symbol.dispose]()

    const second = await acquirePromise
    expect(second).toBeDefined()
    expect(waitObserved).toBe(true)
    second[Symbol.dispose]()
    await IndexLock.__reset(id)
  })

  test("acquire throws when the timeout expires before the lock is free", async () => {
    const id = mkProjectID("timeout")
    await IndexLock.__reset(id)

    // Hold the lock with a live foreign pid (pid 1).
    const target = await lockPath(id)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, JSON.stringify({ pid: 1, startedAt: Date.now(), host: process.env.HOSTNAME ?? "" }))

    await expect(IndexLock.acquire(id, { timeoutMs: 200 })).rejects.toThrow(/timed out/)

    await IndexLock.__reset(id)
  })
})
