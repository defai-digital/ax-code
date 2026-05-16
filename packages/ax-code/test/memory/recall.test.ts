import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { recall } from "../../src/memory/recall"
import { recordEntry } from "../../src/memory/recorder"
import * as store from "../../src/memory/store"

describe("memory.recall", () => {
  test("empty memory returns []", async () => {
    await using tmp = await tmpdir()
    expect(await recall(tmp.path)).toEqual([])
  })

  test("returns all entries across kinds when no filter is given", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "no-mocks", body: "Real DB in tests" })
    await recordEntry(tmp.path, "userPrefs", { name: "language", body: "TW Chinese" })
    await recordEntry(tmp.path, "decisions", { name: "auth", body: "rewrite for compliance" })

    const results = await recall(tmp.path)
    expect(results).toHaveLength(3)
    // feedback first (actionability ordering)
    expect(results[0].kind).toBe("feedback")
  })

  test("query: exact name match scores highest", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "tests", body: "use real DB" })
    await recordEntry(tmp.path, "feedback", { name: "test-style", body: "describe blocks" })
    await recordEntry(tmp.path, "feedback", { name: "lint", body: "lint mentions tests" })

    const results = await recall(tmp.path, { query: "tests" })
    expect(results[0].entry.name).toBe("tests")
    expect(results[0].score).toBeGreaterThan(results[1].score)
  })

  test("query: matches in body, why, howToApply", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "a", body: "matches XYZQUERY in body" })
    await recordEntry(tmp.path, "feedback", { name: "b", body: "no match", why: "XYZQUERY rationale" })
    await recordEntry(tmp.path, "feedback", { name: "c", body: "no match", howToApply: "XYZQUERY apply" })
    await recordEntry(tmp.path, "feedback", { name: "d", body: "totally unrelated" })

    const names = (await recall(tmp.path, { query: "xyzquery" })).map((r) => r.entry.name)
    expect(names).toEqual(expect.arrayContaining(["a", "b", "c"]))
    expect(names).not.toContain("d")
  })

  test("query: multi-term search can match terms across one entry", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "db-tests", body: "Use Real DB integration tests" })
    await recordEntry(tmp.path, "feedback", { name: "real-ui", body: "Real browser coverage" })

    const results = await recall(tmp.path, { query: "real tests" })
    expect(results[0].entry.name).toBe("db-tests")
    expect(results.map((r) => r.entry.name)).toContain("db-tests")
  })

  test("kind filter: single", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "f1", body: "x" })
    await recordEntry(tmp.path, "userPrefs", { name: "u1", body: "y" })

    const results = await recall(tmp.path, { kind: "feedback" })
    expect(results).toHaveLength(1)
    expect(results[0].kind).toBe("feedback")
  })

  test("kind filter: multiple", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "f1", body: "x" })
    await recordEntry(tmp.path, "userPrefs", { name: "u1", body: "y" })
    await recordEntry(tmp.path, "decisions", { name: "d1", body: "z" })

    const results = await recall(tmp.path, { kind: ["feedback", "decisions"] })
    expect(results.map((r) => r.kind).sort()).toEqual(["decisions", "feedback"])
  })

  test("agent filter respects allow-list, lets unscoped entries through", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", {
      name: "test-rule",
      body: "x",
      agents: ["test", "debug"],
    })
    await recordEntry(tmp.path, "feedback", {
      name: "global-rule",
      body: "y",
    })

    const forSecurity = await recall(tmp.path, { agent: "security" })
    expect(forSecurity.map((r) => r.entry.name)).toEqual(["global-rule"])

    const forTest = await recall(tmp.path, { agent: "test" })
    expect(forTest.map((r) => r.entry.name).sort()).toEqual(["global-rule", "test-rule"])
  })

  test("limit caps result count", async () => {
    await using tmp = await tmpdir()
    for (let i = 0; i < 5; i++) {
      await recordEntry(tmp.path, "feedback", { name: `f${i}`, body: "x" })
    }
    expect(await recall(tmp.path, { limit: 2 })).toHaveLength(2)
  })

  test("tag filter requires all requested tags", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", {
      name: "memory-ranking",
      body: "Prefer explainable recall",
      tags: ["memory", "ranking"],
    })
    await recordEntry(tmp.path, "feedback", {
      name: "memory-storage",
      body: "Keep writes atomic",
      tags: ["memory", "storage"],
    })

    const names = (await recall(tmp.path, { tags: ["memory", "ranking"] })).map((r) => r.entry.name)
    expect(names).toEqual(["memory-ranking"])
  })

  test("path filter only returns path-scoped entries that match the path", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", {
      name: "ts-rule",
      body: "TypeScript rule",
      pathGlobs: ["src/**/*.ts"],
    })
    await recordEntry(tmp.path, "feedback", {
      name: "md-rule",
      body: "Markdown rule",
      pathGlobs: ["docs/**/*.md"],
    })
    await recordEntry(tmp.path, "feedback", {
      name: "global-rule",
      body: "Applies everywhere",
    })

    const names = (await recall(tmp.path, { path: `${tmp.path}/src/memory/recall.ts` })).map((r) => r.entry.name)
    expect(names).toContain("ts-rule")
    expect(names).toContain("global-rule")
    expect(names).not.toContain("md-rule")
  })

  test("path filter normalizes backslash glob patterns", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", {
      name: "windows-pattern",
      body: "Backslash path glob",
      pathGlobs: ["src\\**\\*.ts"],
    })

    const results = await recall(tmp.path, { path: `${tmp.path}/src/memory/recall.ts` })
    expect(results.map((r) => r.entry.name)).toContain("windows-pattern")
  })

  test("expired entries are ignored by default but can be included", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", {
      name: "expired",
      body: "old migration rule",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    await recordEntry(tmp.path, "feedback", { name: "active", body: "current migration rule" })

    const activeOnly = (await recall(tmp.path, { query: "migration" })).map((r) => r.entry.name)
    expect(activeOnly).toEqual(["active"])

    const withExpired = (await recall(tmp.path, { query: "migration", includeExpired: true })).map((r) => r.entry.name)
    expect(withExpired).toContain("expired")
    expect(withExpired).toContain("active")
  })

  test("ordering: feedback > userPrefs > decisions > reference; ties broken by score then savedAt desc", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "decisions", { name: "d1", body: "x" })
    await recordEntry(tmp.path, "userPrefs", { name: "u1", body: "x" })
    await recordEntry(tmp.path, "feedback", { name: "f1", body: "x" })
    await recordEntry(tmp.path, "reference", { name: "r1", body: "x" })

    const kinds = (await recall(tmp.path)).map((r) => r.kind)
    expect(kinds).toEqual(["feedback", "userPrefs", "decisions", "reference"])
  })

  test("no query: every matching entry gets score 1", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "a", body: "x" })
    const results = await recall(tmp.path)
    expect(results[0].score).toBe(1)
  })

  test("agent + query + limit compose correctly", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "test-mocks", body: "no mocks", agents: ["test"] })
    await recordEntry(tmp.path, "feedback", { name: "test-coverage", body: "raise to 80", agents: ["test"] })
    await recordEntry(tmp.path, "feedback", { name: "global", body: "no mocks anywhere" })
    await recordEntry(tmp.path, "feedback", { name: "security-scan", body: "weekly scan", agents: ["security"] })

    const results = await recall(tmp.path, { query: "mocks", agent: "test", limit: 5 })
    const names = results.map((r) => r.entry.name)
    expect(names).toContain("test-mocks")
    expect(names).toContain("global")
    expect(names).not.toContain("security-scan")
    expect(names).not.toContain("test-coverage")
  })

  test("reference kind: searchable and included in all-kinds recall", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "reference", { name: "linear-bugs", body: "Pipeline bugs in Linear project INGEST" })
    await recordEntry(tmp.path, "feedback", { name: "f1", body: "x" })

    const all = await recall(tmp.path)
    const kinds = all.map((r) => r.kind)
    expect(kinds).toContain("reference")

    const results = await recall(tmp.path, { query: "linear" })
    expect(results).toHaveLength(1)
    expect(results[0].entry.name).toBe("linear-bugs")
    expect(results[0].kind).toBe("reference")
  })

  test("recency bonus: entries saved within 7 days score 2 higher than older entries", async () => {
    await using tmp = await tmpdir()

    // Insert a fresh entry normally
    await recordEntry(tmp.path, "feedback", { name: "fresh", body: "recent rule" })

    // Manually insert a stale entry by writing to disk with old savedAt
    const memory = await store.load(tmp.path)
    expect(memory).not.toBeNull()
    const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days ago
    memory!.sections.feedback!.entries.push({
      name: "stale",
      body: "old rule",
      savedAt: staleDate,
    })
    await store.save(tmp.path, memory!)

    const results = await recall(tmp.path, { query: "rule" })
    const fresh = results.find((r) => r.entry.name === "fresh")!
    const stale = results.find((r) => r.entry.name === "stale")!
    expect(fresh.score).toBeGreaterThan(stale.score)
    expect(fresh.score - stale.score).toBe(2) // exactly the RECENCY_BONUS
  })

  test("confidence adjusts ranking and explain returns score evidence", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "high", body: "parser cache rule", confidence: 1 })
    await recordEntry(tmp.path, "feedback", { name: "low", body: "parser cache rule", confidence: 0.2 })

    const results = await recall(tmp.path, { query: "parser cache" })
    expect(results[0].entry.name).toBe("high")
    expect(results[0].reasons.length).toBeGreaterThan(0)
    expect(results.find((r) => r.entry.name === "low")?.reasons).toContain("confidence 0.2")
  })

  test("scope=global: searches global store, not project store", async () => {
    await using tmp = await tmpdir()
    await store.clearGlobal().catch(() => {})
    try {
      await recordEntry(tmp.path, "feedback", { name: "project-rule", body: "only in project" })
      await recordEntry(tmp.path, "userPrefs", { name: "global-pref", body: "reply in TW Chinese", scope: "global" })

      const projectResults = await recall(tmp.path, { scope: "project" })
      const names = projectResults.map((r) => r.entry.name)
      expect(names).toContain("project-rule")
      expect(names).not.toContain("global-pref")

      const globalResults = await recall(tmp.path, { scope: "global" })
      const globalNames = globalResults.map((r) => r.entry.name)
      expect(globalNames).toContain("global-pref")
      expect(globalNames).not.toContain("project-rule")
    } finally {
      await store.clearGlobal().catch(() => {})
    }
  })

  test("scope=all: merges project and global results", async () => {
    await using tmp = await tmpdir()
    await store.clearGlobal().catch(() => {})
    try {
      await recordEntry(tmp.path, "feedback", { name: "project-rule", body: "only in project" })
      await recordEntry(tmp.path, "userPrefs", { name: "global-pref", body: "reply in TW Chinese", scope: "global" })

      const allResults = await recall(tmp.path, { scope: "all" })
      const names = allResults.map((r) => r.entry.name)
      expect(names).toContain("project-rule")
      expect(names).toContain("global-pref")

      // Check source labeling
      const projectEntry = allResults.find((r) => r.entry.name === "project-rule")!
      const globalEntry = allResults.find((r) => r.entry.name === "global-pref")!
      expect(projectEntry.source).toBe("project")
      expect(globalEntry.source).toBe("global")
    } finally {
      await store.clearGlobal().catch(() => {})
    }
  })

  test("result includes source field for project scope", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "f1", body: "x" })
    const results = await recall(tmp.path)
    expect(results[0].source).toBe("project")
  })
})
