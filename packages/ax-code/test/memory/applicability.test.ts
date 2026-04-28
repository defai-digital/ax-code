import { describe, expect, test } from "bun:test"
import { entryApplies, matchesPath, normalizePathForMatch, normalizeTags } from "../../src/memory/applicability"
import type { MemoryEntry } from "../../src/memory/types"

describe("memory.applicability", () => {
  test("normalizes comma-separated tags", () => {
    expect(normalizeTags(" Memory, ranking ,,Storage ")).toEqual(["memory", "ranking", "storage"])
    expect(normalizeTags([" Memory ", "ranking"])).toEqual(["memory", "ranking"])
  })

  test("matches absolute, relative, basename, and backslash path patterns", () => {
    const projectRoot = "/repo"
    const entry = memoryEntry({
      pathGlobs: ["src\\**\\*.ts", "README.md"],
    })

    expect(matchesPath(projectRoot, entry, ["/repo/src/memory/recall.ts"])).toBe(true)
    expect(matchesPath(projectRoot, entry, ["README.md"])).toBe(true)
    expect(matchesPath(projectRoot, entry, ["docs/guide.md"])).toBe(false)
    expect(normalizePathForMatch(projectRoot, "/repo/src/memory/recall.ts")).toEqual([
      "/repo/src/memory/recall.ts",
      "src/memory/recall.ts",
      "recall.ts",
    ])
  })

  test("entryApplies composes agent, tag, path, and expiry checks", () => {
    const entry = memoryEntry({
      agents: ["build"],
      tags: ["memory", "ranking"],
      pathGlobs: ["src/**/*.ts"],
      expiresAt: "2026-02-01T00:00:00.000Z",
    })

    const base = {
      projectRoot: "/repo",
      agent: "build",
      tags: ["memory"],
      paths: ["/repo/src/memory/recall.ts"],
      nowMs: new Date("2026-01-01T00:00:00.000Z").getTime(),
    }

    expect(entryApplies(entry, base)).toBe(true)
    expect(entryApplies(entry, { ...base, agent: "security" })).toBe(false)
    expect(entryApplies(entry, { ...base, tags: ["storage"] })).toBe(false)
    expect(entryApplies(entry, { ...base, paths: ["/repo/docs/guide.md"] })).toBe(false)
    expect(entryApplies(entry, { ...base, nowMs: new Date("2026-03-01T00:00:00.000Z").getTime() })).toBe(false)
    expect(
      entryApplies(entry, {
        ...base,
        includeExpired: true,
        nowMs: new Date("2026-03-01T00:00:00.000Z").getTime(),
      }),
    ).toBe(true)
  })

  test("path-scoped entries apply when no path context is available", () => {
    const entry = memoryEntry({ pathGlobs: ["src/**/*.ts"] })
    expect(entryApplies(entry, { projectRoot: "/repo" })).toBe(true)
  })
})

function memoryEntry(input: Partial<MemoryEntry>): MemoryEntry {
  return {
    name: "entry",
    body: "body",
    savedAt: "2026-01-01T00:00:00.000Z",
    ...input,
  }
}
