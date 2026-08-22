import { beforeEach, describe, expect, test } from "vitest"
import { analyzeImpactImpl, extractFilesFromDiff } from "../src/analyze-impact"
import { installTestHost, type TestHost } from "./fixture/host"

describe("extractFilesFromDiff", () => {
  test("extracts touched files from +++/--- headers and strips a/ b/ prefixes", () => {
    const patch = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,2 +1,2 @@",
      "diff --git a/src/bar.ts b/src/bar.ts",
      "--- a/src/bar.ts",
      "+++ b/src/bar.ts",
    ].join("\n")
    expect(extractFilesFromDiff(patch)).toEqual(["src/foo.ts", "src/bar.ts"])
  })

  test("drops /dev/null endpoints and falls back to diff --git headers", () => {
    const added = ["diff --git a/src/new.ts b/src/new.ts", "--- /dev/null", "+++ b/src/new.ts"].join("\n")
    expect(extractFilesFromDiff(added)).toEqual(["src/new.ts"])
    const modeOnly = "diff --git a/src/mode.sh b/src/mode.sh"
    expect(extractFilesFromDiff(modeOnly)).toEqual(["src/mode.sh"])
    expect(extractFilesFromDiff("")).toEqual([])
  })
})

describe("analyzeImpactImpl", () => {
  let testHost: TestHost

  beforeEach(() => {
    testHost = installTestHost()
  })

  test("drops phantom seeds instead of reporting impact on them", async () => {
    const report = await analyzeImpactImpl("test-project", { changes: [{ kind: "symbol", id: "missing-node" }] })
    expect(report.seeds).toEqual([])
    expect(report.affectedSymbols).toEqual([])
    expect(report.affectedFiles).toEqual([])
    expect(report.riskScore).toBe(0)
    expect(report.riskLabel).toBe("low")
    expect(report.truncated).toBe(false)
    expect(report.explain.heuristicsApplied).toContain("seeds=0")
  })

  test("walks upstream over caller edges and terminates on cycles", async () => {
    // s ← a ← b, plus a cycle a ← d → a (d's caller list points back at a).
    for (const id of ["s", "a", "b", "d"]) testHost.graph.addSymbol({ id, name: `fn_${id}` })
    testHost.graph.addCallerEdge("s", "a")
    testHost.graph.addCallerEdge("a", "b")
    testHost.graph.addCallerEdge("a", "d")
    testHost.graph.addCallerEdge("d", "a")

    const report = await analyzeImpactImpl("test-project", { changes: [{ kind: "symbol", id: "s" }] })
    const affectedIds = report.affectedSymbols.map((s) => s.symbol.id)
    // Each node appears exactly once despite the a ↔ d cycle.
    expect(affectedIds.sort()).toEqual(["a", "b", "d"])
    expect(report.affectedSymbols.find((s) => s.symbol.id === "a")?.distance).toBe(1)
    expect(report.affectedSymbols.find((s) => s.symbol.id === "b")?.distance).toBe(2)
    // Paths are seed-first shortest chains back to the seed.
    expect(report.affectedSymbols.find((s) => s.symbol.id === "b")?.path).toEqual(["s", "a", "b"])
    expect(report.truncated).toBe(false)
  })

  test("caps traversal at the requested depth without marking truncation", async () => {
    for (const id of ["s", "a", "b", "c"]) testHost.graph.addSymbol({ id, name: `fn_${id}` })
    testHost.graph.addCallerEdge("s", "a")
    testHost.graph.addCallerEdge("a", "b")
    testHost.graph.addCallerEdge("b", "c")

    const report = await analyzeImpactImpl("test-project", {
      changes: [{ kind: "symbol", id: "s" }],
      depth: 1,
    })
    expect(report.affectedSymbols.map((s) => s.symbol.id)).toEqual(["a"])
    // Depth caps are NOT truncation in the current contract — only the
    // visit budget flips that flag.
    expect(report.truncated).toBe(false)
    expect(report.explain.heuristicsApplied).toContain("depth=1")
  })

  test("exhausting the visit budget marks truncation and forces high risk", async () => {
    testHost.graph.addSymbol({ id: "s", name: "fn_s" })
    for (let i = 0; i < 15; i++) {
      testHost.graph.addSymbol({ id: `caller-${i}`, name: `caller_${i}` })
      testHost.graph.addCallerEdge("s", `caller-${i}`)
    }

    const report = await analyzeImpactImpl("test-project", {
      changes: [{ kind: "symbol", id: "s" }],
      maxVisited: 10,
    })
    // The seed itself counts toward the budget: 1 seed + 9 callers = 10.
    expect(report.truncated).toBe(true)
    expect(report.riskLabel).toBe("high")
    expect(report.riskScore).toBe(100)
    expect(report.explain.heuristicsApplied).toContain("budget-exhausted")
  })

  test("resolves file and diff seeds through symbolsInFile", async () => {
    testHost.env.worktreeRoot = "/repo"
    testHost.graph.addSymbol({ id: "s", name: "fn_s", file: "/repo/src/foo.ts" })
    testHost.graph.addSymbol({ id: "a", name: "fn_a", file: "/repo/src/caller.ts" })
    testHost.graph.addCallerEdge("s", "a")

    const byFile = await analyzeImpactImpl("test-project", { changes: [{ kind: "file", path: "/repo/src/foo.ts" }] })
    expect(byFile.seeds).toEqual(["s"])
    expect(byFile.affectedSymbols.map((s) => s.symbol.id)).toEqual(["a"])

    // Diff seeds: relative patch paths are resolved against the worktree root.
    const patch = ["diff --git a/src/foo.ts b/src/foo.ts", "--- a/src/foo.ts", "+++ b/src/foo.ts"].join("\n")
    const byDiff = await analyzeImpactImpl("test-project", { changes: [{ kind: "diff", patch }] })
    expect(byDiff.seeds).toEqual(["s"])
    expect(byDiff.affectedSymbols.map((s) => s.symbol.id)).toEqual(["a"])
  })

  test("scores risk deterministically from blast radius and public exposure", async () => {
    // One private caller in one file → low.
    testHost.graph.addSymbol({ id: "s", name: "fn_s", file: "/repo/src/a.ts" })
    testHost.graph.addSymbol({ id: "priv", name: "fn_priv", file: "/repo/src/a.ts", visibility: "private" })
    testHost.graph.addCallerEdge("s", "priv")

    const low = await analyzeImpactImpl("test-project", { changes: [{ kind: "symbol", id: "s" }] })
    // 1 symbol (5) + 1 file (3) + 0 public boundaries = 8.
    expect(low.riskScore).toBe(8)
    expect(low.riskLabel).toBe("low")
    expect(low.apiBoundariesHit).toBe(0)

    // Four public callers across two files → medium. (Undefined visibility
    // is treated as potentially public.)
    for (let i = 0; i < 4; i++) {
      testHost.graph.addSymbol({ id: `pub-${i}`, name: `fn_pub_${i}`, file: `/repo/src/pub-${i % 2}.ts` })
      testHost.graph.addCallerEdge("priv", `pub-${i}`)
    }
    const medium = await analyzeImpactImpl("test-project", { changes: [{ kind: "symbol", id: "priv" }] })
    // 4 symbols (20) + 2 files (6) + 4 boundaries (capped 30) = 56.
    expect(medium.riskScore).toBe(56)
    expect(medium.riskLabel).toBe("medium")
    expect(medium.apiBoundariesHit).toBe(4)
  })
})
