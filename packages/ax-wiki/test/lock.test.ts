import { spawn } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { buildAxWiki } from "../src/build.js"
import { createWikiBuildLock } from "../src/lock.js"
import type { WikiBuildLock, WikiPageGenerator } from "../src/types.js"

const roots: string[] = []

async function tmp(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-wiki-lock-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(root: string): Promise<void> {
  await mkdir(path.join(root, "packages/core/src"), { recursive: true })
  await writeFile(path.join(root, "README.md"), "# Fixture\n\nA repository used to test the AX Wiki lock.\n")
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }))
  await writeFile(path.join(root, "packages/core/src/index.ts"), "export function coreValue() { return 1 }\n")
}

function generator(): WikiPageGenerator {
  return async (request) => ({
    summary: `Source-backed guide for ${request.page.title} and its repository responsibilities.`,
    body: `## Purpose\n\nThis page explains ${request.page.purpose} The claims are grounded in the selected repository files and should be verified against code before structural changes.`,
    symbols: [],
  })
}

describe("createWikiBuildLock (gate C7)", () => {
  test("acquires and releases the lockfile", async () => {
    const root = await tmp()
    const lock = createWikiBuildLock(root, "ax-wiki")
    const handle = await lock.acquire()
    await expect(readFile(path.join(root, "ax-wiki/.build-lock"), "utf8")).resolves.toContain('"pid"')
    await handle.release()
    await expect(readFile(path.join(root, "ax-wiki/.build-lock"), "utf8")).rejects.toThrow()
  })

  test("a second acquire waits until release, then succeeds", async () => {
    const root = await tmp()
    const lock = createWikiBuildLock(root, "ax-wiki", { retryIntervalMs: 5, acquireTimeoutMs: 3000 })
    const first = await lock.acquire()
    let secondAcquired = false
    const second = lock.acquire().then((handle) => {
      secondAcquired = true
      return handle
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(secondAcquired).toBe(false)
    await first.release()
    const handle = await second
    expect(secondAcquired).toBe(true)
    await handle.release()
  })

  test("steals a stale lock instead of wedging", async () => {
    const root = await tmp()
    let clock = 1000
    const lock = createWikiBuildLock(root, "ax-wiki", { now: () => clock, staleMs: 100 })
    const first = await lock.acquire()
    expect(first).toBeDefined()
    clock += 1000 // advance past staleMs without releasing
    const second = await lock.acquire()
    await second.release()
  })

  test("the heartbeat stops touching the lockfile once its token is gone", async () => {
    const root = await tmp()
    const lockPath = path.join(root, "ax-wiki/.build-lock")
    const lock = createWikiBuildLock(root, "ax-wiki", { heartbeatMs: 25 })
    const handle = await lock.acquire()
    // Simulate a verified steal: a successor's body now occupies the path.
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, startedAt: Date.now(), host: "successor-host", token: "successor-token" }),
    )
    const before = (await stat(lockPath)).mtimeMs
    await new Promise((resolve) => setTimeout(resolve, 200))
    const after = (await stat(lockPath)).mtimeMs
    // A ghost heartbeat would keep refreshing the successor's mtime and make a
    // wedged successor's lock immortal; the token check must stop it instead.
    expect(after - before).toBeLessThan(100)
    await handle.release()
    // release() must not delete the successor's lock either.
    await expect(readFile(lockPath, "utf8")).resolves.toContain("successor-token")
  })

  test("times out with a clear error while a fresh lock is held", async () => {
    const root = await tmp()
    const lock = createWikiBuildLock(root, "ax-wiki", { retryIntervalMs: 5, acquireTimeoutMs: 40 })
    const first = await lock.acquire()
    await expect(lock.acquire()).rejects.toThrow("build lock is held")
    await first.release()
  })
})

describe("buildAxWiki lock integration (gate C7)", () => {
  test("acquires the lock for the write phase and releases it", async () => {
    const root = await tmp()
    await fixture(root)
    const events: string[] = []
    const spyLock: WikiBuildLock = {
      async acquire() {
        events.push("acquire")
        return {
          async release() {
            events.push("release")
          },
        }
      },
    }
    await buildAxWiki({ root, action: "generate", generator: generator(), lock: spyLock })
    expect(events).toEqual(["acquire", "release"])
  })

  test("does not acquire the write-phase lock when validation fails first", async () => {
    const root = await tmp()
    await fixture(root)
    const events: string[] = []
    const spyLock: WikiBuildLock = {
      async acquire() {
        events.push("acquire")
        return {
          async release() {
            events.push("release")
          },
        }
      },
    }
    const broken: WikiPageGenerator = async (request) => ({
      summary: `A sufficiently detailed summary for ${request.page.title}.`,
      body: "## Invalid link\n\nThis intentionally long page passes the minimum content check but links to a page that does not exist in the plan. [Missing](missing.md)",
      symbols: [],
    })
    await expect(buildAxWiki({ root, action: "generate", generator: broken, lock: spyLock })).rejects.toThrow(
      "wiki.link_broken",
    )
    // Validation precedes the write phase, so the lock is never taken and the
    // filesystem is left untouched.
    expect(events).toEqual([])
  })
})

describe("createWikiBuildLock hardening", () => {
  test("release does not delete a lock that was stolen and re-acquired", async () => {
    const root = await tmp()
    let clock = 1_000
    const lock = createWikiBuildLock(root, "ax-wiki", { now: () => clock, staleMs: 100 })
    const first = await lock.acquire()
    clock += 1_000 // go stale without releasing
    const second = await lock.acquire()
    await first.release()
    // The stale holder's release must not remove the new holder's lock.
    await expect(readFile(path.join(root, "ax-wiki/.build-lock"), "utf8")).resolves.toContain('"pid"')
    await second.release()
    await expect(readFile(path.join(root, "ax-wiki/.build-lock"), "utf8")).rejects.toThrow()
  })

  test("release is idempotent", async () => {
    const root = await tmp()
    const lock = createWikiBuildLock(root, "ax-wiki")
    const handle = await lock.acquire()
    await handle.release()
    await expect(handle.release()).resolves.toBeUndefined()
  })

  test("the heartbeat survives a brief lockfile absence", async () => {
    const root = await tmp()
    const lockPath = path.join(root, "ax-wiki/.build-lock")
    const lock = createWikiBuildLock(root, "ax-wiki", { heartbeatMs: 25 })
    const handle = await lock.acquire()
    const body = await readFile(lockPath, "utf8")
    // A steal or a successor's rename-based release displaces the path for a
    // moment before restoring it; the heartbeat must not die on the first
    // ENOENT, or the live holder's lock would go stale and be re-stolen.
    await rm(lockPath)
    await new Promise((resolve) => setTimeout(resolve, 40)) // ~1-2 ticks of absence
    await writeFile(lockPath, body)
    const before = (await stat(lockPath)).mtimeMs
    await new Promise((resolve) => setTimeout(resolve, 150))
    const after = (await stat(lockPath)).mtimeMs
    expect(after).toBeGreaterThan(before)
    await handle.release()
  })

  test("a lock owned by a dead same-host process is stale immediately", async () => {
    const root = await tmp()
    const child = spawn(process.execPath, ["-e", "process.exit(0)"])
    await new Promise<void>((resolve) => child.once("exit", () => resolve()))
    const file = path.join(root, "ax-wiki/.build-lock")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ pid: child.pid, startedAt: Date.now(), host: os.hostname(), token: "dead" }))
    // Even with a huge staleMs budget, a dead owner makes the lock stealable.
    const lock = createWikiBuildLock(root, "ax-wiki", {
      retryIntervalMs: 5,
      acquireTimeoutMs: 3_000,
      staleMs: 3_600_000,
    })
    const handle = await lock.acquire()
    await handle.release()
  })

  test("a corrupt or future-dated lockfile is treated as stale", async () => {
    const root = await tmp()
    const file = path.join(root, "ax-wiki/.build-lock")
    await mkdir(path.dirname(file), { recursive: true })
    const lock = createWikiBuildLock(root, "ax-wiki", { retryIntervalMs: 5, acquireTimeoutMs: 3_000 })
    await writeFile(file, JSON.stringify({ pid: 1, startedAt: null, host: "other-host" }))
    const first = await lock.acquire()
    await first.release()
    await writeFile(file, JSON.stringify({ pid: 1, startedAt: Date.now() + 3_600_000, host: "other-host", token: "y" }))
    const second = await lock.acquire()
    await second.release()
  })

  test("a freshly created empty lockfile is a holder still writing it, not a corrupt lock", async () => {
    const root = await tmp()
    const file = path.join(root, "ax-wiki/.build-lock")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "")
    const lock = createWikiBuildLock(root, "ax-wiki", { retryIntervalMs: 5, acquireTimeoutMs: 150 })
    await expect(lock.acquire()).rejects.toThrow(/held by another process/)
    // The in-progress file must survive the failed attempt untouched.
    expect(await readFile(file, "utf8")).toBe("")
  })

  test("an old unparseable lockfile is still treated as corrupt and replaced", async () => {
    const root = await tmp()
    const file = path.join(root, "ax-wiki/.build-lock")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "{not json")
    const old = new Date(Date.now() - 60_000)
    await utimes(file, old, old)
    const lock = createWikiBuildLock(root, "ax-wiki", { retryIntervalMs: 5, acquireTimeoutMs: 3_000 })
    const handle = await lock.acquire()
    await handle.release()
  })

  test("release surfaces a read failure instead of leaving the lock behind silently", async () => {
    const root = await tmp()
    const file = path.join(root, "ax-wiki/.build-lock")
    const lock = createWikiBuildLock(root, "ax-wiki", { retryIntervalMs: 5, acquireTimeoutMs: 3_000 })
    const handle = await lock.acquire()
    // Replace the lockfile with a directory so reading it fails with EISDIR (not ENOENT).
    await rm(file, { force: true })
    await mkdir(file)
    await expect(handle.release()).rejects.toThrow(/lock release failed/)
    await rm(file, { recursive: true, force: true })
  })

  test("a live holder's heartbeat keeps the lock past the startedAt budget", async () => {
    const root = await tmp()
    const holder = createWikiBuildLock(root, "ax-wiki", { staleMs: 300, heartbeatMs: 50 })
    const first = await holder.acquire()
    // Wait well past staleMs: startedAt is ancient, but the heartbeat keeps
    // the mtime fresh, so a waiter must time out instead of stealing.
    await new Promise((resolve) => setTimeout(resolve, 600))
    const waiter = createWikiBuildLock(root, "ax-wiki", {
      staleMs: 300,
      retryIntervalMs: 10,
      acquireTimeoutMs: 400,
    })
    await expect(waiter.acquire()).rejects.toThrow(/held by another process/)
    await first.release()
    const second = await waiter.acquire()
    await second.release()
  })

  test("an old body with a fresh mtime is not stolen", async () => {
    const root = await tmp()
    const file = path.join(root, "ax-wiki/.build-lock")
    await mkdir(path.dirname(file), { recursive: true })
    // A live same-host holder with an ancient startedAt: the fresh heartbeat
    // mtime is the staleness truth, not startedAt.
    await writeFile(
      file,
      JSON.stringify({ pid: process.pid, startedAt: Date.now() - 60_000, host: os.hostname(), token: "live" }),
    )
    const stamp = new Date()
    await utimes(file, stamp, stamp)
    // The waiter's timeout is shorter than the staleness budget: if the fresh
    // mtime were ignored and startedAt ruled, the lock would be stolen at once.
    const waiter = createWikiBuildLock(root, "ax-wiki", {
      staleMs: 300,
      retryIntervalMs: 10,
      acquireTimeoutMs: 150,
    })
    await expect(waiter.acquire()).rejects.toThrow(/held by another process/)
  })

  test("a cross-host holder's heartbeat mtime also keeps the lock", async () => {
    const root = await tmp()
    const file = path.join(root, "ax-wiki/.build-lock")
    await mkdir(path.dirname(file), { recursive: true })
    // A holder on another host (shared filesystem): the pid check does not
    // apply, but the heartbeat mtime is still fresher than startedAt.
    await writeFile(
      file,
      JSON.stringify({ pid: 42, startedAt: Date.now() - 60_000, host: "other-host", token: "remote" }),
    )
    const stamp = new Date()
    await utimes(file, stamp, stamp)
    const waiter = createWikiBuildLock(root, "ax-wiki", {
      staleMs: 300,
      retryIntervalMs: 10,
      acquireTimeoutMs: 150,
    })
    await expect(waiter.acquire()).rejects.toThrow(/held by another process/)
  })
})
