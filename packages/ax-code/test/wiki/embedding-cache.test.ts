import { expect, test } from "vitest"
import { mkdir, readdir, readFile, writeFile, symlink } from "node:fs/promises"
import path from "node:path"
import { createWikiEmbeddingRankCache } from "../../src/wiki/embedding-cache"
import { tmpdir } from "../fixture/fixture"

test("receipts survive recreation, bind keys and contain no source text", async () => {
  await using tmp = await tmpdir({})
  const input = { root: tmp.path, wikiDir: ".ax-wiki" }
  await createWikiEmbeddingRankCache(input).write("guide.md", "profile-source-budget-digest", [
    "index.ts",
    "recovery.ts",
  ])
  const cache = createWikiEmbeddingRankCache(input)
  expect(await cache.read("guide.md", "profile-source-budget-digest")).toEqual(["index.ts", "recovery.ts"])
  expect(await cache.read("guide.md", "different-model-or-source")).toBeUndefined()
  const directory = path.join(tmp.path, ".ax-wiki/.embedding-cache")
  const [slot] = await readdir(directory)
  const text = await readFile(path.join(directory, slot), "utf8")
  expect(text).not.toContain("embedding")
  expect(text).not.toContain("content")
  await writeFile(path.join(directory, slot), text.replace("recovery.ts", "secrets.env"))
  expect(await cache.read("guide.md", "profile-source-budget-digest")).toBeUndefined()
})

test("permissions prevent cache access; malformed and oversized receipts are misses", async () => {
  await using tmp = await tmpdir({})
  const input = { root: tmp.path, wikiDir: ".ax-wiki" }
  const denied = createWikiEmbeddingRankCache({ ...input, allowWrite: () => false })
  await denied.write("guide.md", "key", ["index.ts"])
  expect(await denied.read("guide.md", "key")).toBeUndefined()
  const cache = createWikiEmbeddingRankCache(input)
  await cache.write("guide.md", "key", ["index.ts"])
  expect(
    await createWikiEmbeddingRankCache({ ...input, allowRead: () => false }).read("guide.md", "key"),
  ).toBeUndefined()
  const directory = path.join(tmp.path, ".ax-wiki/.embedding-cache")
  const [slot] = await readdir(directory)
  for (const data of ["{invalid", "x".repeat(128 * 1024 + 1)]) {
    await writeFile(path.join(directory, slot), data)
    expect(await cache.read("guide.md", "key")).toBeUndefined()
  }
})

test("symlinked cache directories cannot write outside the wiki", async () => {
  await using tmp = await tmpdir({})
  const outside = path.join(tmp.path, "outside")
  await mkdir(outside)
  await mkdir(path.join(tmp.path, ".ax-wiki"))
  await symlink(outside, path.join(tmp.path, ".ax-wiki/.embedding-cache"))
  const cache = createWikiEmbeddingRankCache({ root: tmp.path, wikiDir: ".ax-wiki" })
  await cache.write("guide.md", "key", ["index.ts"])
  expect(await readdir(outside)).toEqual([])
  expect(await cache.read("guide.md", "key")).toBeUndefined()
})

test("cancellation is propagated instead of treated as a cache miss", async () => {
  await using tmp = await tmpdir({})
  const controller = new AbortController()
  controller.abort(new DOMException("Foreground", "AbortError"))
  const cache = createWikiEmbeddingRankCache({ root: tmp.path, wikiDir: ".ax-wiki", signal: controller.signal })
  await expect(cache.read("guide.md", "key")).rejects.toMatchObject({ name: "AbortError" })
  await expect(cache.write("guide.md", "key", ["index.ts"])).rejects.toMatchObject({ name: "AbortError" })
})

test("receipt count is bounded while an existing page can replace its stale receipt", async () => {
  await using tmp = await tmpdir({})
  const cache = createWikiEmbeddingRankCache({ root: tmp.path, wikiDir: ".ax-wiki" })
  for (let index = 0; index < 128; index++) await cache.write(`${index}.md`, "key", ["index.ts"])
  expect(await readdir(path.join(tmp.path, ".ax-wiki/.embedding-cache"))).toHaveLength(128)
  await cache.write("0.md", "updated", ["updated.ts"])
  expect(await cache.read("0.md", "key")).toBeUndefined()
  expect(await cache.read("0.md", "updated")).toEqual(["updated.ts"])
  expect(await readdir(path.join(tmp.path, ".ax-wiki/.embedding-cache"))).toHaveLength(128)
})

test("a full cache evicts the oldest receipt so a new page can be stored", async () => {
  await using tmp = await tmpdir({})
  const cache = createWikiEmbeddingRankCache({ root: tmp.path, wikiDir: ".ax-wiki" })
  for (let index = 0; index < 128; index++) await cache.write(`${index}.md`, "key", ["index.ts"])
  await cache.write("new.md", "key", ["fresh.ts"])
  expect(await cache.read("new.md", "key")).toEqual(["fresh.ts"])
  expect(await readdir(path.join(tmp.path, ".ax-wiki/.embedding-cache"))).toHaveLength(128)
})
