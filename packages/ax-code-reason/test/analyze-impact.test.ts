import path from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"
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

  test("takes the host's one-call walk when present and reports the same impact as the loop", async () => {
    // s <- a <- b, a <- d (cycle d <-> a), s <- x <- y, plus eight more direct
    // callers c1..c8 of s; the loop visits a, x, c1..c8, b, d, y.
    const extra = Array.from({ length: 8 }, (_, i) => `c${i + 1}`)
    for (const id of ["s", "a", "b", "d", "x", "y", ...extra]) {
      testHost.graph.addSymbol({ id, name: `fn_${id}`, file: `/repo/${id}.ts` })
    }
    testHost.graph.addCallerEdge("s", "a")
    testHost.graph.addCallerEdge("s", "x")
    for (const id of extra) testHost.graph.addCallerEdge("s", id)
    testHost.graph.addCallerEdge("a", "b")
    testHost.graph.addCallerEdge("a", "d")
    testHost.graph.addCallerEdge("d", "a")
    testHost.graph.addCallerEdge("x", "y")
    // The budget floor is 10: the seed plus nine callers, truncated mid-level.
    const input = { changes: [{ kind: "symbol" as const, id: "s" }], maxVisited: 10 }
    const summarize = (report: Awaited<ReturnType<typeof analyzeImpactImpl>>) => ({
      seeds: report.seeds,
      affected: report.affectedSymbols.map((s) => [s.symbol.id, s.distance, s.path]),
      files: report.affectedFiles,
      truncated: report.truncated,
      risk: [report.riskScore, report.riskLabel],
      heuristics: report.explain.heuristicsApplied,
    })
    const loop = summarize(await analyzeImpactImpl("test-project", input))

    const port = testHost.graph.port
    const findCallers = port.findCallers.bind(port)
    // A faithful walk over the same fake edges, as the native index provides it.
    const walkCallers = vi.fn(async (projectID: string, seeds: string[], opts: { depth: number; budget: number }) => {
      const visited = new Set(seeds)
      const queue = seeds.map((id) => ({ id, distance: 0 }))
      const nodes: Array<{
        symbol: (typeof queue)[number] extends never ? never : any
        distance: number
        parent: string
      }> = []
      let truncated = false
      let head = 0
      walk: while (head < queue.length) {
        const { id, distance } = queue[head++]
        if (distance >= opts.depth) continue
        for (const caller of findCallers(projectID, id)) {
          if (visited.has(caller.symbol.id)) continue
          visited.add(caller.symbol.id)
          nodes.push({ symbol: caller.symbol, distance: distance + 1, parent: id })
          if (visited.size >= opts.budget) {
            truncated = true
            break walk
          }
          queue.push({ id: caller.symbol.id, distance: distance + 1 })
        }
      }
      return { nodes, truncated }
    })
    port.walkCallersAsync = walkCallers
    const loopCalls = vi.spyOn(port, "findCallers")
    const walked = summarize(await analyzeImpactImpl("test-project", input))
    expect(walkCallers).toHaveBeenCalledTimes(1)
    expect(walkCallers.mock.calls[0][1]).toEqual(["s"])
    expect(walkCallers.mock.calls[0][2]).toMatchObject({ budget: 10, scope: "worktree" })
    expect(loopCalls).not.toHaveBeenCalled()
    expect(walked).toEqual(loop)
    expect(walked.truncated).toBe(true)
    // The report orders affected symbols itself; compare the visited set.
    expect(walked.affected.map((entry) => entry[0]).sort()).toEqual(["a", "x", ...extra.slice(0, 7)].sort())

    // Without the budget bite the walk and the loop still agree on the whole graph.
    const wide = { ...input, maxVisited: 100 }
    port.walkCallersAsync = undefined
    const wideLoop = summarize(await analyzeImpactImpl("test-project", wide))
    port.walkCallersAsync = walkCallers
    const wideWalk = summarize(await analyzeImpactImpl("test-project", wide))
    expect(wideWalk).toEqual(wideLoop)
    expect(wideWalk.affected.map((entry) => entry[0]).sort()).toEqual(["a", "x", ...extra, "b", "d", "y"].sort())
    expect(wideWalk.truncated).toBe(false)

    // A host that offers the walk but cannot serve it hands the loop back.
    port.walkCallersAsync = vi.fn(async () => undefined)
    expect(summarize(await analyzeImpactImpl("test-project", input))).toEqual(loop)
    expect(loopCalls).toHaveBeenCalled()
  })

  test("pre-abort, native errors and running cancellation never become fallback success", async () => {
    testHost.graph.addSymbol({ id: "s" })
    const port = testHost.graph.port
    const fallback = vi.spyOn(port, "findCallers")
    const syncWalk = vi.fn(() => {
      throw new Error("sync walk must not run")
    })
    port.walkCallers = syncWalk
    const input = { changes: [{ kind: "symbol" as const, id: "s" }] }
    const controller = new AbortController()
    const failure = new Error("cancelled by caller")
    controller.abort(failure)
    await expect(analyzeImpactImpl("test-project", input, controller.signal)).rejects.toBe(failure)
    port.walkCallersAsync = vi.fn(async () => {
      throw new Error("native failure")
    })
    await expect(analyzeImpactImpl("test-project", input)).rejects.toThrow("native failure")
    const running = new AbortController()
    port.walkCallersAsync = vi.fn(async (_p, _s, _o, signal) => {
      expect(signal).toBe(running.signal)
      running.abort(failure)
      return { nodes: [], truncated: false }
    })
    await expect(analyzeImpactImpl("test-project", input, running.signal)).rejects.toBe(failure)
    expect(fallback).not.toHaveBeenCalled()
    expect(syncWalk).not.toHaveBeenCalled()
  })

  test("missing async capability yields to cancellation instead of invoking the sync walk", async () => {
    testHost.graph.addSymbol({ id: "s" })
    testHost.graph.port.walkCallers = vi.fn(() => {
      throw new Error("legacy whole walk")
    })
    const fallback = vi.spyOn(testHost.graph.port, "findCallers")
    const controller = new AbortController()
    const failure = new Error("fallback cancelled")
    setImmediate(() => controller.abort(failure))
    await expect(
      analyzeImpactImpl("test-project", { changes: [{ kind: "symbol", id: "s" }] }, controller.signal),
    ).rejects.toBe(failure)
    expect(fallback).not.toHaveBeenCalled()
    expect(testHost.graph.port.walkCallers).not.toHaveBeenCalled()
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
