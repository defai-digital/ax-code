import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { recall } from "../../src/memory/recall"
import { recordEntry } from "../../src/memory/recorder"

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

  test("ordering: feedback > userPrefs > decisions; ties broken by score then savedAt desc", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "decisions", { name: "d1", body: "x" })
    await recordEntry(tmp.path, "userPrefs", { name: "u1", body: "x" })
    await recordEntry(tmp.path, "feedback", { name: "f1", body: "x" })

    const kinds = (await recall(tmp.path)).map((r) => r.kind)
    expect(kinds).toEqual(["feedback", "userPrefs", "decisions"])
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
})
