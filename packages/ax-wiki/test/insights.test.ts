import { expect, test } from "vitest"
import { analyzeWikiCodingInsights, type WikiInsightSource } from "../src/insights.js"
import { renderAxWikiProtocol } from "../src/protocol.js"

const digest = "a".repeat(64)
const source = (path: string, imports: string[] = []): WikiInsightSource => ({
  path,
  imports,
  status: "analyzed",
  hash: digest,
  hashScope: "file",
  omittedImports: 0,
  unresolvedImports: 0,
})

test("insights separate directional file evidence from task-scoped checks and absent measurements", () => {
  const result = analyzeWikiCodingInsights({
    targets: ["a.ts"],
    sources: [source("a.ts", ["b.ts", "b.ts"]), source("b.ts"), source("test.ts", ["a.ts"])],
    pages: [],
  })
  expect(result.targets[0].dependencies).toEqual({ count: 1, files: ["b.ts"], omitted: 0 })
  expect(result.targets[0].dependents).toEqual({ count: 1, files: ["test.ts"], omitted: 0 })
  expect(result.targets[0].checks.map((check) => check.kind)).toEqual([
    "inspect-dependents",
    "inspect-dependencies",
    "verify-coverage",
  ])
  expect(result.unavailable).toContain("runtime-hot-paths")
  expect(result.completeness).toBe("partial")
})

test("cycle evidence is a contiguous file walk, not a directory-level aggregation", () => {
  const sources = [
    source("a/one.ts", ["b/one.ts"]),
    source("b/one.ts"),
    source("b/two.ts", ["a/two.ts"]),
    source("a/two.ts"),
  ]
  expect(analyzeWikiCodingInsights({ targets: ["a/one.ts"], sources, pages: [] }).targets[0].cycle).toBeUndefined()
  sources[1].imports = ["a/one.ts"]
  const cycle = analyzeWikiCodingInsights({ targets: ["a/one.ts"], sources, pages: [] }).targets[0]
  expect(cycle.cycle).toEqual(["a/one.ts", "b/one.ts", "a/one.ts"])
  expect(cycle.checks.some((check) => check.kind === "verify-cycle")).toBe(true)
})

test("long witnesses are omitted whole; neighbor totals conserve omissions", () => {
  const sources = Array.from({ length: 15 }, (_, index) => source(`${index}.ts`, [`${(index + 1) % 15}.ts`]))
  const result = analyzeWikiCodingInsights({ targets: ["0.ts"], sources, pages: [], neighborLimit: 0 })
  expect(result.targets[0].cycle).toBeUndefined()
  expect(result.targets[0].cycleOmitted).toBe(true)
  expect(result.targets[0].dependencies).toEqual({ count: 1, files: [], omitted: 1 })
  expect(result.targets[0].checks.some((check) => check.kind === "verify-cycle")).toBe(false)
})

test("target freshness never certifies an unread page or prefix and flags an edited full file", () => {
  const pages = [{ path: "module.md", sources: ["a.ts", "b.ts"], sourceHashes: { "a.ts": digest } }]
  const a = source("a.ts")
  const query = () => analyzeWikiCodingInsights({ targets: ["a.ts"], sources: [a], pages }).targets[0]
  expect(query().relatedPages[0].targetFreshness).toBe("fresh")
  a.hash = "b".repeat(64)
  expect(query().relatedPages[0].targetFreshness).toBe("stale")
  a.hashScope = "prefix"
  expect(query().relatedPages[0].targetFreshness).toBe("unknown")
})

test("failed source imports do not become facts and results are stable under source ordering", () => {
  const bad = { ...source("b.ts", ["a.ts"]), status: "failed" as const }
  const sources = [source("a.ts", ["b.ts", "missing.ts"]), bad]
  const query = (sources: WikiInsightSource[]) => analyzeWikiCodingInsights({ targets: ["a.ts"], sources, pages: [] })
  expect(query(sources)).toEqual(query([...sources].reverse()))
  expect(query(sources).targets[0].cycle).toBeUndefined()
  expect(query(sources).coverage.analyzedSources).toBe(1)
})

test("Wiki protocol advertises targeted insight lookup without loading analytics into the prompt", () => {
  const protocol = renderAxWikiProtocol({ exists: true, freshness: "unknown" })!
  expect(protocol).toContain("repo_wiki insights")
  expect(protocol).toContain("verify source and rerun after edits")
  expect(protocol).toContain("navigation only")
  expect(protocol.length).toBeLessThan(2_500)
})
