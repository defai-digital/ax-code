import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
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
