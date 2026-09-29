import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { DISCOVERY_READ_CONCURRENCY, mapWithBoundedConcurrency } from "../src/discovery-concurrency.js"
import { discoverSources, readGroundingExcerpts, readSourceEvidence } from "../src/discovery.js"
import { sha256 } from "../src/hash.js"
import type { WikiSource } from "../src/types.js"

const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-wiki-discovery-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function sourceFor(relative: string, content: Buffer): WikiSource {
  return {
    path: relative,
    hash: sha256(content),
    bytes: content.byteLength,
    category: "documentation",
  }
}

describe("readSourceEvidence", () => {
  test("returns the full file when it fits the byte budget", async () => {
    const root = await fixture()
    const body = Buffer.from("hello wiki\n", "utf8")
    await writeFile(path.join(root, "README.md"), body)
    const [evidence] = await readSourceEvidence({
      root,
      sources: [sourceFor("README.md", body)],
      maxTotalBytes: 1000,
    })
    expect(evidence?.content).toBe("hello wiki\n")
    expect(evidence?.truncated).toBe(false)
  })

  test("clips to the byte budget on a UTF-8 character boundary", async () => {
    const root = await fixture()
    // "a" (1 byte) + grinning face (4 bytes) + "b" (1 byte)
    const body = Buffer.from("a😀b", "utf8")
    expect(body.byteLength).toBe(6)
    await writeFile(path.join(root, "note.md"), body)
    const [evidence] = await readSourceEvidence({
      root,
      sources: [sourceFor("note.md", body)],
      maxTotalBytes: 3,
    })
    expect(evidence?.content).toBe("a")
    expect(evidence?.content.includes("\uFFFD")).toBe(false)
    expect(evidence?.truncated).toBe(true)
  })

  test("keeps a complete multi-byte character that fits exactly", async () => {
    const root = await fixture()
    const body = Buffer.from("你好", "utf8")
    expect(body.byteLength).toBe(6)
    await writeFile(path.join(root, "note.md"), body)
    const [evidence] = await readSourceEvidence({
      root,
      sources: [sourceFor("note.md", body)],
      maxTotalBytes: 6,
    })
    expect(evidence?.content).toBe("你好")
    expect(evidence?.truncated).toBe(false)
  })

  test("marks the per-file prefix limit even when the page has remaining budget", async () => {
    const root = await fixture()
    const body = Buffer.from("// Stable background\n".repeat(2000) + "export function criticalTailGuard() {}\n")
    await writeFile(path.join(root, "entry.ts"), body)
    const [evidence] = await readSourceEvidence({
      root,
      sources: [sourceFor("entry.ts", body)],
      maxTotalBytes: 160_000,
    })
    expect(evidence?.truncated).toBe(true)
    expect(Buffer.byteLength(evidence!.content)).toBe(32_000)
    expect(evidence?.content).not.toContain("criticalTailGuard")
  })

  test("preserves source order and stops reading once the total budget is spent", async () => {
    const root = await fixture()
    const first = Buffer.from("aaaa", "utf8")
    const second = Buffer.from("bbbb", "utf8")
    const third = Buffer.from("cccc", "utf8")
    await writeFile(path.join(root, "a.md"), first)
    await writeFile(path.join(root, "b.md"), second)
    await writeFile(path.join(root, "c.md"), third)
    const evidence = await readSourceEvidence({
      root,
      sources: [sourceFor("a.md", first), sourceFor("b.md", second), sourceFor("c.md", third)],
      maxTotalBytes: 6,
    })
    expect(evidence.map((item) => item.path)).toEqual(["a.md", "b.md"])
    expect(evidence[0]?.content).toBe("aaaa")
    expect(evidence[1]?.content).toBe("bb")
    expect(evidence[1]?.truncated).toBe(true)
  })
})

function createGate() {
  let release!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    wait,
    release() {
      release()
    },
  }
}

describe("mapWithBoundedConcurrency", () => {
  test("returns results in input order when later items finish first", async () => {
    const start = [createGate(), createGate(), createGate(), createGate()]
    const cont = [createGate(), createGate(), createGate(), createGate()]
    const finished: number[] = []

    const pending = mapWithBoundedConcurrency(["w", "x", "y", "z"], 2, async (item, index) => {
      start[index]!.release()
      await cont[index]!.wait
      finished.push(index)
      return item.toUpperCase()
    })

    await Promise.all([start[0]!.wait, start[1]!.wait])
    cont[1]!.release()
    await start[2]!.wait
    cont[2]!.release()
    await start[3]!.wait
    cont[3]!.release()
    cont[0]!.release()

    expect(await pending).toEqual(["W", "X", "Y", "Z"])
    expect(finished).toEqual([1, 2, 3, 0])
  })

  test("never runs more than `concurrency` mappers at once", async () => {
    const items = [0, 1, 2, 3, 4]
    const start = items.map(() => createGate())
    const cont = items.map(() => createGate())
    let inFlight = 0
    let peak = 0

    const pending = mapWithBoundedConcurrency(items, 2, async (item, index) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      start[index]!.release()
      await cont[index]!.wait
      inFlight -= 1
      return item
    })

    await Promise.all([start[0]!.wait, start[1]!.wait])
    expect(inFlight).toBe(2)
    expect(peak).toBe(2)

    cont[0]!.release()
    await start[2]!.wait
    expect(inFlight).toBe(2)
    expect(peak).toBe(2)

    for (const gate of cont) gate.release()
    expect(await pending).toEqual(items)
    expect(peak).toBeLessThanOrEqual(2)
    expect(inFlight).toBe(0)
  })

  test("returns an empty array for empty input", async () => {
    expect(await mapWithBoundedConcurrency([], DISCOVERY_READ_CONCURRENCY, async (item) => item)).toEqual([])
  })
})

describe("discoverSources", () => {
  test("returns eligible sources in sorted path order", async () => {
    const root = await fixture()
    const names = Array.from({ length: 20 }, (_, index) => `file-${String(index).padStart(2, "0")}.md`)
    await Promise.all([...names].reverse().map((name) => writeFile(path.join(root, name), `${name} body\n`)))
    const sources = await discoverSources({ root, wikiDir: "ax-wiki" })
    expect(sources.map((source) => source.path)).toEqual(names)
    expect(sources[0]).toMatchObject({
      path: "file-00.md",
      hash: sha256(Buffer.from("file-00.md body\n")),
      bytes: Buffer.byteLength("file-00.md body\n"),
      category: "documentation",
    })
    expect(sources[19]).toMatchObject({
      path: "file-19.md",
      language: undefined,
    })
  })

  test("keeps readable sources when oversized and binary inputs are skipped", async () => {
    const root = await fixture()
    const keepA = Buffer.from("alpha\n", "utf8")
    const keepZ = Buffer.from("export const z = 1\n", "utf8")
    await writeFile(path.join(root, "a.md"), keepA)
    await writeFile(path.join(root, "z.ts"), keepZ)
    await writeFile(path.join(root, "binary.md"), Buffer.from("hello\0world"))
    await writeFile(path.join(root, "huge.md"), Buffer.alloc(64, 97))
    await mkdir(path.join(root, "ax-wiki"), { recursive: true })
    await writeFile(path.join(root, "ax-wiki", "page.md"), "# generated\n")

    const sources = await discoverSources({
      root,
      wikiDir: "ax-wiki",
      config: { maxSourceBytes: 32 },
    })
    expect(sources.map((source) => source.path)).toEqual(["a.md", "z.ts"])
    expect(sources[0]).toMatchObject({
      path: "a.md",
      hash: sha256(keepA),
      bytes: keepA.byteLength,
      category: "documentation",
    })
    expect(sources[1]).toMatchObject({
      path: "z.ts",
      hash: sha256(keepZ),
      bytes: keepZ.byteLength,
      category: "code",
      language: "TypeScript",
    })
  })

  test.runIf(process.platform !== "win32")(
    "isolates skipped unreadable, oversized, binary, and symlink inputs",
    async () => {
      const root = await fixture()
      const keepA = Buffer.from("alpha\n", "utf8")
      const keepZ = Buffer.from("zeta\n", "utf8")
      await writeFile(path.join(root, "a.md"), keepA)
      await writeFile(path.join(root, "z.md"), keepZ)
      await writeFile(path.join(root, "binary.md"), Buffer.from("hello\0world"))
      await writeFile(path.join(root, "huge.md"), Buffer.alloc(64, 97))
      await writeFile(path.join(root, "unreadable.md"), "secret\n")
      await chmod(path.join(root, "unreadable.md"), 0o000)
      await symlink("a.md", path.join(root, "link.md"))

      const sources = await discoverSources({
        root,
        wikiDir: "ax-wiki",
        config: { maxSourceBytes: 32 },
      })
      expect(sources.map((source) => source.path)).toEqual(["a.md", "z.md"])
      expect(sources[0]).toMatchObject({ path: "a.md", hash: sha256(keepA), bytes: keepA.byteLength })
      expect(sources[1]).toMatchObject({ path: "z.md", hash: sha256(keepZ), bytes: keepZ.byteLength })
    },
  )
})

describe("readGroundingExcerpts", () => {
  test("returns sorted deduped excerpts for readable files", async () => {
    const root = await fixture()
    await writeFile(path.join(root, "b.ts"), "export const b = 1\n")
    await writeFile(path.join(root, "a.ts"), "export class Foo {}\n")
    const excerpts = await readGroundingExcerpts(root, ["b.ts", "a.ts", "b.ts"])
    expect([...excerpts.keys()]).toEqual(["a.ts", "b.ts"])
    expect(excerpts.get("a.ts")).toBe("export class Foo {}\n")
  })

  test("skips missing files, symlinks, and root escapes without failing", async () => {
    const root = await fixture()
    await writeFile(path.join(root, "a.ts"), "export class Foo {}\n")
    await symlink("a.ts", path.join(root, "link.ts"))
    const excerpts = await readGroundingExcerpts(root, ["missing.ts", "link.ts", "../escape.ts", "a.ts"])
    expect([...excerpts.keys()]).toEqual(["a.ts"])
  })

  test("respects per-file, total, and path-count budgets in sorted order", async () => {
    const root = await fixture()
    await writeFile(path.join(root, "a.ts"), "0123456789")
    await writeFile(path.join(root, "b.ts"), "abcdefghij")
    await writeFile(path.join(root, "c.ts"), "ABCDEFGHIJ")
    const budgeted = await readGroundingExcerpts(root, ["c.ts", "b.ts", "a.ts"], {
      perFileBytes: 6,
      totalBytes: 8,
      maxPaths: 1000,
    })
    expect([...budgeted.keys()]).toEqual(["a.ts", "b.ts"])
    expect(budgeted.get("a.ts")).toBe("012345")
    expect(budgeted.get("b.ts")).toBe("ab")
    const counted = await readGroundingExcerpts(root, ["c.ts", "b.ts", "a.ts"], {
      perFileBytes: 100,
      totalBytes: 10000,
      maxPaths: 2,
    })
    expect([...counted.keys()]).toEqual(["a.ts", "b.ts"])
  })

  test("skips empty files", async () => {
    const root = await fixture()
    await writeFile(path.join(root, "empty.ts"), "")
    await writeFile(path.join(root, "full.ts"), "x\n")
    const excerpts = await readGroundingExcerpts(root, ["empty.ts", "full.ts"])
    expect([...excerpts.keys()]).toEqual(["full.ts"])
  })
})
