import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  clearWikiFailureMemory,
  readWikiFailureMemory,
  recordWikiFailure,
  wikiFailureCooldownMs,
  wikiFailureMemoryPath,
  wikiFailureMemorySuppresses,
  WIKI_FAILURE_COOLDOWN_LADDER_MS,
} from "../../src/wiki/failure-memory"
import { tmpdir } from "../fixture/fixture"

const HOUR = 60 * 60_000

describe("wiki failure memory", () => {
  test("keeps an unsafe wiki directory inside the repository", () => {
    const root = path.resolve("/tmp/ax-wiki-memory-root")
    const target = wikiFailureMemoryPath(root, "../outside")
    const relative = path.relative(root, target)
    expect(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)).toBe(false)
    expect(target).toBe(path.join(root, ".ax-wiki", ".failure-memory.json"))
  })

  test("uses a capped cooldown ladder", () => {
    expect(wikiFailureCooldownMs(1)).toBe(5 * 60_000)
    expect(wikiFailureCooldownMs(2)).toBe(15 * 60_000)
    expect(wikiFailureCooldownMs(3)).toBe(HOUR)
    expect(wikiFailureCooldownMs(4)).toBe(6 * HOUR)
    expect(wikiFailureCooldownMs(99)).toBe(WIKI_FAILURE_COOLDOWN_LADDER_MS[WIKI_FAILURE_COOLDOWN_LADDER_MS.length - 1])
  })

  test("suppresses inside the cooldown and releases after it", async () => {
    await using tmp = await tmpdir()
    const now = Date.parse("2026-01-01T00:00:00.000Z")
    await recordWikiFailure(tmp.path, "ax-wiki", { head: "h1", generatorKey: "g1", now })

    const memory = await readWikiFailureMemory(tmp.path, "ax-wiki")
    expect(memory?.consecutiveFailures).toBe(1)

    expect(wikiFailureMemorySuppresses(memory, { now: now + 60_000, head: "h1", generatorKey: "g1" }).suppressed).toBe(
      true,
    )
    expect(
      wikiFailureMemorySuppresses(memory, { now: now + 6 * 60_000, head: "h1", generatorKey: "g1" }).suppressed,
    ).toBe(false)
  })

  test("does not suppress when the head, generator, or plan changed", async () => {
    await using tmp = await tmpdir()
    const now = Date.parse("2026-01-01T00:00:00.000Z")
    await recordWikiFailure(tmp.path, "ax-wiki", { head: "h1", generatorKey: "g1", planHash: "p1", now })
    const memory = await readWikiFailureMemory(tmp.path, "ax-wiki")
    const at = now + 60_000

    expect(wikiFailureMemorySuppresses(memory, { now: at, head: "h2", generatorKey: "g1" }).suppressed).toBe(false)
    expect(wikiFailureMemorySuppresses(memory, { now: at, head: "h1", generatorKey: "g2" }).suppressed).toBe(false)
    expect(
      wikiFailureMemorySuppresses(memory, { now: at, head: "h1", generatorKey: "g1", planHash: "p2" }).suppressed,
    ).toBe(false)
  })

  test("extends the streak only for the same failure key", async () => {
    await using tmp = await tmpdir()
    const now = Date.parse("2026-01-01T00:00:00.000Z")
    const key = { head: "h1", generatorKey: "g1", planHash: "p1" }

    await recordWikiFailure(tmp.path, "ax-wiki", { ...key, now })
    const second = await recordWikiFailure(tmp.path, "ax-wiki", { ...key, now: now + 1000 })
    expect(second.consecutiveFailures).toBe(2)

    const third = await recordWikiFailure(tmp.path, "ax-wiki", { ...key, planHash: "p2", now: now + 2000 })
    expect(third.consecutiveFailures).toBe(1)
  })

  test("clears after a success and tolerates missing or corrupt files", async () => {
    await using tmp = await tmpdir()
    await recordWikiFailure(tmp.path, "ax-wiki", { head: "h1", generatorKey: "g1" })
    await clearWikiFailureMemory(tmp.path, "ax-wiki")
    expect(await readWikiFailureMemory(tmp.path, "ax-wiki")).toBeUndefined()

    await fs.mkdir(path.join(tmp.path, "ax-wiki"), { recursive: true })
    await fs.writeFile(wikiFailureMemoryPath(tmp.path, "ax-wiki"), "{ not json", "utf8")
    expect(await readWikiFailureMemory(tmp.path, "ax-wiki")).toBeUndefined()
    expect(wikiFailureMemorySuppresses(undefined, { now: Date.now() }).suppressed).toBe(false)
  })

  test("ignores memory written by another schema version", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, "ax-wiki"), { recursive: true })
    await fs.writeFile(
      wikiFailureMemoryPath(tmp.path, "ax-wiki"),
      JSON.stringify({ schemaVersion: 999, consecutiveFailures: 4, lastFailureAt: "2026-01-01T00:00:00.000Z" }),
      "utf8",
    )
    expect(await readWikiFailureMemory(tmp.path, "ax-wiki")).toBeUndefined()
  })
})
