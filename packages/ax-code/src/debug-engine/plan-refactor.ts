import { CodeIntelligence } from "../code-intelligence"
import { CodeNodeID } from "../code-intelligence/id"
import type { ProjectID } from "../project/schema"
import { DebugEngine } from "./index"
import { DebugEngineQuery } from "./query"
import { RefactorPlanID } from "./id"
import type { RefactorPlanKind, RefactorPlanRisk } from "./schema.sql"

// planRefactor — produces an auditable refactor plan without writing any
// files. The plan is persisted in debug_engine_refactor_plan and later
// consumed by applySafeRefactor (Phase 3).
//
// Hard invariant (ADR-006, PRD §4.2): this function NEVER writes files.
// It only reads from CodeIntelligence and writes a single row to DRE's
// own plan table. The no-file-writes guarantee is verified in tests by
// hooking the filesystem before calling planRefactor and asserting
// zero writes occurred.

export type PlanRefactorInput = {
  intent: string
  targets: CodeNodeID[]
  kind?: RefactorPlanKind
  scope?: "worktree" | "none"
}

// Classify intent into a refactor kind via keyword matching when the
// caller hasn't specified one. This is deliberately rule-based — an LLM
// classifier would be non-deterministic and add latency for no benefit
// at this level of granularity.
export function classifyIntent(intent: string): RefactorPlanKind {
  const lower = intent.toLowerCase()
  if (/\b(extract|pull out|factor out)\b/.test(lower)) return "extract"
  if (/\brename\b/.test(lower)) return "rename"
  if (/\b(collapse|merge|unify|dedup|consolidate)\b/.test(lower)) return "collapse"
  if (/\b(move|relocate)\b/.test(lower)) return "move"
  if (/\binline\b/.test(lower)) return "inline"
  return "other"
}

// Risk classification is deterministic given a fixed graph state. We
// count cross-file call sites, look at visibility (public symbols are
// riskier to change), and apply a simple threshold table.
function classifyRisk(params: {
  crossFileCallSites: number
  publicTargets: number
  affectedFileCount: number
}): RefactorPlanRisk {
  const { crossFileCallSites, publicTargets, affectedFileCount } = params
  // Any public target touched = at minimum medium.
  if (publicTargets > 0 && crossFileCallSites > 10) return "high"
  if (crossFileCallSites > 25 || affectedFileCount > 15) return "high"
  if (crossFileCallSites > 5 || publicTargets > 0 || affectedFileCount > 4) return "medium"
  return "low"
}

// Build the edit list for a given kind and target set. Phase 1 supports
// the three highest-frequency kinds (extract, rename, collapse) with
// real edit operations; the others produce a single "other" edit with
// the target list, which is still a valid plan shape for callers to
// review. Phase 2 expands this.
function buildEdits(
  kind: RefactorPlanKind,
  targets: CodeIntelligence.Symbol[],
  callers: Map<string, CodeIntelligence.CallChainNode[]>,
  references: Map<string, CodeIntelligence.Reference[]>,
): DebugEngine.RefactorEdit[] {
  const edits: DebugEngine.RefactorEdit[] = []
  if (kind === "extract") {
    // Extract: create a new symbol, then replace each call site with a
    // reference to it.
    edits.push({
      op: "create_symbol",
      target: targets[0]?.qualifiedName ?? "new_extracted_symbol",
      detail: `Extract shared logic from ${targets.length} target${targets.length === 1 ? "" : "s"}`,
    })
    for (const t of targets) {
      const siteCount = callers.get(t.id)?.length ?? 0
      if (siteCount > 0) {
        edits.push({
          op: "replace_call_site",
          target: t.id,
          detail: `Redirect ${siteCount} caller${siteCount === 1 ? "" : "s"} of ${t.qualifiedName} to the extracted symbol`,
        })
      }
    }
    return edits
  }
  if (kind === "rename") {
    for (const t of targets) {
      const refCount = references.get(t.id)?.length ?? 0
      edits.push({
        op: "update_signature",
        target: t.id,
        detail: `Rename ${t.qualifiedName} and update ${refCount} reference${refCount === 1 ? "" : "s"}`,
      })
    }
    return edits
  }
  if (kind === "collapse") {
    // Collapse: keep the first target, route everyone else to it, then
    // delete the duplicates.
    if (targets.length < 2) {
      edits.push({
        op: "update_signature",
        target: targets[0]?.id ?? "",
        detail: `Collapse requires ≥2 targets; received ${targets.length}`,
      })
      return edits
    }
    const [keeper, ...rest] = targets
    for (const dup of rest) {
      const siteCount = callers.get(dup.id)?.length ?? 0
      if (siteCount > 0) {
        edits.push({
          op: "replace_call_site",
          target: dup.id,
          detail: `Route ${siteCount} caller${siteCount === 1 ? "" : "s"} of ${dup.qualifiedName} to ${keeper.qualifiedName}`,
        })
      }
      edits.push({
        op: "delete_symbol",
        target: dup.id,
        detail: `Remove duplicate ${dup.qualifiedName}`,
      })
    }
    return edits
  }
  if (kind === "move") {
    for (const t of targets) {
      edits.push({
        op: "move_file",
        target: t.id,
        detail: `Move ${t.qualifiedName} (currently in ${t.file})`,
      })
    }
    return edits
  }
  if (kind === "inline") {
    for (const t of targets) {
      const siteCount = callers.get(t.id)?.length ?? 0
      edits.push({
        op: "replace_call_site",
        target: t.id,
        detail: `Inline ${t.qualifiedName} at ${siteCount} call site${siteCount === 1 ? "" : "s"}`,
      })
      edits.push({
        op: "delete_symbol",
        target: t.id,
        detail: `Remove ${t.qualifiedName} after inlining`,
      })
    }
    return edits
  }
  // Fallback: emit one edit per target labeled "other" so the plan
  // shape is always non-empty.
  for (const t of targets) {
    edits.push({
      op: "update_signature",
      target: t.id,
      detail: `Refactor ${t.qualifiedName}`,
    })
  }
  return edits
}

function buildSummary(
  kind: RefactorPlanKind,
  targets: CodeIntelligence.Symbol[],
  affectedFiles: string[],
  risk: RefactorPlanRisk,
): string {
  const lines: string[] = []
  lines.push(`# Refactor plan — ${kind}`)
  lines.push("")
  lines.push(`**Risk:** ${risk}`)
  lines.push(`**Targets:** ${targets.length}`)
  lines.push(`**Affected files:** ${affectedFiles.length}`)
  lines.push("")
  lines.push("## Target symbols")
  for (const t of targets) {
    lines.push(`- \`${t.qualifiedName}\` (${t.file}:${t.range.start.line + 1})`)
  }
  return lines.join("\n")
}

export async function planRefactorImpl(
  projectID: ProjectID,
  input: PlanRefactorInput,
): Promise<DebugEngine.RefactorPlan> {
  const scope: "worktree" | "none" = input.scope ?? "worktree"
  const kind = input.kind ?? classifyIntent(input.intent)
  const heuristics: string[] = [`intent-classified:${kind}`]
  const ciExplains: CodeIntelligence.Explain[] = []

  // Resolve every target to a real graph symbol. Missing targets are
  // dropped (we log) so the plan never contains phantom node IDs — the
  // "cite or drop" principle from analyzeBug applies here too.
  const resolved: CodeIntelligence.Symbol[] = []
  for (const id of input.targets) {
    const sym = CodeIntelligence.getSymbol(projectID, id, { scope })
    if (sym) {
      resolved.push(sym)
      ciExplains.push(sym.explain)
    }
  }
  heuristics.push(`resolved-targets=${resolved.length}/${input.targets.length}`)

  // Pull caller and reference sets for each resolved target. One pass,
  // stored in maps keyed by node id so buildEdits can reuse them.
  const callers = new Map<string, CodeIntelligence.CallChainNode[]>()
  const references = new Map<string, CodeIntelligence.Reference[]>()
  for (const t of resolved) {
    const cs = CodeIntelligence.findCallers(projectID, t.id, { scope })
    const rs = CodeIntelligence.findReferences(projectID, t.id, { scope })
    callers.set(t.id, cs)
    references.set(t.id, rs)
    for (const c of cs) ciExplains.push(c.symbol.explain)
    for (const r of rs) ciExplains.push(r.explain)
  }

  // Compute affected-file set: the target files plus every caller file.
  const affectedFileSet = new Set<string>()
  for (const t of resolved) affectedFileSet.add(t.file)
  for (const cs of callers.values()) for (const c of cs) affectedFileSet.add(c.symbol.file)
  for (const rs of references.values()) for (const r of rs) affectedFileSet.add(r.sourceFile)
  const affectedFiles = [...affectedFileSet]

  // Risk inputs.
  const crossFileCallSites = [...callers.entries()].reduce((sum, [targetId, cs]) => {
    const targetFile = resolved.find((t) => t.id === targetId)?.file
    return sum + cs.filter((c) => c.symbol.file !== targetFile).length
  }, 0)
  const publicTargets = resolved.filter(
    (t) => t.visibility === "public" || t.visibility === undefined || t.visibility === null,
  ).length
  const risk = classifyRisk({
    crossFileCallSites,
    publicTargets,
    affectedFileCount: affectedFiles.length,
  })
  heuristics.push(`risk=${risk}`)

  const edits = buildEdits(kind, resolved, callers, references)
  const summary = buildSummary(kind, resolved, affectedFiles, risk)

  // Persist. This is the only write in the entire function and it's to
  // a DRE-owned table — never to v3 tables or the filesystem.
  const planId = RefactorPlanID.ascending()
  const now = Date.now()

  // Snapshot the graph cursor so applySafeRefactor can detect staleness.
  // In Phase 1 the cursor may be null for fresh projects; we store null
  // faithfully and the staleness check in Phase 3 handles both branches.
  const status = CodeIntelligence.status(projectID)
  const cursorSha = status.lastCommitSha

  DebugEngineQuery.insertPlan({
    id: planId,
    project_id: projectID,
    kind,
    summary,
    edits,
    affected_files: affectedFiles,
    affected_symbols: resolved.map((r) => r.id),
    risk,
    status: "pending",
    graph_cursor_at_creation: cursorSha,
    time_created: now,
    time_updated: now,
  })

  return {
    planId,
    kind,
    summary,
    edits,
    affectedFiles,
    affectedSymbols: resolved.map((r) => r.id),
    risk,
    status: "pending",
    explain: DebugEngine.buildExplain("plan-refactor", ciExplains, heuristics),
  }
}
