import { CodeIntelligence } from "../code-intelligence"
import { CodeNodeID } from "../code-intelligence/id"
import type { ProjectID } from "../project/schema"
import { DebugEngine } from "./index"

// analyzeBug — root-cause chain assembly for a reported error.
//
// Phase 1 scope: TypeScript stack trace parsing, deterministic frame
// resolution against the v3 code graph, call-chain expansion via
// CodeIntelligence.findCallers, shallow rule-based filtering. No LLM
// reasoning step is invoked inside DRE — the constrained-reasoning step
// lives at the agent/tool layer (the `debug` agent can pass a resolved
// chain to its own LLM). This keeps DRE itself a deterministic library
// with zero model dependencies.
//
// ADR-005 "cite or drop" invariant: nothing in this file invents a
// symbol. Every symbol in the output comes from a real CodeIntelligence
// query result. Callers that layer an LLM reasoning step on top MUST
// validate that every cited frame index exists in the returned chain
// (the test suite exercises an adversarial validator helper below).

export type AnalyzeBugInput = {
  error: string
  stackTrace?: string
  entrySymbol?: CodeNodeID
  scope?: "worktree" | "none"
  // Optional depth cap for findCallers traversal. Defaults to 5, max 8.
  chainDepth?: number
}

const DEFAULT_CHAIN_DEPTH = 5
const MAX_CHAIN_DEPTH = 8

// Files we treat as noise in the chain unless the error itself originates
// there. Dropping these is what lets the hypothesis point at user code
// rather than framework frames.
const NOISE_PATTERNS = [
  /\/node_modules\//,
  /\/\.bun\//,
  /\/\.cache\//,
  /\/dist\//,
  /\/build\//,
  /\/(chunk-|vendor-)[a-z0-9]+\.js/,
  /\binternal\/[a-z]+\.js/, // node internals
]

type ParsedFrame = {
  file: string
  line: number
  symbolName?: string
  raw: string
}

// Parse a V8/Bun/Node-style TypeScript stack trace into structured frames.
// Matches both:
//   "    at Foo.bar (/abs/path/file.ts:10:5)"
//   "    at /abs/path/file.ts:10:5"
// The second form has no symbol name — we still resolve it via
// CodeIntelligence.symbolsInFile + nearest-by-line-range.
export function parseTypeScriptStack(stack: string): ParsedFrame[] {
  const out: ParsedFrame[] = []
  const lines = stack.split("\n")
  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed.startsWith("at ")) continue
    // Form 1: "at Symbol (/file:line:col)"
    const match1 = trimmed.match(/^at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$/)
    if (match1) {
      out.push({
        symbolName: match1[1],
        file: match1[2],
        line: Number(match1[3]),
        raw: trimmed,
      })
      continue
    }
    // Form 2: "at /file:line:col"
    const match2 = trimmed.match(/^at\s+(.+?):(\d+):(\d+)$/)
    if (match2) {
      out.push({
        file: match2[1],
        line: Number(match2[2]),
        raw: trimmed,
      })
      continue
    }
  }
  return out
}

// Parse a Python traceback into structured frames. Python tracebacks
// look like:
//   Traceback (most recent call last):
//     File "/abs/path/file.py", line 42, in function_name
//       some_code_line
//     File "/abs/path/other.py", line 10, in <module>
//       other_code_line
//   ValueError: something went wrong
//
// Note: Python orders frames oldest-first; V8 orders newest-first. To
// keep DRE's "frame 0 = failure site" invariant, we reverse Python
// traces so the failure frame (most recent) is index 0.
export function parsePythonStack(stack: string): ParsedFrame[] {
  const out: ParsedFrame[] = []
  const lines = stack.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    // `  File "/abs/path/file.py", line 42, in function_name`
    const match = raw.match(/^\s*File\s+"([^"]+)",\s+line\s+(\d+),\s+in\s+(.+?)$/)
    if (!match) continue
    out.push({
      file: match[1],
      line: Number(match[2]),
      symbolName: match[3].trim(),
      raw: raw.trim(),
    })
  }
  // Reverse to match V8 ordering: failure frame first, entry frame last.
  return out.reverse()
}

// Auto-detect stack trace format. Python traces start with "Traceback"
// and use `File "..."` lines; V8 traces use `at ...`. Anything else
// falls back to V8 parsing (which gracefully handles unknown input by
// returning an empty frame list).
export type StackFormat = "typescript" | "python" | "unknown"

export function detectStackFormat(stack: string): StackFormat {
  if (/^Traceback\s+\(most recent call last\)/m.test(stack)) return "python"
  if (/File\s+"[^"]+",\s+line\s+\d+,\s+in\s/.test(stack)) return "python"
  if (/^\s*at\s+\S/m.test(stack)) return "typescript"
  return "unknown"
}

// Dispatch to the right parser based on format detection. Exposed
// separately from the per-format parsers so tests can exercise the
// dispatch logic directly.
export function parseStackTrace(stack: string): { frames: ParsedFrame[]; format: StackFormat } {
  const format = detectStackFormat(stack)
  if (format === "python") return { frames: parsePythonStack(stack), format }
  if (format === "typescript") return { frames: parseTypeScriptStack(stack), format }
  // Unknown format — attempt TS parser as a best-effort fallback.
  return { frames: parseTypeScriptStack(stack), format: "unknown" }
}

// Drop frames that match the noise pattern list, but keep the failure
// frame (index 0 in V8 stack order) even if it's noisy — that's the
// origin of the error and the user wants to see it.
function filterNoise(frames: ParsedFrame[]): { kept: ParsedFrame[]; droppedCount: number } {
  const kept: ParsedFrame[] = []
  let droppedCount = 0
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const isNoise = NOISE_PATTERNS.some((p) => p.test(frame.file))
    if (isNoise && i > 0) {
      droppedCount++
      continue
    }
    kept.push(frame)
  }
  return { kept, droppedCount }
}

// Strip "new " prefix and nested class/method notation so we have a bare
// symbol name we can look up via CodeIntelligence.findSymbol. V8 produces
// things like "new Foo", "Foo.bar", "Object.<anonymous>" — we want the
// leaf method name.
function extractLeafName(symbolName: string): string | undefined {
  let name = symbolName.trim()
  if (name.startsWith("new ")) name = name.slice(4).trim()
  if (name.includes("<anonymous>")) return undefined
  // "Foo.bar" → "bar"; "Foo.prototype.bar" → "bar"
  const parts = name.split(".")
  const leaf = parts[parts.length - 1]
  if (!leaf || leaf.length === 0) return undefined
  return leaf
}

// Resolve a parsed frame to a graph node. Prefers exact name match
// restricted to the frame's file; falls back to nearest-by-line within
// the file; returns null if neither works.
export function resolveFrame(
  projectID: ProjectID,
  frame: ParsedFrame,
  scope: "worktree" | "none",
  ciExplains: CodeIntelligence.Explain[],
): CodeIntelligence.Symbol | null {
  if (frame.symbolName) {
    const leaf = extractLeafName(frame.symbolName)
    if (leaf) {
      const hits = CodeIntelligence.findSymbol(projectID, leaf, { file: frame.file, scope })
      if (hits.length > 0) {
        ciExplains.push(hits[0].explain)
        return hits[0]
      }
    }
  }
  // Fallback: list all symbols in the file, pick the one whose range
  // contains `frame.line` (1-indexed in stack traces, 0-indexed in the
  // graph).
  const fileSymbols = CodeIntelligence.symbolsInFile(projectID, frame.file, { scope })
  if (fileSymbols.length === 0) return null
  const line0 = frame.line - 1
  let best: CodeIntelligence.Symbol | null = null
  let bestSpan = Infinity
  for (const sym of fileSymbols) {
    if (sym.range.start.line <= line0 && sym.range.end.line >= line0) {
      const span = sym.range.end.line - sym.range.start.line
      if (span < bestSpan) {
        best = sym
        bestSpan = span
      }
    }
  }
  if (best) ciExplains.push(best.explain)
  return best
}

// Walk up the caller chain from an entry symbol. Each level calls
// CodeIntelligence.findCallers, picks the first caller (stable ordering
// per v3 edge table), and continues until we hit `depth` or run out of
// callers. Cycles are broken by a visited set.
function walkCallers(
  projectID: ProjectID,
  entry: CodeIntelligence.Symbol,
  depth: number,
  scope: "worktree" | "none",
  ciExplains: CodeIntelligence.Explain[],
): CodeIntelligence.Symbol[] {
  const chain: CodeIntelligence.Symbol[] = []
  const visited = new Set<string>([entry.id])
  let current = entry
  for (let i = 0; i < depth; i++) {
    const callers = CodeIntelligence.findCallers(projectID, current.id, { scope })
    if (callers.length === 0) break
    // Stable pick: first caller whose id we haven't visited yet.
    const next = callers.find((c) => !visited.has(c.symbol.id))
    if (!next) break
    ciExplains.push(next.symbol.explain)
    chain.push(next.symbol)
    visited.add(next.symbol.id)
    current = next.symbol
  }
  return chain
}

export async function analyzeBugImpl(
  projectID: ProjectID,
  input: AnalyzeBugInput,
): Promise<DebugEngine.RootCauseResult> {
  const scope: "worktree" | "none" = input.scope ?? "worktree"
  const requestedDepth = input.chainDepth ?? DEFAULT_CHAIN_DEPTH
  const chainDepth = Math.min(Math.max(1, requestedDepth), MAX_CHAIN_DEPTH)
  const heuristics: string[] = []
  const ciExplains: CodeIntelligence.Explain[] = []

  // Parse the stack trace if provided. Without one, we have nothing
  // deterministic to resolve, so the chain is empty and the hypothesis
  // is null — callers get back an explicit "insufficient data" result
  // rather than a fabrication.
  let parsed: ParsedFrame[] = []
  if (input.stackTrace) {
    const { frames, format } = parseStackTrace(input.stackTrace)
    parsed = frames
    if (parsed.length > 0) {
      if (format === "python") heuristics.push("py-traceback-regex")
      else if (format === "typescript") heuristics.push("ts-stack-regex")
      else heuristics.push("stack-fallback-regex")
    }
  }

  const { kept, droppedCount } = filterNoise(parsed)
  if (droppedCount > 0) heuristics.push(`rule-filter:noise(${droppedCount})`)

  // Resolve each kept frame. Frame 0 is the failure point, the last kept
  // frame is the entry-ish side. Mark roles accordingly.
  const chain: DebugEngine.StackFrame[] = kept.map((frame, idx) => ({
    frame: idx,
    symbol: resolveFrame(projectID, frame, scope, ciExplains),
    file: frame.file,
    line: frame.line,
    role: idx === 0 ? "failure" : idx === kept.length - 1 ? "entry" : "intermediate",
  }))

  // Optionally extend the chain upward from the entry frame via findCallers.
  // Useful when the stack trace has been truncated or when the error was
  // caught and re-thrown — we recover the call context the trace lost.
  let truncated = false
  if (chain.length > 0 && chain[chain.length - 1].symbol && input.stackTrace) {
    const entry = chain[chain.length - 1].symbol!
    const extra = walkCallers(projectID, entry, chainDepth, scope, ciExplains)
    if (extra.length > 0) {
      heuristics.push(`walk-callers:depth=${extra.length}`)
      const baseIdx = chain.length
      for (let i = 0; i < extra.length; i++) {
        chain.push({
          frame: baseIdx + i,
          symbol: extra[i],
          file: extra[i].file,
          line: extra[i].range.start.line + 1,
          role: "entry",
        })
      }
      // Re-assign role: the last frame is always "entry", earlier extended
      // frames become "intermediate".
      for (let i = baseIdx; i < chain.length - 1; i++) chain[i].role = "intermediate"
    }
    if (extra.length === chainDepth) truncated = true
  }

  // If an explicit entrySymbol was provided and the stack-trace path
  // didn't yield anything, use it as the seed and walk callers. Covers
  // the "I already know what failed, show me who calls it" workflow.
  if (chain.length === 0 && input.entrySymbol) {
    const seed = CodeIntelligence.getSymbol(projectID, input.entrySymbol, { scope })
    if (seed) {
      ciExplains.push(seed.explain)
      chain.push({
        frame: 0,
        symbol: seed,
        file: seed.file,
        line: seed.range.start.line + 1,
        role: "failure",
      })
      const extra = walkCallers(projectID, seed, chainDepth, scope, ciExplains)
      heuristics.push(`entry-symbol-seed:callers=${extra.length}`)
      for (let i = 0; i < extra.length; i++) {
        chain.push({
          frame: 1 + i,
          symbol: extra[i],
          file: extra[i].file,
          line: extra[i].range.start.line + 1,
          role: i === extra.length - 1 ? "entry" : "intermediate",
        })
      }
      if (extra.length === chainDepth) truncated = true
    }
  }

  // Confidence is derived purely from the fraction of parsed frames we
  // managed to resolve to real graph nodes. Capped at 0.95 per ADR-005
  // — we never claim certainty, even on a fully-resolved chain.
  const parsedCount = kept.length
  const resolvedCount = chain.filter((f) => f.symbol !== null).length
  const resolvedRatio = parsedCount > 0 ? resolvedCount / parsedCount : chain.length > 0 ? 1 : 0
  const confidence = Math.min(0.95, resolvedRatio)

  // Phase 1: DRE does not invoke an LLM. Agents that want a narrative
  // hypothesis pass the resolved chain to their own model at the tool
  // layer. Tests exercise `validateHypothesisCitations` below to prove
  // the cite-or-drop rule is enforceable on LLM output before it's
  // merged into a DRE result.
  const rootCauseHypothesis: DebugEngine.RootCauseHypothesis | null = null
  const fixSuggestion: string | null = null

  return {
    chain,
    rootCauseHypothesis,
    fixSuggestion,
    confidence,
    truncated,
    explain: DebugEngine.buildExplain("analyze-bug", ciExplains, heuristics),
  }
}

// ─── Cite-or-drop validator (ADR-005) ─────────────────────────────────
//
// Agents that layer an LLM reasoning step on top of analyzeBug MUST pipe
// the LLM output through this helper before surfacing it to the user.
// The helper drops any cited frame index that doesn't exist in the chain
// and any claim that cites nothing after filtering.

export function validateHypothesisCitations(
  hypothesis: DebugEngine.RootCauseHypothesis,
  chain: DebugEngine.StackFrame[],
): DebugEngine.RootCauseHypothesis | null {
  const validIndices = new Set(chain.map((f) => f.frame))
  const kept = hypothesis.citedFrames.filter((i) => validIndices.has(i))
  if (kept.length === 0) return null
  return {
    summary: hypothesis.summary,
    brokenInvariant: hypothesis.brokenInvariant,
    citedFrames: kept,
  }
}
