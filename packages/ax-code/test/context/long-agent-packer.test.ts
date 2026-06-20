import { describe, expect, test } from "vitest"
import { LongAgentContextPacker } from "@/context/long-agent-packer"

const BIG_BUDGET = 100_000

describe("LongAgentContextPacker.pack - Tier 0", () => {
  test("includes task and agentsMd in output", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: BIG_BUDGET,
      task: "Fix the login bug",
      agentsMd: "# AGENTS.md\nRun tests before commit.",
    })
    const labels = result.entries.map((e) => e.label)
    expect(labels).toContain("task")
    expect(labels).toContain("agents-md")
  })

  test("all Tier 0 entries have tier=0", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: BIG_BUDGET,
      task: "do something",
      agentsMd: "md",
      instructions: ["rule one", "rule two"],
      toolConstraints: "no network",
    })
    const t0 = result.entries.filter((e) => e.tier === 0)
    expect(t0.length).toBe(4)
  })

  test("empty optional fields produce no entries", () => {
    const result = LongAgentContextPacker.pack({ tokenBudget: BIG_BUDGET })
    expect(result.entries).toHaveLength(0)
  })
})

describe("LongAgentContextPacker.pack - Tier 1", () => {
  test("includes touched files as tier 1 entries", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: BIG_BUDGET,
      touchedFiles: [
        { path: "src/foo.ts", summary: "exports foo()" },
        { path: "src/bar.ts", summary: "exports bar()" },
      ],
    })
    const labels = result.entries.map((e) => e.label)
    expect(labels).toContain("touched:src/foo.ts")
    expect(labels).toContain("touched:src/bar.ts")
    expect(result.entries.every((e) => e.tier === 1)).toBe(true)
  })

  test("includes failing tests as tier 1", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: BIG_BUDGET,
      failingTests: ["test/foo.test.ts FAIL: assert x==y"],
    })
    const t1 = result.entries.filter((e) => e.label === "failing-tests")
    expect(t1).toHaveLength(1)
    expect(t1[0].tier).toBe(1)
  })

  test("includes diff as tier 1", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: BIG_BUDGET,
      diff: "--- a/foo\n+++ b/foo\n+new line",
    })
    const diffEntry = result.entries.find((e) => e.label === "diff")
    expect(diffEntry).toBeDefined()
    expect(diffEntry!.tier).toBe(1)
  })
})

describe("LongAgentContextPacker.pack - Tier 2 and 3", () => {
  test("dep-graph is tier 2", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: BIG_BUDGET,
      dependencyGraphSummary: "foo → bar → baz",
    })
    const entry = result.entries.find((e) => e.label === "dep-graph")
    expect(entry?.tier).toBe(2)
  })

  test("prd-adr-refs is tier 3", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: BIG_BUDGET,
      prdAdrRefs: ["ADR-013: Qwen3.7-Max backend"],
    })
    const entry = result.entries.find((e) => e.label === "prd-adr-refs")
    expect(entry?.tier).toBe(3)
  })

  test("all 4 tiers present when budget is sufficient", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: BIG_BUDGET,
      task: "big task",
      agentsMd: "rules",
      touchedFiles: [{ path: "a.ts", summary: "a" }],
      dependencyGraphSummary: "dep graph",
      stableDocs: "stable docs",
    })
    const tiers = new Set(result.entries.map((e) => e.tier))
    expect(tiers.has(0)).toBe(true)
    expect(tiers.has(1)).toBe(true)
    expect(tiers.has(2)).toBe(true)
    expect(tiers.has(3)).toBe(true)
  })
})

describe("LongAgentContextPacker.pack - budget enforcement", () => {
  test("tier 3 is dropped when budget is tight", () => {
    // Budget just enough for tier 0+1+2 but not tier 3
    const task = "x".repeat(1000)
    const stableDocs = "d".repeat(10_000)
    const tokenBudget = 500 // very small

    const result = LongAgentContextPacker.pack({
      tokenBudget,
      task,
      stableDocs,
    })
    expect(result.droppedTiers).toContain(3)
  })

  test("totalTokens never exceeds configured budget", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: 100,
      task: "x".repeat(2000),
      agentsMd: "y".repeat(2000),
      stableDocs: "z".repeat(2000),
    })
    expect(result.totalTokens).toBeLessThanOrEqual(100)
  })

  test("returns empty entries when even tier 0 does not fit", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: 1,
      task: "x".repeat(500),
    })
    expect(result.entries).toHaveLength(0)
  })

  test("continues adding smaller entries in a tier after one entry overflows", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: 50,
      touchedFiles: [
        { path: "small-before.ts", summary: "fits before" },
        { path: "huge.ts", summary: "x".repeat(1_000) },
        { path: "small-after.ts", summary: "fits after" },
      ],
      failingTests: ["unit/after-overflow.test.ts"],
    })

    const labels = result.entries.map((e) => e.label)
    expect(labels).toContain("touched:small-before.ts")
    expect(labels).not.toContain("touched:huge.ts")
    expect(labels).toContain("touched:small-after.ts")
    expect(labels).toContain("failing-tests")
    expect(result.droppedTiers).toContain(1)
  })
})

describe("LongAgentContextPacker.pack - ordering", () => {
  test("tier 0 entries come before tier 1", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: BIG_BUDGET,
      task: "task",
      agentsMd: "agents",
      touchedFiles: [{ path: "x.ts", summary: "x" }],
    })
    const tiers = result.entries.map((e) => e.tier)
    const lastT0 = tiers.lastIndexOf(0)
    const firstT1 = tiers.indexOf(1)
    if (lastT0 !== -1 && firstT1 !== -1) {
      expect(lastT0).toBeLessThan(firstT1)
    }
  })
})

describe("LongAgentContextPacker.pack - debugSummary", () => {
  test("debug summary includes budget and tier counts", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: BIG_BUDGET,
      task: "fix it",
    })
    expect(result.debugSummary).toContain("budget=")
    expect(result.debugSummary).toContain("tiers:")
  })

  test("reports all tiers fit when nothing dropped", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: BIG_BUDGET,
      task: "small",
    })
    expect(result.debugSummary).toContain("all tiers fit")
  })
})

describe("LongAgentContextPacker.render", () => {
  test("totalTokens accounts for render separators", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: BIG_BUDGET,
      task: "abcd",
      agentsMd: "efgh",
    })

    expect(result.totalTokens).toBeGreaterThan(Math.ceil("abcdefgh".length / 4))
    expect(result.totalTokens).toBe(Math.ceil(LongAgentContextPacker.render(result).length / 4))
  })

  test("concatenates entry contents with double newlines", () => {
    const result = LongAgentContextPacker.pack({
      tokenBudget: BIG_BUDGET,
      task: "task content",
      agentsMd: "agents content",
    })
    const rendered = LongAgentContextPacker.render(result)
    expect(rendered).toContain("task content")
    expect(rendered).toContain("agents content")
  })
})
