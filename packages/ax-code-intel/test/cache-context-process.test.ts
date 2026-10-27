import { describe, expect, test, vi } from "vitest"
import "./harness"

// Cross-process regression coverage for the cache-context key.
//
// The result cache store persists rows across processes (ax-code keeps them
// for 24 h), but the workspace generation counter restarts at 0 in every
// process. A restarted process that observes the same workspace events as a
// previous one therefore recomputes identical `references` keys and reads the
// old process's stale rows. Two processes are simulated here by resetting the
// module registry and re-importing the module: each evaluation gets fresh
// module state, exactly like a separate process boot.

async function freshProcess() {
  vi.resetModules()
  return await import("../src/cache-context")
}

describe("LSPCacheContext across processes", () => {
  test("two processes observing the same workspace events key differently", async () => {
    const first = await freshProcess()
    const second = await freshProcess()

    // Both processes observe the same single workspace change (e.g. both
    // opened a.ts), landing on the same generation number after boot.
    first.noteWorkspaceChange()
    second.noteWorkspaceChange()

    // Identical (operation, content, config, generation) across processes
    // must NOT produce the same key prefix: the second process would read
    // the first process's stale rows from the persistent store.
    expect(await second.contextFor("references")).not.toBe(await first.contextFor("references"))
  })

  test("a workspace change in one process does not leak into another", async () => {
    const first = await freshProcess()
    const second = await freshProcess()

    const before = await second.contextFor("references")
    first.noteWorkspaceChange()

    // Guards the simulation itself: the two loads are independent module
    // instances, like separate processes.
    expect(await second.contextFor("references")).toBe(before)
  })

  test("within one process the references context only changes on workspace changes", async () => {
    const mod = await freshProcess()

    const before = await mod.contextFor("references")
    expect(await mod.contextFor("references")).toBe(before)

    mod.noteWorkspaceChange()
    expect(await mod.contextFor("references")).not.toBe(before)
  })
})
