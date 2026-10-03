import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { buildAxWiki, createWikiPageResultCache, sha256, type WikiPageGenerator } from "../src/node.js"

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-wiki-cache-"))
  roots.push(root)
  await writeFile(path.join(root, "README.md"), "# Fixture\n\nSource-backed cache integration fixture.\n")
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const result = {
  summary: "A source-backed repository guide.",
  body: "This page explains the fixture repository and its entry points using the supplied source evidence. Verify original source before changing code.",
  symbols: [],
}
const key = "fixture-key"
const page = "quickstart.md"
const relative = `.ax-wiki/.page-cache/${sha256(page)}.json`

describe("page-result staging", () => {
  test("round-trips a result, refuses stale keys, and deletes only the matching entry", async () => {
    const root = await fixture()
    const cache = createWikiPageResultCache({ root })
    await cache.write(page, key, result)
    expect(await cache.read(page, key)).toEqual(result)
    expect(await cache.read(page, "stale")).toBeUndefined()
    await cache.remove(page, "stale")
    expect(await cache.read(page, key)).toEqual(result)
    await cache.remove(page, key)
    expect(await cache.read(page, key)).toBeUndefined()
  })

  test("corrupt, wrong-shaped, and oversized entries are misses", async () => {
    const root = await fixture()
    const errors = vi.fn()
    const cache = createWikiPageResultCache({ root, onError: errors })
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    for (const content of [
      "{invalid",
      JSON.stringify({ schemaVersion: 1, page, key, result: { body: 123 } }),
      "x".repeat(1024 * 1024 + 1),
    ]) {
      await writeFile(path.join(root, relative), content)
      expect(await cache.read(page, key)).toBeUndefined()
    }
    expect(errors).toHaveBeenCalled()
  })

  test("read and write permissions independently gate the cache", async () => {
    const root = await fixture()
    const cache = createWikiPageResultCache({ root })
    await cache.write(page, key, result)
    const deniedRead = createWikiPageResultCache({ root, allowRead: () => false })
    expect(await deniedRead.read(page, key)).toBeUndefined()
    const deniedWrite = createWikiPageResultCache({ root, allowWrite: () => false })
    await deniedWrite.write(page, "replacement", result)
    await deniedWrite.remove(page, key)
    expect(await cache.read(page, key)).toEqual(result)
  })

  test("refuses a symlinked cache directory and does not write outside the Wiki", async () => {
    const root = await fixture()
    const outside = await fixture()
    await mkdir(path.join(root, ".ax-wiki"))
    await symlink(outside, path.join(root, ".ax-wiki/.page-cache"))
    const cache = createWikiPageResultCache({ root })
    await cache.write(page, key, result)
    expect(await cache.read(page, key)).toBeUndefined()
    expect(await readdir(outside)).toEqual(["README.md"])
  })

  test("refuses symlinked cache files without reading or modifying their targets", async () => {
    const root = await fixture()
    const outside = await fixture()
    const target = path.join(outside, "result.json")
    const content = JSON.stringify({ schemaVersion: 1, page, key, result })
    await writeFile(target, content)
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await symlink(target, path.join(root, relative))
    const cache = createWikiPageResultCache({ root })
    expect(await cache.read(page, key)).toBeUndefined()
    await cache.remove(page, key)
    await cache.write(page, key, result)
    expect(await readFile(target, "utf8")).toBe(content)
  })

  test("bounds entries even across repeatedly failing plans", async () => {
    const root = await fixture()
    const cache = createWikiPageResultCache({ root })
    const directory = path.join(root, ".ax-wiki/.page-cache")
    await mkdir(directory, { recursive: true })
    await Promise.all(
      Array.from({ length: 128 }, (_, index) => writeFile(path.join(directory, `${sha256(String(index))}.json`), "{}")),
    )
    await cache.write(page, key, result)
    expect(await readdir(directory)).toHaveLength(128)
    expect(await cache.read(page, key)).toBeUndefined()
  })

  test("resumes a cancelled initial build and clears staging only after publication", async () => {
    const root = await fixture()
    const cache = createWikiPageResultCache({ root })
    const abort = new AbortController()
    const make = vi.fn<WikiPageGenerator>(async () => result)
    await expect(
      buildAxWiki({
        root,
        action: "generate",
        generator: make,
        pageResultCache: cache,
        signal: abort.signal,
        onProgress: (event) => {
          if (event.type === "page_complete") abort.abort()
        },
      }),
    ).rejects.toThrow()
    expect(make).toHaveBeenCalledTimes(1)
    await expect(readFile(path.join(root, ".ax-wiki/.manifest.json"))).rejects.toThrow()
    expect(await readdir(path.join(root, ".ax-wiki/.page-cache"))).toHaveLength(1)
    make.mockClear()
    const resumed = await buildAxWiki({ root, action: "generate", generator: make, pageResultCache: cache })
    expect(resumed.generatedPages).toHaveLength(3)
    expect(make).toHaveBeenCalledTimes(2)
    expect(await readdir(path.join(root, ".ax-wiki/.page-cache"))).toHaveLength(0)
    make.mockClear()
    await buildAxWiki({ root, action: "generate", generator: make, pageResultCache: cache })
    expect(make).toHaveBeenCalledTimes(3)
  })
})

test("a failing cache diagnostic callback cannot fail compilation", async () => {
  const root = await fixture()
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
  await writeFile(path.join(root, relative), "not JSON")
  const cache = createWikiPageResultCache({
    root,
    onError: () => {
      throw new Error("diagnostic failure")
    },
  })
  expect(await cache.read(page, key)).toBeUndefined()
  expect(
    (await buildAxWiki({ root, action: "generate", generator: async () => result, pageResultCache: cache })).validation
      .ok,
  ).toBe(true)
})

test("simultaneous staging writes honor the entry cap", async () => {
  const root = await fixture()
  const cache = createWikiPageResultCache({ root })
  const directory = path.join(root, ".ax-wiki/.page-cache")
  await mkdir(directory, { recursive: true })
  await Promise.all(
    Array.from({ length: 127 }, (_, index) => writeFile(path.join(directory, `${sha256(String(index))}.json`), "{}")),
  )
  await Promise.all([cache.write(page, key, result), cache.write("second.md", key, result)])
  expect(await readdir(directory)).toHaveLength(128)
})

test("rejects a structurally valid cache result whose stored contents changed", async () => {
  const root = await fixture()
  const cache = createWikiPageResultCache({ root })
  await cache.write(page, key, result)
  const file = path.join(root, relative)
  const entry = JSON.parse(await readFile(file, "utf8"))
  entry.result.body += " Altered staged content."
  await writeFile(file, JSON.stringify(entry))
  expect(await cache.read(page, key)).toBeUndefined()
})

test("throwing permission callbacks are cache misses, never publication failures", async () => {
  const root = await fixture()
  const errors = vi.fn()
  const cache = createWikiPageResultCache({
    root,
    allowRead: () => {
      throw new Error("permission backend unavailable")
    },
    allowWrite: () => {
      throw new Error("permission backend unavailable")
    },
    onError: errors,
  })
  expect(await cache.read(page, key)).toBeUndefined()
  await cache.write(page, key, result)
  await cache.remove(page, key)
  expect(errors).toHaveBeenCalled()
})

test("a remove issued alongside a write is ordered after it", async () => {
  const root = await fixture()
  const cache = createWikiPageResultCache({ root })
  const pending = cache.write(page, key, result)
  await Promise.all([pending, cache.remove(page, key)])
  expect(await cache.read(page, key)).toBeUndefined()
})
