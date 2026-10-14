import path from "node:path"
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

  test("does not read a hunk content line as a file header", () => {
    const patch = [
      "diff --git a/src/loop.rs b/src/loop.rs",
      "--- a/src/loop.rs",
      "+++ b/src/loop.rs",
      "@@ -1,3 +1,3 @@",
      " fn main() {}",
      "+++attempt;", // an added line whose text begins with "++" -> diff line "+++attempt;"
      "---cleanup();", // a removed line whose text begins with "--" -> diff line "---cleanup();"
      " context();",
      "diff --git a/src/other.rs b/src/other.rs",
      "--- a/src/other.rs",
      "+++ b/src/other.rs",
    ].join("\n")
    expect(extractFilesFromDiff(patch)).toEqual(["src/loop.rs", "src/other.rs"])
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
    // `fileCandidates` resolves relative diff paths with native path.join, so
    // the fixture root and graph keys must be native too (POSIX stays "/repo").
    const root = path.resolve("/repo")
    const foo = path.join(root, "src", "foo.ts")
    testHost.env.worktreeRoot = root
    testHost.graph.addSymbol({ id: "s", name: "fn_s", file: foo })
    testHost.graph.addSymbol({ id: "a", name: "fn_a", file: path.join(root, "src", "caller.ts") })
    testHost.graph.addCallerEdge("s", "a")

    const byFile = await analyzeImpactImpl("test-project", { changes: [{ kind: "file", path: foo }] })
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

  test("wide fan-out with a bounded budget matches a shift()-dequeue reference BFS", async () => {
    // One seed with >= 2,500 transitive callers across several levels. Each
    // level-L node points back at level-(L-1) so BFS reaches every node, and
    // the caller adjacency order (insertion order) is what fixes visit order.
    const seed = "seed"
    const levels = 6
    const perLevel = 500
    const callerOf: Record<string, string[]> = {}
    type RefEntry = { distance: number; parent: string | null }
    const refVisited = new Map<string, RefEntry>()

    testHost.graph.addSymbol({ id: seed, name: "fn_seed" })
    refVisited.set(seed, { distance: 0, parent: null })
    const queue: { id: string; distance: number }[] = [{ id: seed, distance: 0 }]

    const budget = 2_000
    let prevLevel: string[] = [seed]
    let produced = 1 // the seed counts toward the budget
    for (let level = 1; level <= levels; level++) {
      const thisLevel: string[] = []
      for (let i = 0; i < perLevel; i++) {
        const id = `n${level}_${i}`
        testHost.graph.addSymbol({ id, name: `fn_${id}` })
        const parent = prevLevel[i % prevLevel.length]
        testHost.graph.addCallerEdge(parent, id)
        callerOf[parent] = [...(callerOf[parent] ?? []), id]
        thisLevel.push(id)
        produced++
      }
      prevLevel = thisLevel
    }
    expect(produced).toBeGreaterThanOrEqual(2_500)

    // Inline reference BFS over the same fake graph, using shift()-dequeue.
    let refTruncated = false
    while (queue.length > 0 && !refTruncated) {
      const { id, distance } = queue.shift()!
      if (distance >= levels) continue
      for (const child of callerOf[id] ?? []) {
        if (refVisited.has(child)) continue
        refVisited.set(child, { distance: distance + 1, parent: id })
        if (refVisited.size >= budget) {
          refTruncated = true
          break
        }
        queue.push({ id: child, distance: distance + 1 })
      }
    }

    const report = await analyzeImpactImpl("test-project", {
      changes: [{ kind: "symbol", id: seed }],
      depth: levels,
      maxVisited: budget,
    })
    expect(report.truncated).toBe(true)
    expect(refTruncated).toBe(true)
    // The reference BFS visited exactly `budget` nodes; the engine must too.
    expect(refVisited.size).toBe(budget)
    const affected = report.affectedSymbols
    expect(affected.length).toBe(budget - 1)
    expect(report.affectedSymbols.map((s) => s.symbol.id).sort()).toEqual(
      [...refVisited.keys()].filter((id) => id !== seed).sort(),
    )
    for (const entry of affected) {
      const ref = refVisited.get(entry.symbol.id)!
      expect(ref).toBeDefined()
      expect(entry.distance).toBe(ref.distance)
      // Parent chains must match the reference exactly (seed-first).
      const chain = entry.path
      expect(chain[chain.length - 1]).toBe(entry.symbol.id)
      expect(chain[chain.length - 2] ?? null).toBe(ref.parent)
    }
    expect(report.explain.heuristicsApplied).toContain("budget-exhausted")
  })

  test("diamond graph keeps the first-arrival parent at distance 2", async () => {
    // A <- B, A <- C, B <- D, C <- D. findCallers(A) yields [B, C].
    for (const id of ["a", "b", "c", "d"]) testHost.graph.addSymbol({ id, name: `fn_${id}` })
    testHost.graph.addCallerEdge("a", "b")
    testHost.graph.addCallerEdge("a", "c")
    testHost.graph.addCallerEdge("b", "d")
    testHost.graph.addCallerEdge("c", "d")

    const report = await analyzeImpactImpl("test-project", {
      changes: [{ kind: "symbol", id: "a" }],
      depth: 3,
    })
    const d = report.affectedSymbols.find((s) => s.symbol.id === "d")!
    expect(d.distance).toBe(2)
    // D is reached from B first (B is enqueued before C and both sit at
    // distance 1), so the parent is B and the chain is seed-first.
    expect(d.path).toEqual(["a", "b", "d"])
    expect(report.truncated).toBe(false)
  })
})
