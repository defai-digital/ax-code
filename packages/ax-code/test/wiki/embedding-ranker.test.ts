import { expect, test, vi } from "vitest"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import type { WikiPlanPage, WikiSource } from "@ax-code/ax-wiki"
import { buildPure, type WikiPageGenerationRequest } from "@ax-code/ax-wiki"
import { readFilePrefix } from "@ax-code/ax-wiki/node"
import { createIdleWikiSourceRanker } from "../../src/wiki/embedding-ranker"
import {
  parseWikiEmbeddings,
  verifyWikiEmbeddingFiles,
  WikiEmbeddingCleanupError,
} from "../../src/wiki/embedding-worker"
import { tmpdir } from "../fixture/fixture"
import { createWikiEmbeddingRankCache } from "../../src/wiki/embedding-cache"

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
    bytes: 32_000,
    category: path.includes("test") ? "test" : "code",
  }),
)
function fixture() {
  const close = vi.fn(async () => {})
  const embed = vi.fn(async (texts: string[]) =>
    texts.map((text) => (text.startsWith("Instruct:") || text.includes("recovery.ts") ? [1, 0] : [0, 1])),
  )
  const open = vi.fn(async () => ({ close, embed }))
  const read = vi.fn(async (_root: string, _relative: string, _maxBytes: number) => "source content")
  return { open, read, close, embed }
}

test("ranks optional evidence while protecting entrypoint/tests and closes before returning", async () => {
  const runtime = fixture()
  const ranker = createIdleWikiSourceRanker({ root: "/unused" }, runtime)
  const result = await ranker.rank([{ page, sources }], { maxTotalBytes: 100_000 })
  expect(result.get(page.path)).toEqual(["index.ts", "first.test.ts", "second.test.ts", "recovery.ts", "theme.ts"])
  expect(runtime.read).toHaveBeenCalledTimes(2)
  expect(runtime.close).toHaveBeenCalledTimes(1)
})

test("empty source files retain their slots without discarding valid evidence rankings", async () => {
  await using tmp = await tmpdir({})
  await writeFile(path.join(tmp.path, "empty.ts"), "")
  await writeFile(path.join(tmp.path, "theme.ts"), "export const theme = 'blue'")
  await writeFile(path.join(tmp.path, "recovery.ts"), "export function restoreSession() {}")
  const selected = [...sources.slice(0, 3), { ...sources[0], path: "empty.ts", bytes: 0 }, ...sources.slice(3)]
  const runtime = fixture()
  const read = vi.fn(readFilePrefix)
  const result = await createIdleWikiSourceRanker({ root: tmp.path }, { ...runtime, read }).rank(
    [{ page, sources: selected }],
    { maxTotalBytes: 100_000 },
  )
  expect(result.get(page.path)).toEqual([
    "index.ts",
    "first.test.ts",
    "second.test.ts",
    "empty.ts",
    "recovery.ts",
    "theme.ts",
  ])
  expect(read.mock.calls.map((args) => args[1])).toEqual(["theme.ts", "recovery.ts"])
  expect(runtime.close).toHaveBeenCalledOnce()
})

test("one nonempty optional source cannot benefit from ranking and never opens a worker", async () => {
  const runtime = fixture()
  const selected = sources.map((source, index) => (index === 3 ? { ...source, bytes: 0 } : source))
  expect(
    await createIdleWikiSourceRanker({ root: "/unused" }, runtime).rank([{ page, sources: selected }], {
      maxTotalBytes: 100_000,
    }),
  ).toEqual(new Map())
  expect(runtime.open).not.toHaveBeenCalled()
})

test("missing engine and small source lists do not read sources", async () => {
  const runtime = fixture()
  const absent = vi.fn(async () => undefined)
  const ranker = createIdleWikiSourceRanker({ root: "/unused" }, { ...runtime, open: absent })
  expect(await ranker.rank([{ page, sources: sources.slice(0, 3) }])).toEqual(new Map())
  expect(absent).not.toHaveBeenCalled()
  expect(await ranker.rank([{ page, sources }], { maxTotalBytes: 100_000 })).toEqual(new Map())
  expect(runtime.read).not.toHaveBeenCalled()
})

test("permission denial never reads or embeds denied sources", async () => {
  const runtime = fixture()
  const ranker = createIdleWikiSourceRanker({ root: "/unused", allowSource: (p) => p !== "recovery.ts" }, runtime)
  expect(await ranker.rank([{ page, sources }], { maxTotalBytes: 100_000 })).toEqual(new Map())
  expect(runtime.read).not.toHaveBeenCalled()
  expect(runtime.embed).not.toHaveBeenCalled()
  expect(runtime.open).not.toHaveBeenCalled()
})

test("failure discards partial rankings, closes worker and preserves baseline", async () => {
  const runtime = fixture()
  runtime.embed.mockRejectedValueOnce(new Error("worker unavailable"))
  const ranker = createIdleWikiSourceRanker({ root: "/unused" }, runtime)
  expect(await ranker.rank([{ page, sources }], { maxTotalBytes: 100_000 })).toEqual(new Map())
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
  await expect(ranker.rank([{ page, sources }], { maxTotalBytes: 100_000 })).rejects.toMatchObject({
    name: "AbortError",
  })
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
  expect(await ranker.rank([{ page, sources }], { maxTotalBytes: 100_000 })).toEqual(new Map())
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
    createIdleWikiSourceRanker({ root: "/unused" }, runtime).rank([{ page, sources }], { maxTotalBytes: 100_000 }),
  ).rejects.toBeInstanceOf(WikiEmbeddingCleanupError)
})

test("all-fit evidence or a protected prefix that fills the budget never opens a worker", async () => {
  const runtime = fixture()
  const ranker = createIdleWikiSourceRanker({ root: "/unused" }, runtime)
  expect(await ranker.rank([{ page, sources }])).toEqual(new Map())
  expect(await ranker.rank([{ page, sources }], { maxTotalBytes: 90_000 })).toEqual(new Map())
  expect(runtime.open).not.toHaveBeenCalled()
})

test("durable receipts reuse ranking without Engine and invalidate changed source hashes or budgets", async () => {
  await using tmp = await tmpdir({})
  const runtime = fixture()
  const input = { root: tmp.path, wikiDir: ".ax-wiki" }
  const first = await createIdleWikiSourceRanker(input, runtime).rank([{ page, sources }], { maxTotalBytes: 100_000 })
  const offline = vi.fn(async () => undefined)
  const second = createIdleWikiSourceRanker(input, { ...runtime, open: offline })
  expect(await second.rank([{ page, sources }], { maxTotalBytes: 100_000 })).toEqual(first)
  expect(offline).not.toHaveBeenCalled()
  const changed = sources.map((source, index) => (index === 4 ? { ...source, hash: "changed" } : source))
  expect(await second.rank([{ page, sources: changed }], { maxTotalBytes: 100_000 })).toEqual(new Map())
  expect(await second.rank([{ page, sources }], { maxTotalBytes: 110_000 })).toEqual(new Map())
  expect(offline).toHaveBeenCalledTimes(2)
})

test("forged receipts cannot add sources or change the protected prefix", async () => {
  const runtime = fixture()
  for (const order of [sources.map(() => "secret.env"), [...sources].reverse().map((s) => s.path)]) {
    const cache = { read: vi.fn(async () => order), write: vi.fn(async () => {}) }
    const result = await createIdleWikiSourceRanker({ root: "/unused" }, { ...runtime, cache }).rank(
      [{ page, sources }],
      { maxTotalBytes: 100_000 },
    )
    expect(result.get(page.path)).toEqual(["index.ts", "first.test.ts", "second.test.ts", "recovery.ts", "theme.ts"])
    expect(cache.write).toHaveBeenCalledOnce()
  }
})

test("a later failed page retains earlier matching receipts and writes no partial new ranking", async () => {
  await using tmp = await tmpdir({})
  const input = { root: tmp.path, wikiDir: ".ax-wiki" }
  const runtime = fixture()
  const first = await createIdleWikiSourceRanker(input, runtime).rank([{ page, sources }], { maxTotalBytes: 100_000 })
  const cache = createWikiEmbeddingRankCache(input)
  const write = vi.spyOn(cache, "write")
  runtime.embed.mockRejectedValue(new Error("engine unavailable"))
  const result = await createIdleWikiSourceRanker(input, { ...runtime, cache }).rank(
    [
      { page, sources },
      { page: { ...page, path: "second.md" }, sources },
    ],
    { maxTotalBytes: 100_000 },
  )
  expect(result).toEqual(first)
  expect(write).not.toHaveBeenCalled()
})

test("the 128-source budget is shared across pages and unscored slots retain baseline order", async () => {
  const runtime = fixture()
  const pages = ["a", "b", "c"].map((prefix) => ({
    page: { ...page, path: `${prefix}.md` },
    sources: Array.from({ length: 100 }, (_, index) => ({ ...sources[0], path: `${prefix}/${index}.ts` })),
  }))
  const result = await createIdleWikiSourceRanker({ root: "/unused" }, runtime).rank(pages, { maxTotalBytes: 100_000 })
  expect(runtime.read).toHaveBeenCalledTimes(128)
  expect(result.size).toBe(3)
  for (const prefix of ["a", "b", "c"]) {
    expect(
      runtime.read.mock.calls.filter((args) => (args[1] as string).startsWith(prefix + "/")).length,
    ).toBeGreaterThanOrEqual(42)
    const entry = pages.find((p) => p.page.path === `${prefix}.md`)!
    expect(new Set(result.get(entry.page.path))).toEqual(new Set(entry.sources.map((s) => s.path)))
    expect(result.get(entry.page.path)!.slice(0, 3)).toEqual(entry.sources.slice(0, 3).map((s) => s.path))
    expect(result.get(entry.page.path)!.at(-1)).toBe(`${prefix}/99.ts`)
  }
})

test("a durable ranking preserves compiler fingerprints and skips generation when Engine is unavailable", async () => {
  await using tmp = await tmpdir({})
  const runtime = fixture()
  runtime.embed.mockImplementation(async (texts) =>
    texts.map((text) => (text.startsWith("Instruct:") || text.includes("theme.ts") ? [1, 0] : [0, 1])),
  )
  const input = { root: tmp.path, wikiDir: ".ax-wiki" }
  const generator = vi.fn(async (request: WikiPageGenerationRequest) => ({
    summary: "Source-backed architecture and recovery responsibilities for this repository.",
    body: `## Purpose\n\nThis guide explains ${request.page.purpose} using the selected source files. Verify these sources before changing behavior.\n\n## Change guidance\n\nRun the repository tests after modifying session recovery and inspect related callers with code intelligence.`,
    symbols: [],
  }))
  const build = {
    ...input,
    sources,
    config: { maxPageSourceBytes: 100_000, pages: [{ ...page, path: "quickstart.md", kind: "custom" as const }] },
    generator,
    evidenceReader: async ({ sources }: { sources: WikiSource[] }) =>
      sources.map((source) => ({ ...source, content: "export const source = 1", truncated: false })),
    readExistingPage: async () => undefined,
  }
  const first = await buildPure({
    ...build,
    action: "generate",
    sourceRanker: createIdleWikiSourceRanker(input, runtime),
  })
  expect(first.generatedPages).toEqual(["quickstart.md"])
  expect(runtime.open).toHaveBeenCalledOnce()
  generator.mockClear()
  const offline = vi.fn(async () => undefined)
  const second = await buildPure({
    ...build,
    action: "update",
    previous: first.manifest,
    readExistingPage: async (page) => first.candidate.get(page),
    sourceRanker: createIdleWikiSourceRanker(input, { ...runtime, open: offline }),
  })
  expect(second.generatedPages).toEqual([])
  expect(second.manifest.pages["quickstart.md"].fingerprint).toBe(first.manifest.pages["quickstart.md"].fingerprint)
  expect(generator).not.toHaveBeenCalled()
  expect(offline).not.toHaveBeenCalled()
})
