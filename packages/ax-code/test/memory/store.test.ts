import { describe, expect, spyOn, test, beforeEach } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import * as store from "../../src/memory/store"

const sampleMemory = (override: Partial<{ contentHash: string; totalTokens: number }> = {}) => ({
  version: 1,
  created: "2026-04-27T00:00:00Z",
  updated: "2026-04-27T00:00:00Z",
  projectRoot: "",
  contentHash: override.contentHash ?? "abc",
  maxTokens: 2000,
  sections: {},
  totalTokens: override.totalTokens ?? 0,
})

describe("memory.store cache", () => {
  beforeEach(() => {
    store._resetReadCache()
  })

  test("load reflects save() updates (cache invalidated on save)", async () => {
    await using tmp = await tmpdir()

    await store.save(tmp.path, sampleMemory({ contentHash: "v1" }))
    const first = await store.load(tmp.path)
    expect(first?.contentHash).toBe("v1")

    await store.save(tmp.path, sampleMemory({ contentHash: "v2" }))
    const second = await store.load(tmp.path)
    expect(second?.contentHash).toBe("v2")
  })

  test("load reflects external file writes (mtime invalidates cache)", async () => {
    await using tmp = await tmpdir()
    const memoryPath = path.join(tmp.path, ".ax-code", "memory.json")

    await store.save(tmp.path, sampleMemory({ contentHash: "from-save" }))
    expect((await store.load(tmp.path))?.contentHash).toBe("from-save")

    // Simulate a write from another process (e.g. a sibling `ax-code memory
    // remember` invocation) — the cache must invalidate via the mtime check,
    // not via our own save() side-effect.
    await new Promise((r) => setTimeout(r, 10))
    await fs.writeFile(memoryPath, JSON.stringify(sampleMemory({ contentHash: "from-external" })))

    expect((await store.load(tmp.path))?.contentHash).toBe("from-external")
  })

  test("load updates cache metadata after read to prevent stale cache replay", async () => {
    await using tmp = await tmpdir()
    const memoryPath = path.join(tmp.path, ".ax-code", "memory.json")
    const initial = sampleMemory({ contentHash: "initial" })
    const raced = sampleMemory({ contentHash: "raced-version" })
    const restored = sampleMemory({ contentHash: "initial" })

    await store.save(tmp.path, initial)
    const statBefore = await fs.stat(memoryPath)
    const realReadFile = fs.readFile.bind(fs)
    const readFileSpy = spyOn(fs, "readFile")
    let firstRead = true

    readFileSpy.mockImplementation(async (...args) => {
      if (firstRead) {
        firstRead = false
        await fs.writeFile(memoryPath, JSON.stringify(raced))
        await fs.utimes(memoryPath, new Date(statBefore.atimeMs), new Date(statBefore.mtimeMs))
      }
      return realReadFile(...args)
    })

    try {
      const first = await store.load(tmp.path)
      expect(first?.contentHash).toBe("raced-version")

      await fs.writeFile(memoryPath, JSON.stringify(restored))
      await fs.utimes(memoryPath, new Date(statBefore.atimeMs), new Date(statBefore.mtimeMs))

      const second = await store.load(tmp.path)
      expect(second?.contentHash).toBe("initial")
    } finally {
      readFileSpy.mockRestore()
    }
  })

  test("load returns null after clear()", async () => {
    await using tmp = await tmpdir()
    await store.save(tmp.path, sampleMemory())
    expect(await store.load(tmp.path)).not.toBeNull()
    await store.clear(tmp.path)
    expect(await store.load(tmp.path)).toBeNull()
  })

  test("repeated loads return distinct objects (caller mutations do not leak)", async () => {
    await using tmp = await tmpdir()
    await store.save(tmp.path, sampleMemory({ totalTokens: 100 }))

    const first = (await store.load(tmp.path))!
    first.totalTokens = 999

    const second = (await store.load(tmp.path))!
    expect(second.totalTokens).toBe(100)
  })
})
