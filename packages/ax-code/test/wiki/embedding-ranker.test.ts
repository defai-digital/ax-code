import { expect, test, vi } from "vitest"
import type { WikiPlanPage, WikiSource } from "@ax-code/ax-wiki"
import { createIdleWikiSourceRanker } from "../../src/wiki/embedding-ranker"
import {
  parseWikiEmbeddings,
  verifyWikiEmbeddingFiles,
  WikiEmbeddingCleanupError,
} from "../../src/wiki/embedding-worker"
import { tmpdir } from "../fixture/fixture"

const page: WikiPlanPage = {
  path: "module.md",
  title: "Recovery",
  purpose: "Restore sessions",
  selectors: ["**"],
  kind: "module",
}
const sources: WikiSource[] = ["index.ts", "first.test.ts", "second.test.ts", "theme.ts", "recovery.ts"].map(
  (path) => ({
    path,
    hash: path,
    bytes: 100,
    category: path.includes("test") ? "test" : "code",
  }),
)
function fixture() {
  const close = vi.fn(async () => {})
  const embed = vi.fn(async (texts: string[]) =>
    texts.map((text) => (text.startsWith("Instruct:") || text.includes("recovery.ts") ? [1, 0] : [0, 1])),
  )
  const open = vi.fn(async () => ({ close, embed }))
  const read = vi.fn(async () => "source content")
  return { open, read, close, embed }
}

test("ranks optional evidence while protecting entrypoint/tests and closes before returning", async () => {
  const runtime = fixture()
  const ranker = createIdleWikiSourceRanker({ root: "/unused" }, runtime)
  const result = await ranker.rank([{ page, sources }])
  expect(result.get(page.path)).toEqual(["index.ts", "first.test.ts", "second.test.ts", "recovery.ts", "theme.ts"])
  expect(runtime.read).toHaveBeenCalledTimes(2)
  expect(runtime.close).toHaveBeenCalledTimes(1)
})

test("missing engine and small source lists do not read sources", async () => {
  const runtime = fixture()
  const absent = vi.fn(async () => undefined)
  const ranker = createIdleWikiSourceRanker({ root: "/unused" }, { ...runtime, open: absent })
  expect(await ranker.rank([{ page, sources: sources.slice(0, 3) }])).toEqual(new Map())
  expect(absent).not.toHaveBeenCalled()
  expect(await ranker.rank([{ page, sources }])).toEqual(new Map())
  expect(runtime.read).not.toHaveBeenCalled()
})

test("permission denial never reads or embeds denied sources", async () => {
  const runtime = fixture()
  const ranker = createIdleWikiSourceRanker({ root: "/unused", allowSource: (p) => p !== "recovery.ts" }, runtime)
  expect(await ranker.rank([{ page, sources }])).toEqual(new Map())
  expect(runtime.read).not.toHaveBeenCalled()
  expect(runtime.embed).not.toHaveBeenCalled()
  expect(runtime.open).not.toHaveBeenCalled()
})

test("failure discards partial rankings, closes worker and preserves baseline", async () => {
  const runtime = fixture()
  runtime.embed.mockRejectedValueOnce(new Error("worker unavailable"))
  const ranker = createIdleWikiSourceRanker({ root: "/unused" }, runtime)
  expect(await ranker.rank([{ page, sources }])).toEqual(new Map())
  expect(runtime.close).toHaveBeenCalledOnce()
})

test("foreground abort propagates after cleanup instead of continuing generation", async () => {
  const runtime = fixture()
  const controller = new AbortController()
  runtime.embed.mockImplementation(async () => {
    controller.abort(new DOMException("Foreground", "AbortError"))
    controller.signal.throwIfAborted()
    return []
  })
  const ranker = createIdleWikiSourceRanker({ root: "/unused", signal: controller.signal }, runtime)
  await expect(ranker.rank([{ page, sources }])).rejects.toMatchObject({ name: "AbortError" })
  expect(runtime.close).toHaveBeenCalledOnce()
})

test("optional-stage deadline falls back and releases worker", async () => {
  const runtime = fixture()
  const open = vi.fn(async (signal: AbortSignal) => ({
    close: runtime.close,
    embed: async () =>
      new Promise<number[][]>((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      ),
  }))
  const ranker = createIdleWikiSourceRanker({ root: "/unused" }, { ...runtime, open, timeoutMs: 10 })
  expect(await ranker.rank([{ page, sources }])).toEqual(new Map())
  expect(runtime.close).toHaveBeenCalledOnce()
})

test("vectors are reordered by index and normalized; malformed vectors are rejected", () => {
  const vector = [2, ...Array(1023).fill(0)]
  expect(parseWikiEmbeddings({ data: [{ index: 0, embedding: vector }] }, 1)[0][0]).toBe(1)
  for (const data of [
    [{ index: 1, embedding: vector }],
    [{ index: 0, embedding: [1] }],
    [{ index: 0, embedding: Array(1024).fill(0) }],
    [{ index: 0, embedding: Array(1024).fill(NaN) }],
    [
      { index: 0, embedding: vector },
      { index: 0, embedding: vector },
    ],
  ])
    expect(() => parseWikiEmbeddings({ data }, data.length)).toThrow()
})

test("partial model directories are not trusted", async () => {
  await using tmp = await tmpdir({})
  expect(await verifyWikiEmbeddingFiles(tmp.path, new AbortController().signal)).toBe(false)
})

test("unconfirmed worker cleanup fails the idle job instead of continuing with a competing worker", async () => {
  const runtime = fixture()
  runtime.open.mockRejectedValueOnce(new WikiEmbeddingCleanupError({ message: "still running" }))
  await expect(
    createIdleWikiSourceRanker({ root: "/unused" }, runtime).rank([{ page, sources }]),
  ).rejects.toBeInstanceOf(WikiEmbeddingCleanupError)
})
