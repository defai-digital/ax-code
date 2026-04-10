import { CodeIntelligence } from "../code-intelligence"
import { CodeNodeID } from "../code-intelligence/id"
import { Instance } from "../project/instance"
import type { ProjectID } from "../project/schema"
import { DebugEngine } from "./index"
import path from "path"

// analyzeImpact — BFS over the v3 call/reference edges to compute the
// transitive blast radius of a proposed change.
//
// ADR-008: bounded BFS with two limits — depth cap and visit budget.
// When either trips we mark the result `truncated: true` and force the
// risk label to "high". We do NOT reuse the v3 `completeness` enum for
// this — completeness means "how well did LSP index this file", not
// "did we run out of budget during traversal".
//
// Seeds can be specified as symbols, files, or raw diff hunks. File and
// diff seeds resolve through CodeIntelligence.symbolsInFile so every
// walked node is guaranteed to exist in the graph.

export type ImpactChange =
  | { kind: "symbol"; id: CodeNodeID }
  | { kind: "file"; path: string }
  | { kind: "diff"; patch: string }

export type AnalyzeImpactInput = {
  changes: ImpactChange[]
  depth?: number
  scope?: "worktree" | "none"
  // Overrides for the BFS visit budget. Defaults come from ADR-008.
  maxVisited?: number
}

const DEFAULT_DEPTH = 3
const MAX_DEPTH = 6
const DEFAULT_VISIT_BUDGET = 2000
const MAX_VISIT_BUDGET = 10000

// Parse a unified-diff patch to extract the set of files it touches.
// We only care about file names here — individual hunks aren't needed
// because we walk by symbol-in-file, not by line range. Accepts both
// `--- a/path / +++ b/path` and `diff --git` headers.
export function extractFilesFromDiff(patch: string): string[] {
  const files = new Set<string>()
  const lines = patch.split("\n")
  for (const raw of lines) {
    const plusMatch = raw.match(/^\+\+\+\s+(.+)$/)
    if (plusMatch) {
      const file = normalizePatchFile(plusMatch[1])
      if (file) files.add(file)
      continue
    }
    const minusMatch = raw.match(/^---\s+(.+)$/)
    if (minusMatch) {
      const file = normalizePatchFile(minusMatch[1])
      if (file) files.add(file)
      continue
    }
    // Fallback for `diff --git a/x b/x` when the file is identical
    // in both sides of the hunk (rename, mode change).
    const gitMatch = raw.match(/^diff --git\s+(\S+)\s+(\S+)/)
    if (gitMatch) {
      const file = normalizePatchFile(gitMatch[2])
      if (file) files.add(file)
    }
  }
  return [...files]
}

function normalizePatchFile(raw: string): string {
  const file = raw.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "")
  if (!file || file === "/dev/null") return ""
  if (file.startsWith("a/") || file.startsWith("b/")) return file.slice(2)
  return file
}

function fileCandidates(file: string): string[] {
  const candidates = new Set<string>([file])
  if (!path.isAbsolute(file)) {
    candidates.add(path.join(Instance.worktree, file))
  }
  return [...candidates]
}

// Resolve a list of changes into a seed set of symbol IDs. Non-resolvable
// targets are dropped (the cite-or-drop principle applies here too —
// DRE never reports impact on phantom symbols).
function resolveSeeds(
  projectID: ProjectID,
  changes: ImpactChange[],
  scope: "worktree" | "none",
  ciExplains: CodeIntelligence.Explain[],
): { seeds: CodeNodeID[]; seedSymbols: Map<string, CodeIntelligence.Symbol> } {
  const seeds: CodeNodeID[] = []
  const seedSymbols = new Map<string, CodeIntelligence.Symbol>()

  for (const change of changes) {
    if (change.kind === "symbol") {
      const sym = CodeIntelligence.getSymbol(projectID, change.id, { scope })
      if (sym) {
        seeds.push(sym.id)
        seedSymbols.set(sym.id, sym)
        ciExplains.push(sym.explain)
      }
      continue
    }
    if (change.kind === "file") {
      const symbols = CodeIntelligence.symbolsInFile(projectID, change.path, { scope })
      for (const sym of symbols) {
        seeds.push(sym.id)
        seedSymbols.set(sym.id, sym)
        ciExplains.push(sym.explain)
      }
      continue
    }
    if (change.kind === "diff") {
      const files = extractFilesFromDiff(change.patch)
      for (const file of files) {
        const candidates = fileCandidates(file)
        for (const candidate of candidates) {
          const symbols = CodeIntelligence.symbolsInFile(projectID, candidate, { scope })
          if (symbols.length === 0) continue
          for (const sym of symbols) {
            seeds.push(sym.id)
            seedSymbols.set(sym.id, sym)
            ciExplains.push(sym.explain)
          }
          break
        }
      }
      continue
    }
  }

  return { seeds, seedSymbols }
}

// BFS traversal over reverse edges (callers + references-to). We walk
// upstream — "who depends on this" — because that's what impact means.
// Walking downstream (callees) would answer "what does this call",
// which is a different question.
//
// Each visited node records its shortest-path parent so we can
// reconstruct the chain from any affected symbol back to the nearest
// seed. Parent tracking uses the first arrival per node (BFS guarantees
// this is the shortest path).
function bfsUpstream(
  projectID: ProjectID,
  seeds: CodeNodeID[],
  depth: number,
  budget: number,
  scope: "worktree" | "none",
  ciExplains: CodeIntelligence.Explain[],
): {
  visited: Map<string, { symbol: CodeIntelligence.Symbol; distance: number; parent: string | null }>
  truncated: boolean
} {
  const visited = new Map<
    string,
    { symbol: CodeIntelligence.Symbol; distance: number; parent: string | null }
  >()
  // Seeds live at distance 0. They count toward the budget.
  const queue: { id: CodeNodeID; distance: number }[] = []
  for (const seed of seeds) {
    const sym = CodeIntelligence.getSymbol(projectID, seed, { scope })
    if (!sym) continue
    if (visited.has(sym.id)) continue
    visited.set(sym.id, { symbol: sym, distance: 0, parent: null })
    ciExplains.push(sym.explain)
    queue.push({ id: sym.id, distance: 0 })
    if (visited.size >= budget) return { visited, truncated: true }
  }

  let truncated = false
  while (queue.length > 0) {
    const { id, distance } = queue.shift()!
    if (distance >= depth) continue

    const callers = CodeIntelligence.findCallers(projectID, id, { scope })
    // Note: findReferences returns Reference objects (source locations),
    // not resolved symbols — they can't feed into the BFS visited set.
    // When import edges land (Phase 2), use findDependents here instead.

    for (const caller of callers) {
      const nextSym = caller.symbol
      if (visited.has(nextSym.id)) continue
      visited.set(nextSym.id, { symbol: nextSym, distance: distance + 1, parent: id })
      ciExplains.push(nextSym.explain)
      if (visited.size >= budget) {
        truncated = true
        return { visited, truncated }
      }
      queue.push({ id: nextSym.id, distance: distance + 1 })
    }
  }

  return { visited, truncated }
}

// Reconstruct shortest path from an affected symbol back to its nearest
// seed, following the parent pointers we stored during BFS. Returns the
// path as a list of CodeNodeIDs, seed-first.
function shortestPathToSeed(
  nodeId: string,
  visited: Map<string, { symbol: CodeIntelligence.Symbol; distance: number; parent: string | null }>,
): CodeNodeID[] {
  const chain: CodeNodeID[] = []
  let cursor: string | null = nodeId
  while (cursor) {
    chain.push(CodeNodeID.make(cursor))
    const entry = visited.get(cursor)
    if (!entry) break
    cursor = entry.parent
  }
  return chain.reverse()
}

// Risk classification is deterministic given a fixed graph + budget.
// The scoring weights are chosen so that truncated results jump straight
// to "high" — ADR-008 invariant — without needing a special branch.
function computeRisk(params: {
  affectedSymbols: number
  affectedFiles: number
  apiBoundariesHit: number
  truncated: boolean
  maxDistance: number
}): { score: number; label: DebugEngine.ImpactReport["riskLabel"] } {
  if (params.truncated) return { score: 100, label: "high" }

  // Base score: 5 per affected symbol, 3 per affected file, 15 per
  // public API boundary crossed, up to 100.
  let score =
    Math.min(60, params.affectedSymbols * 5) +
    Math.min(30, params.affectedFiles * 3) +
    Math.min(30, params.apiBoundariesHit * 15)
  // Deep chains are riskier — a change that reaches distance 3 is more
  // likely to introduce surprise than a change confined to direct callers.
  if (params.maxDistance >= 3) score += 10
  score = Math.min(100, score)

  const label: DebugEngine.ImpactReport["riskLabel"] =
    score >= 60 ? "high" : score >= 30 ? "medium" : "low"
  return { score, label }
}

function isPublicSymbol(sym: CodeIntelligence.Symbol): boolean {
  // Visibility may be undefined when the language doesn't express it or
  // LSP didn't report it. Treat undefined as "potentially public" to
  // err on the side of caution — public-exposure risk is only inflated,
  // not hidden.
  return sym.visibility === "public" || sym.visibility === undefined || sym.visibility === null
}

export async function analyzeImpactImpl(
  projectID: ProjectID,
  input: AnalyzeImpactInput,
): Promise<DebugEngine.ImpactReport> {
  const scope: "worktree" | "none" = input.scope ?? "worktree"
  const depth = Math.min(Math.max(1, input.depth ?? DEFAULT_DEPTH), MAX_DEPTH)
  const budget = Math.min(Math.max(10, input.maxVisited ?? DEFAULT_VISIT_BUDGET), MAX_VISIT_BUDGET)
  const heuristics: string[] = [`depth=${depth}`, `budget=${budget}`]
  const ciExplains: CodeIntelligence.Explain[] = []

  const { seeds } = resolveSeeds(projectID, input.changes, scope, ciExplains)
  heuristics.push(`seeds=${seeds.length}`)

  const { visited, truncated } = bfsUpstream(projectID, seeds, depth, budget, scope, ciExplains)
  if (truncated) heuristics.push("budget-exhausted")

  // Build the affected set, excluding seeds themselves (distance 0 is
  // the seed, not an affected dependent).
  const affectedSymbols: DebugEngine.ImpactAffectedSymbol[] = []
  const affectedFiles = new Set<string>()
  let maxDistance = 0
  let apiBoundariesHit = 0

  for (const [id, entry] of visited) {
    if (entry.distance === 0) continue
    affectedSymbols.push({
      symbol: entry.symbol,
      distance: entry.distance,
      path: shortestPathToSeed(id, visited),
    })
    affectedFiles.add(entry.symbol.file)
    if (entry.distance > maxDistance) maxDistance = entry.distance
    if (isPublicSymbol(entry.symbol)) apiBoundariesHit++
  }

  // Sort by distance asc, then qualified name, for deterministic output.
  affectedSymbols.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance
    return a.symbol.qualifiedName.localeCompare(b.symbol.qualifiedName)
  })

  const { score, label } = computeRisk({
    affectedSymbols: affectedSymbols.length,
    affectedFiles: affectedFiles.size,
    apiBoundariesHit,
    truncated,
    maxDistance,
  })

  return {
    seeds: seeds,
    affectedSymbols,
    affectedFiles: [...affectedFiles].sort(),
    apiBoundariesHit,
    riskScore: score,
    riskLabel: label,
    truncated,
    explain: DebugEngine.buildExplain("analyze-impact", ciExplains, heuristics),
  }
}
