import { createHash } from "crypto"
import { CodeIntelligence } from "../code-intelligence"
import type { CodeNodeKind } from "../code-intelligence/schema.sql"
import type { ProjectID } from "../project/schema"
import { DebugEngine } from "./index"
import { isTestFile } from "./scanner-utils"

// detectDuplicates — AST-signature bucketing with a Jaccard-similarity
// fallback for near-matches.
//
// Phase 1 uses the v3 graph's existing `signature` column as the sole
// source of signal. A proper tree-sitter AST walk is deferred to Phase 2
// (ADR-009 pipeline step 1 "normalized AST signature hash"); using the
// LSP-reported signature today is enough for the grade-1 (exact) and
// grade-2 (structural after normalization) tiers that make up ~80% of
// real-world duplicates. Grade-3 (semantic) detection via embeddings is
// deferred alongside the AST walk — the cache table (ADR-004) is ready
// for it but nothing in Phase 1 populates it.
//
// The similarity fallback uses normalized-token Jaccard, not embeddings.
// This is deterministic, dependency-free, and sufficient for detecting
// near-duplicate helpers with trivial renames. When Phase 2 adds
// embeddings, this path becomes the cheap pre-filter ahead of the
// embedding step.

export type DetectDuplicatesInput = {
  scope?: "worktree" | "none"
  kinds?: CodeNodeKind[]
  minSignatureLength?: number
  similarityThreshold?: number
  excludeTests?: boolean
  // Hard cap on the candidate set to keep scan time bounded. Nodes
  // beyond this cap are not inspected and the output is marked
  // `truncated: true`.
  maxCandidates?: number
}

const DEFAULT_KINDS: CodeNodeKind[] = ["function", "method"]
const DEFAULT_MIN_SIG_LEN = 20
const DEFAULT_SIMILARITY = 0.85
const DEFAULT_MAX_CANDIDATES = 2000

// Strip whitespace, parameter names, and trivial literals from a
// signature string to produce a canonical form suitable for exact
// equality bucketing. Keeps the structure (keywords, punctuation, type
// names) and discards anything a refactor would rename.
export function normalizeSignature(sig: string): string {
  return (
    sig
      // Collapse whitespace
      .replace(/\s+/g, " ")
      // Drop parameter names within parenthesized parameter lists:
      // match `(name: Type)` → `(Type)`. Scoped to parens so that
      // object property keys like `{ foo: bar }` are preserved.
      .replace(/\(([^)]*)\)/g, (_, params) =>
        "(" + params.replace(/\b([a-zA-Z_$][\w$]*)\s*:/g, ":") + ")"
      )
      // Drop default values within parameter lists: `= 0`, `= "foo"`
      .replace(/\(([^)]*)\)/g, (_, params) =>
        "(" + params.replace(/=\s*[^,)]+/g, "") + ")"
      )
      // Bucket number literals
      .replace(/\b\d+(\.\d+)?\b/g, "N")
      // Bucket string literals
      .replace(/"[^"]*"/g, "S")
      .replace(/'[^']*'/g, "S")
      .trim()
  )
}

function hashNormalized(sig: string): string {
  return createHash("sha256").update(sig).digest("hex").slice(0, 16)
}

// Tokenize for Jaccard similarity: break on non-identifier boundaries,
// lowercase, drop 1-char tokens. Operates on the normalized signature
// so parameter names are already gone.
function tokenize(sig: string): Set<string> {
  const tokens = sig.toLowerCase().split(/[^a-z0-9_]+/)
  return new Set(tokens.filter((t) => t.length > 1))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

// Longest common prefix over a list of absolute file paths. Used to
// suggest an extraction target that "sits above" every cluster member.
function commonDirectory(files: string[]): string {
  if (files.length === 0) return ""
  if (files.length === 1) {
    const idx = files[0].lastIndexOf("/")
    return idx >= 0 ? files[0].slice(0, idx) : ""
  }
  const split = files.map((f) => f.split("/"))
  const minLen = Math.min(...split.map((s) => s.length))
  const common: string[] = []
  for (let i = 0; i < minLen; i++) {
    const seg = split[0][i]
    if (split.every((s) => s[i] === seg)) common.push(seg)
    else break
  }
  return common.join("/")
}

function computeSharedLines(members: CodeIntelligence.Symbol[]): number {
  // Sum of line spans. For a cluster of N members each spanning L
  // lines, the "shared" count we report is (N - 1) * L — how many
  // lines could be eliminated by extracting a single shared version.
  if (members.length < 2) return 0
  const lineSpans = members.map((m) => m.range.end.line - m.range.start.line + 1)
  const total = lineSpans.reduce((a, b) => a + b, 0)
  const avg = total / lineSpans.length
  return Math.round(avg * (members.length - 1))
}

export async function detectDuplicatesImpl(
  projectID: ProjectID,
  input: DetectDuplicatesInput,
): Promise<DebugEngine.DuplicateReport> {
  const scope: "worktree" | "none" = input.scope ?? "worktree"
  const kinds = input.kinds ?? DEFAULT_KINDS
  const minSigLen = input.minSignatureLength ?? DEFAULT_MIN_SIG_LEN
  const threshold = input.similarityThreshold ?? DEFAULT_SIMILARITY
  const excludeTests = input.excludeTests ?? true
  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES
  const heuristics: string[] = [`kinds=${kinds.join(",")}`, `threshold=${threshold.toFixed(2)}`]
  if (excludeTests) heuristics.push("exclude-tests")
  const ciExplains: CodeIntelligence.Explain[] = []

  // Gather candidate symbols across the requested kinds. We call
  // findSymbolByPrefix with an empty prefix per kind — this returns
  // every node in that kind category within scope. (The code graph
  // index covers it via the project+kind composite index.)
  //
  // Note: findSymbolByPrefix uses range comparison `[prefix, prefix+\uFFFF)`
  // so an empty-prefix call is effectively "all names" constrained by
  // kind + limit. We pass a generous limit and rely on the maxCandidates
  // cap below to bound the total pool.
  const pool: CodeIntelligence.Symbol[] = []
  let truncated = false
  for (const kind of kinds) {
    const hits = CodeIntelligence.findSymbolByPrefix(projectID, "", {
      kind,
      limit: maxCandidates,
      scope,
    })
    for (const hit of hits) {
      if (excludeTests && isTestFile(hit.file)) continue
      if (!hit.signature || hit.signature.length < minSigLen) continue
      pool.push(hit)
      ciExplains.push(hit.explain)
      if (pool.length >= maxCandidates) {
        truncated = true
        break
      }
    }
    if (truncated) break
  }

  heuristics.push(`pool-size=${pool.length}`)

  // Step 1: bucket by normalized-signature hash. Each bucket of size ≥2
  // is a structural duplicate cluster. Exact byte-for-byte matches (same
  // signature string) also fall into the same bucket since
  // normalization is idempotent.
  const buckets = new Map<string, { norm: string; members: CodeIntelligence.Symbol[] }>()
  for (const sym of pool) {
    // Skip symbols without a signature (incomplete LSP indexing,
    // minified code). Feeding undefined into normalizeSignature
    // crashes `tokenize(undefined)`. See also the singleton branch
    // below, which has the same guard.
    if (!sym.signature) continue
    const norm = normalizeSignature(sym.signature)
    const hash = hashNormalized(norm)
    const bucket = buckets.get(hash)
    if (bucket) bucket.members.push(sym)
    else buckets.set(hash, { norm, members: [sym] })
  }

  const clusters: DebugEngine.DuplicateCluster[] = []
  const singletons: Array<{ sym: CodeIntelligence.Symbol; norm: string; tokens: Set<string> }> = []

  for (const { norm, members } of buckets.values()) {
    if (members.length >= 2) {
      // Tier classification: all members with byte-identical signature
      // → "exact". Otherwise → "structural" (they matched after
      // normalization of names/literals).
      // Signatures are guaranteed non-null here because the bucket
      // loop above skips members without one, but filter defensively
      // in case upstream changes break that invariant.
      const rawSigs = new Set(members.map((m) => m.signature).filter((s): s is string => !!s))
      const tier: DebugEngine.DuplicateTier = rawSigs.size === 1 ? "exact" : "structural"
      clusters.push({
        id: `cluster_${clusters.length}`,
        members,
        similarityScore: 1,
        sharedLines: computeSharedLines(members),
        suggestedExtractionTarget: commonDirectory(members.map((m) => m.file)),
        pattern: norm.slice(0, 80),
        tier,
      })
    } else if (members.length === 1) {
      // Skip symbols that lack a signature (generated code, minified
      // code, incomplete LSP indexing). The previous `members[0].signature!`
      // assertion crashed `tokenize(undefined)` on the next line.
      const signature = members[0].signature
      if (signature) {
        singletons.push({ sym: members[0], norm, tokens: tokenize(signature) })
      }
    }
  }

  // Step 2: Jaccard near-match on singletons. This is the "semantic"
  // tier's deterministic stand-in for Phase 1. Pure pairwise comparison
  // is O(n²); with the maxCandidates cap this is bounded.
  heuristics.push("jaccard-near-match")
  const paired = new Set<number>()
  for (let i = 0; i < singletons.length; i++) {
    if (paired.has(i)) continue
    const group = [singletons[i].sym]
    const representativeNorm = singletons[i].norm
    let minScore = 1
    for (let j = i + 1; j < singletons.length; j++) {
      if (paired.has(j)) continue
      const score = jaccard(singletons[i].tokens, singletons[j].tokens)
      if (score >= threshold) {
        group.push(singletons[j].sym)
        paired.add(j)
        if (score < minScore) minScore = score
      }
    }
    if (group.length >= 2) {
      paired.add(i)
      clusters.push({
        id: `cluster_${clusters.length}`,
        members: group,
        similarityScore: minScore,
        sharedLines: computeSharedLines(group),
        suggestedExtractionTarget: commonDirectory(group.map((m) => m.file)),
        pattern: representativeNorm.slice(0, 80),
        tier: "semantic",
      })
    }
  }

  // Rank clusters by size × shared-lines × cross-file-spread. A cluster
  // of three copies across three files ranks higher than three copies
  // in one file of the same length, because extracting a shared helper
  // delivers more value when callers live apart.
  clusters.sort((a, b) => {
    const spreadA = new Set(a.members.map((m) => m.file)).size
    const spreadB = new Set(b.members.map((m) => m.file)).size
    const valueA = a.members.length * a.sharedLines * spreadA
    const valueB = b.members.length * b.sharedLines * spreadB
    return valueB - valueA
  })

  const totalDuplicateLines = clusters.reduce((sum, c) => sum + c.sharedLines, 0)

  return {
    clusters,
    totalDuplicateLines,
    truncated,
    explain: DebugEngine.buildExplain("detect-duplicates", ciExplains, heuristics),
  }
}
