import { compareDuplicateGroups } from "./duplicate-groups"
import { createHash } from "crypto"
import { codeReasonHost, type Graph } from "./host"

import type { ProjectID } from "./id"
import { DebugEngine } from "./index"
import { isTestFile, type ScannerScopeControls } from "./scanner-utils"

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

export type DetectDuplicatesInput = ScannerScopeControls & {
  kinds?: Graph.NodeKind[]
  minSignatureLength?: number
  similarityThreshold?: number
  // Hard cap on the candidate set to keep scan time bounded. Nodes
  // beyond this cap are not inspected and the output is marked
  // `truncated: true`.
  maxCandidates?: number
}

const DEFAULT_KINDS: Graph.NodeKind[] = ["function", "method"]
const DEFAULT_MIN_SIG_LEN = 20
const DEFAULT_SIMILARITY = 0.85
const DEFAULT_MAX_CANDIDATES = 2000

// Additive (Phase 4-prep, U4): the audit-scope label every cluster and
// report carries. A clean heuristic run is not a full duplicate audit —
// no AST walk, no cross-file embedding similarity yet.
const DETECT_DUPLICATES_AUDIT_CAVEAT =
  "Heuristic scan: a clean result does not constitute a full duplicate audit. " +
  "Phase 2 adds tree-sitter AST walks and embedding-based near-match detection; " +
  "pair with a parser-backed pass before relying on a clean result for refactor safety."

// Build the ruleId for a cluster. Tier is the only pattern discriminator
// the duplicates scanner exposes (exact / structural / semantic).
function duplicatesRuleId(tier: DebugEngine.DuplicateTier): string {
  return `axcode:detect-duplicates-${tier}`
}

type DuplicateCandidatePool = {
  pool: Graph.Symbol[]
  ciExplains: Graph.Explain[]
  truncated: boolean
}

// Strip whitespace, parameter names, and trivial literals from a
// signature string to produce a canonical form suitable for exact
// equality bucketing. Keeps the structure (keywords, punctuation, type
// names) and discards anything a refactor would rename.
function collapseWhitespace(input: string): string {
  let out = ""
  let inWs = false
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    const ws = ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 12
    if (ws) {
      if (!inWs && out.length > 0) {
        out += " "
        inWs = true
      }
      continue
    }
    inWs = false
    out += input[i]
  }
  return inWs ? out.slice(0, -1) : out
}

function mapParenGroups(input: string, rewrite: (inner: string) => string): string {
  let out = ""
  let i = 0
  while (i < input.length) {
    if (input[i] !== "(") {
      out += input[i]
      i++
      continue
    }
    let depth = 1
    let j = i + 1
    while (j < input.length && depth > 0) {
      if (input[j] === "(") depth++
      else if (input[j] === ")") depth--
      j++
    }
    out += `(${rewrite(input.slice(i + 1, j - 1))})`
    i = j
  }
  return out
}

function dropParamNames(inner: string): string {
  let out = ""
  let i = 0
  while (i < inner.length) {
    const ch = inner[i]!
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1
      while (j < inner.length && /[\w$]/.test(inner[j]!)) j++
      let k = j
      while (k < inner.length && (inner[k] === " " || inner[k] === "\t")) k++
      if (inner[k] === ":") {
        out += ":"
        i = k + 1
        continue
      }
      // A run without a colon is copied unchanged. Re-scanning its suffix
      // at every character made long identifiers quadratic.
      out += inner.slice(i, j)
      i = j
      continue
    }
    out += ch
    i++
  }
  return out
}

function dropDefaults(inner: string): string {
  let out = ""
  let i = 0
  while (i < inner.length) {
    if (inner[i] === "=") {
      i++
      while (i < inner.length && inner[i] !== "," && inner[i] !== ")") i++
      continue
    }
    out += inner[i]
    i++
  }
  return out
}

export function normalizeSignature(sig: string): string {
  let s = collapseWhitespace(sig)
  s = mapParenGroups(s, dropParamNames)
  s = mapParenGroups(s, dropDefaults)
  s = s.replace(/\b\d+(\.\d+)?\b/g, "N")
  s = s.replace(/"[^"]*"/g, "S")
  s = s.replace(/'[^']*'/g, "S")
  return s.trim()
}

function hashNormalized(sig: string): string {
  return createHash("sha256").update(sig).digest("hex").slice(0, 16)
}

// Tokenize for Jaccard similarity: break on non-identifier boundaries,
// lowercase, drop 1-char tokens. Preserve raw-signature tokenization here;
// normalized signatures are used only for the exact/structural buckets.
function tokenize(sig: string): Set<string> {
  const tokens = sig.toLowerCase().split(/[^a-z0-9_]+/)
  return new Set(tokens.filter((t) => t.length > 1))
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
  // If the common prefix consumed the shortest path's every segment, that
  // last segment is that file's filename (every entry is a file path, not
  // a directory) — drop it so the result is always a directory.
  if (common.length === minLen) common.pop()
  return common.join("/")
}

function computeSharedLines(members: Graph.Symbol[]): number {
  // Sum of line spans. For a cluster of N members each spanning L
  // lines, the "shared" count we report is (N - 1) * L — how many
  // lines could be eliminated by extracting a single shared version.
  if (members.length < 2) return 0
  const lineSpans = members.map((m) => m.range.end.line - m.range.start.line + 1)
  const total = lineSpans.reduce((a, b) => a + b, 0)
  const avg = total / lineSpans.length
  return Math.round(avg * (members.length - 1))
}

function collectDuplicateCandidatePool(
  projectID: ProjectID,
  input: {
    scope: "worktree" | "none"
    kinds: Graph.NodeKind[]
    maxCandidates: number
    excludeTests: boolean
    minSigLen: number
  },
): DuplicateCandidatePool {
  const pool: Graph.Symbol[] = []
  const ciExplains: Graph.Explain[] = []
  let truncated = false
  let poolSaturated = false

  for (const kind of input.kinds) {
    const hits = codeReasonHost().graph.findSymbolByPrefix(projectID, "", {
      kind,
      limit: input.maxCandidates,
      scope: input.scope,
    })
    // The query cap is applied before the excludeTests / minSigLen filters
    // below, so a saturated result means more nodes exist in this kind than
    // we inspected — even if filtering later trims the admitted pool below
    // the cap. Report the run incomplete rather than as a complete scan.
    if (hits.length >= input.maxCandidates) truncated = true
    for (const hit of hits) {
      if (input.excludeTests && isTestFile(hit.file)) continue
      if (!hit.signature || hit.signature.length < input.minSigLen) continue
      // The comparison yields to workers. Keep the admitted graph facts stable
      // even when an embedding host reuses mutable symbol objects.
      const snapshot = {
        ...hit,
        range: { start: { ...hit.range.start }, end: { ...hit.range.end } },
        explain: { ...hit.explain },
      }
      pool.push(snapshot)
      ciExplains.push(snapshot.explain)
      if (pool.length >= input.maxCandidates) {
        truncated = true
        poolSaturated = true
        break
      }
    }
    if (poolSaturated) break
  }

  return { pool, ciExplains, truncated }
}

export async function detectDuplicatesImpl(
  projectID: ProjectID,
  input: DetectDuplicatesInput,
  signal = codeReasonHost().abort(),
): Promise<DebugEngine.DuplicateReport> {
  signal.throwIfAborted()
  const scope: "worktree" | "none" = input.scope ?? "worktree"
  const kinds = input.kinds ?? DEFAULT_KINDS
  const minSigLen = input.minSignatureLength ?? DEFAULT_MIN_SIG_LEN
  const threshold = input.similarityThreshold ?? DEFAULT_SIMILARITY
  const excludeTests = input.excludeTests ?? true
  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES
  const heuristics: string[] = [`kinds=${kinds.join(",")}`, `threshold=${threshold.toFixed(2)}`]
  if (excludeTests) heuristics.push("exclude-tests")
  const ciExplains: Graph.Explain[] = []

  // Gather candidate symbols across the requested kinds. We call
  // findSymbolByPrefix with an empty prefix per kind — this returns
  // every node in that kind category within scope. (The code graph
  // index covers it via the project+kind composite index.)
  //
  // Note: findSymbolByPrefix uses range comparison `[prefix, prefix+\uFFFF)`
  // so an empty-prefix call is effectively "all names" constrained by
  // kind + limit. We query up to maxCandidates per kind; a saturated query
  // marks the report truncated (the excludeTests / minSigLen filters run
  // after the cap, so the admitted pool can be smaller than the cap).
  const candidatePool = collectDuplicateCandidatePool(projectID, {
    scope,
    kinds,
    maxCandidates,
    excludeTests,
    minSigLen,
  })
  const { pool, truncated } = candidatePool
  signal.throwIfAborted()
  if (pool.length > 10_000) throw new Error("Duplicate comparison resource limit exceeded; reduce maxCandidates")
  let signatureBytes = 0
  for (const symbol of pool) {
    const bytes = Buffer.byteLength(symbol.signature ?? "")
    signatureBytes += bytes
    if (bytes > 1024 * 1024 || signatureBytes > 16 * 1024 * 1024)
      throw new Error("Duplicate signature resource limit exceeded; reduce maxCandidates")
  }
  ciExplains.push(...candidatePool.ciExplains)

  heuristics.push(`pool-size=${pool.length}`)

  // Step 1: bucket by normalized-signature hash. Each bucket of size ≥2
  // is a structural duplicate cluster. Exact byte-for-byte matches (same
  // signature string) also fall into the same bucket since
  // normalization is idempotent.
  const buckets = new Map<string, { norm: string; members: Graph.Symbol[] }>()
  let preparedUnits = 0
  for (const sym of pool) {
    signal.throwIfAborted()
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
    preparedUnits += sym.signature.length
    if (preparedUnits >= 32_768) {
      await new Promise<void>((resolve) => setImmediate(resolve))
      signal.throwIfAborted()
      preparedUnits = 0
    }
  }

  const clusters: DebugEngine.DuplicateCluster[] = []
  const singletons: Array<{ sym: Graph.Symbol; norm: string; tokens: Set<string> }> = []

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
        ruleId: duplicatesRuleId(tier),
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
  const groups = await compareDuplicateGroups(
    singletons.map((item) => item.tokens),
    threshold,
    signal,
  )
  signal.throwIfAborted()
  for (const { indices, score } of groups) {
    const members = indices.map((index) => singletons[index].sym)
    clusters.push({
      id: `cluster_${clusters.length}`,
      members,
      similarityScore: score,
      sharedLines: computeSharedLines(members),
      suggestedExtractionTarget: commonDirectory(members.map((member) => member.file)),
      pattern: singletons[indices[0]].norm.slice(0, 80),
      tier: "semantic",
      ruleId: duplicatesRuleId("semantic"),
    })
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
    auditCaveat: DETECT_DUPLICATES_AUDIT_CAVEAT,
  }
}
