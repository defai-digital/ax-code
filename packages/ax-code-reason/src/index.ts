import { Log } from "./internal/log"
import { codeReasonHost, type Graph } from "./host"
import { CodeNodeID } from "./id"
import type { ProjectID } from "./id"
import { DebugEngineQuery } from "./query"
import { RefactorPlanID } from "./id"
import type { PlanRow } from "./repository"
import type { RefactorPlanKind, RefactorPlanRisk, RefactorPlanStatus } from "./schema.sql"
import { analyzeBugImpl, type AnalyzeBugInput } from "./analyze-bug"
import { detectDuplicatesImpl, type DetectDuplicatesInput } from "./detect-duplicates"
import { planRefactorImpl, type PlanRefactorInput } from "./plan-refactor"
import { analyzeImpactImpl, type AnalyzeImpactInput } from "./analyze-impact"
import { detectHardcodesImpl, type DetectHardcodesInput } from "./detect-hardcodes"
import { applySafeRefactorImpl, type ApplySafeRefactorInput } from "./apply-safe-refactor"
import { detectRacesImpl, type DetectRacesInput } from "./detect-races"
import { detectLifecycleImpl, type DetectLifecycleInput } from "./detect-lifecycle"
import { detectSecurityImpl, type DetectSecurityInput } from "./detect-security"
import z from "zod"

export * from "./host"
export { Incremental, type IncrementalContext, shouldFallbackToFull, computeObsoleteFindings } from "./incremental"
export { DiagnosticCorrelation } from "./diagnostic-correlation"
export { prewarmAffectedFiles } from "./prewarm-lsp"

const log = Log.create({ service: "debug-engine" })

// Public namespace for the Debugging & Refactoring Engine.
//
// DRE is a reasoning layer on top of v3 CodeIntelligence. It never modifies
// v3 tables (ADR-002) — every CodeIntelligence call is read-only from DRE's
// perspective. DRE's own state lives in debug_engine_* tables.
//
// Every returned record carries an `explain` field so callers can audit
// where the answer came from (which graph queries ran, which heuristics
// applied, completeness inherited from the graph). This extends the v3
// explainability guarantee to the DRE layer.
//
// Phase 1 exports three features: analyzeBug, detectDuplicates,
// planRefactor. The remaining two (detectHardcodes, analyzeImpact,
// applySafeRefactor) land in Phase 2/3 per the PRD §6 delivery plan.
export namespace DebugEngine {
  // ─── Bus Events ────────────────────────────────────────────────────

  export const CorrelatedDiagnosticSchema = z.object({
    file: z.string(),
    line: z.number(),
    message: z.string(),
    severity: z.number(),
    rootCauseFile: z.string().nullable(),
    rootCauseSymbol: z.string().nullable(),
    rootCauseChain: z.array(z.string()),
    confidence: z.enum(["high", "medium", "low"]),
    lspTimestamp: z.number(),
    lspServerIDs: z.array(z.string()),
    graphQueryIds: z.array(z.string()),
    graphIndexedAt: z.number(),
    graphCompleteness: z.enum(["full", "partial", "lsp-only"]),
  })

  export type CorrelatedDiagnostic = z.infer<typeof CorrelatedDiagnosticSchema>

  // Event shape is owned here; publishing and bus registration are host
  // responsibilities (see CodeReasonHost.events). The ax-code glue registers
  // "debug-engine.correlated-diagnostics" with its BusEvent registry so the
  // event stays part of the SSE/OpenAPI contract.
  export const Event = {
    CorrelatedDiagnostics: {
      type: "debug-engine.correlated-diagnostics" as const,
      properties: z.object({
        file: z.string(),
        correlations: z.array(CorrelatedDiagnosticSchema),
      }),
    },
  }

  // ─── Explain ────────────────────────────────────────────────────────

  export type Tool =
    | "analyze-bug"
    | "plan-refactor"
    | "detect-duplicates"
    | "detect-hardcodes"
    | "analyze-impact"
    | "apply-safe-refactor"
    | "detect-races"
    | "detect-lifecycle"
    | "detect-security"

  // Minimum completeness across the graph queries DRE consulted. Uses the
  // v3 enum verbatim: "full" = LSP precise, "partial" = tree-sitter only,
  // "lsp-only" = LSP with gaps. ADR-008: do NOT overload this enum to
  // signal DRE-side truncation; that's a separate `truncated` flag on
  // feature outputs.
  export type Completeness = "full" | "partial" | "lsp-only"

  export type Explain = {
    source: "debug-engine"
    tool: Tool
    queryId: string
    // Query IDs from every CodeIntelligence call this result drew on.
    // Lets auditors trace a DRE claim back to the exact graph query.
    graphQueries: string[]
    // Human-readable heuristic tags, e.g. "ts-stack-regex",
    // "rule-filter:node_modules", "llm-reasoning".
    heuristicsApplied: string[]
    // min(indexedAt) across consulted graph queries. Zero when no graph
    // query was consulted (pure heuristic path).
    indexedAt: number
    completeness: Completeness
  }

  function nextQueryId(tool: Tool): string {
    return `de_${tool}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  // Fold the minimum completeness across a list of CodeIntelligence
  // explain records. The ordering "full" > "lsp-only" > "partial" reflects
  // the v3 semantics: "partial" (tree-sitter only) is the weakest, then
  // "lsp-only" (LSP with gaps), then "full" (LSP precise).
  function minCompleteness(explains: ReadonlyArray<Graph.Explain>): Completeness {
    let worst: Completeness = "full"
    for (const e of explains) {
      if (e.completeness === "partial") return "partial"
      if (e.completeness === "lsp-only") worst = "lsp-only"
    }
    return worst
  }

  // Build a DebugEngine.Explain from a list of CodeIntelligence results
  // consulted by a DRE call. `tool` identifies the DRE feature;
  // `heuristics` are human-readable tags the feature applied.
  export function buildExplain(tool: Tool, ciExplains: ReadonlyArray<Graph.Explain>, heuristics: string[]): Explain {
    return {
      source: "debug-engine",
      tool,
      queryId: nextQueryId(tool),
      graphQueries: ciExplains.map((e) => e.queryId),
      heuristicsApplied: heuristics,
      indexedAt: ciExplains.length === 0 ? 0 : Math.min(...ciExplains.map((e) => e.indexedAt)),
      completeness: ciExplains.length === 0 ? "full" : minCompleteness(ciExplains),
    }
  }

  // ─── analyzeBug output shape ────────────────────────────────────────

  export type StackFrame = {
    frame: number
    symbol: Graph.Symbol | null
    file: string
    line: number
    role: "entry" | "intermediate" | "failure"
  }

  export type RootCauseHypothesis = {
    summary: string
    brokenInvariant: string
    citedFrames: number[]
  }

  export type RootCauseResult = {
    chain: StackFrame[]
    rootCauseHypothesis: RootCauseHypothesis | null
    fixSuggestion: string | null
    confidence: number
    truncated: boolean
    explain: Explain
  }

  // ─── detectDuplicates output shape ──────────────────────────────────

  export type DuplicateTier = "exact" | "structural" | "semantic"

  export type DuplicateCluster = {
    id: string
    members: Graph.Symbol[]
    similarityScore: number
    sharedLines: number
    suggestedExtractionTarget: string
    pattern: string
    tier: DuplicateTier
    // Additive (Phase 4-prep, U4): labels the cluster with the rule that
    // produced it (axcode:detect-duplicates-{exact|structural|semantic}).
    // Optional so existing callers without U4 keep compiling unchanged.
    ruleId?: string
  }

  export type DuplicateReport = {
    clusters: DuplicateCluster[]
    totalDuplicateLines: number
    truncated: boolean
    explain: Explain
    // Additive (Phase 4-prep, U4): reminds consumers that a clean
    // heuristic scan is not a full duplicate audit (no AST walk, no
    // cross-file embedding similarity yet).
    auditCaveat?: string
  }

  // ─── analyzeImpact output shape ─────────────────────────────────────

  export type ImpactAffectedSymbol = {
    symbol: Graph.Symbol
    distance: number
    path: CodeNodeID[]
  }

  export type ImpactReport = {
    seeds: CodeNodeID[]
    affectedSymbols: ImpactAffectedSymbol[]
    affectedFiles: string[]
    apiBoundariesHit: number
    riskScore: number
    riskLabel: "low" | "medium" | "high"
    truncated: boolean
    explain: Explain
  }

  // ─── detectHardcodes output shape ───────────────────────────────────

  export type HardcodeKind = "magic_number" | "inline_url" | "inline_path" | "inline_secret_shape"

  export type HardcodeFinding = {
    file: string
    line: number
    column: number
    kind: HardcodeKind
    value: string
    suggestion: string
    severity: "low" | "medium" | "high"
    // Additive (Phase 4-prep, U4): labels the finding with the rule that
    // produced it (axcode:detect-hardcodes-{magic-number|inline-url|...}).
    // Optional so existing callers without U4 keep compiling unchanged.
    ruleId?: string
  }

  export type HardcodeReport = {
    findings: HardcodeFinding[]
    filesScanned: number
    truncated: boolean
    explain: Explain
    // Additive (Phase 4-prep, U4): a clean regex scan is not a full
    // hardcode audit — AST-level constant extraction and cross-file
    // duplication detection are out of scope for the heuristic pass.
    auditCaveat?: string
  }

  // ─── applySafeRefactor output shape ─────────────────────────────────

  export type CheckResult = {
    ok: boolean
    errors: string[]
    skipped?: boolean
    timedOut?: boolean
    exitCode?: number
  }

  export type TestResult = CheckResult & {
    ran: number
    failed: number
    failures: string[]
    selection: "targeted" | "full-fallback" | "skipped"
  }

  export type ApplyResult = {
    applied: boolean
    planId: RefactorPlanID
    checks: {
      typecheck: CheckResult
      lint: CheckResult
      tests: TestResult
    }
    filesChanged: string[]
    abortReason: string | null
    explain: Explain
  }

  // ─── planRefactor output shape ──────────────────────────────────────

  export type RefactorEditOp =
    | "create_symbol"
    | "replace_call_site"
    | "delete_symbol"
    | "move_file"
    | "update_signature"

  export type RefactorEdit = {
    op: RefactorEditOp
    target: string // CodeNodeID string or file path
    detail: string
  }

  export type RefactorPlan = {
    planId: RefactorPlanID
    kind: RefactorPlanKind
    summary: string
    edits: RefactorEdit[]
    affectedFiles: string[]
    affectedSymbols: CodeNodeID[]
    risk: RefactorPlanRisk
    status: RefactorPlanStatus
    explain: Explain
  }

  // ─── detectRaces output shape ────────────────────────────────────────

  export type RacePattern = "toctou" | "non_atomic_counter" | "conflicting_mutation" | "stale_listener"

  export type RaceFinding = {
    file: string
    line: number
    endLine?: number
    pattern: RacePattern
    severity: "high" | "medium" | "low"
    description: string
    code: string
    fix: string
    // Additive (Phase 4-prep, U4): labels the finding with the rule that
    // produced it (axcode:detect-races-{toctou|non-atomic-counter|...}).
    // Optional so existing callers without U4 keep compiling unchanged.
    ruleId?: string
  }

  export type RaceReport = {
    findings: RaceFinding[]
    filesScanned: number
    truncated: boolean
    explain: Explain
    // Additive (Phase 4-prep, U4): a clean async-TS regex scan is not
    // a full race-condition audit — no data-flow / happens-before
    // analysis, no cross-file effect tracking.
    auditCaveat?: string
  }

  // ─── detectLifecycle output shape ──────────────────────────────────

  export type LifecycleResourceType =
    | "event_listener"
    | "abort_controller"
    | "child_process"
    | "timer"
    | "subscription"
    | "map_growth"

  export type LifecyclePattern = "no_cleanup" | "cleanup_missing_in_error_path" | "unbounded_growth"

  export type LifecycleFinding = {
    file: string
    line: number
    resourceType: LifecycleResourceType
    pattern: LifecyclePattern
    severity: "high" | "medium" | "low"
    description: string
    cleanupLocation: string | null
    // Additive (Phase 4-prep, U4): labels the finding with the rule that
    // produced it (axcode:detect-lifecycle-{resource-type}-{pattern}).
    // Optional so existing callers without U4 keep compiling unchanged.
    ruleId?: string
  }

  export type LifecycleReport = {
    findings: LifecycleFinding[]
    filesScanned: number
    truncated: boolean
    explain: Explain
    // Additive (Phase 4-prep, U4): a clean cross-line heuristic scan is
    // not a full resource-lifecycle audit — no cross-function dispose
    // tracking, no control-flow analysis.
    auditCaveat?: string
  }

  // ─── detectSecurity output shape ────────────────────────────────────

  export type SecurityPattern = "path_traversal" | "command_injection" | "ssrf" | "missing_validation" | "env_leak"

  export type SecurityFinding = {
    file: string
    line: number
    pattern: SecurityPattern
    severity: "high" | "medium" | "low"
    description: string
    // Additive (Phase 4-prep, U4): labels the finding with the rule that
    // produced it (axcode:detect-security-{path-traversal|...}). Optional
    // so existing callers without U4 keep compiling unchanged.
    ruleId?: string
  }

  export type SecurityReport = {
    findings: SecurityFinding[]
    filesScanned: number
    truncated: boolean
    explain: Explain
    // Additive (Phase 4-prep, U4): a clean line-based heuristic scan
    // is NOT a security audit — no taint tracking, no type-system
    // reasoning, no runtime input validation. Pair with type-aware
    // scanners before relying on a clean result.
    auditCaveat?: string
  }

  // ─── Public feature functions ───────────────────────────────────────
  //
  // Phase 1: three features. All read-only against v3; planRefactor writes
  // to DRE's own debug_engine_refactor_plan table but never touches v3 or
  // the file system.

  export async function analyzeBug(projectID: ProjectID, input: AnalyzeBugInput): Promise<RootCauseResult> {
    log.info("analyzeBug", { projectID, hasStackTrace: !!input.stackTrace })
    return analyzeBugImpl(projectID, input)
  }

  export async function detectDuplicates(projectID: ProjectID, input: DetectDuplicatesInput): Promise<DuplicateReport> {
    log.info("detectDuplicates", { projectID, scope: input.scope })
    return detectDuplicatesImpl(projectID, input)
  }

  export async function planRefactor(projectID: ProjectID, input: PlanRefactorInput): Promise<RefactorPlan> {
    log.info("planRefactor", { projectID, kind: input.kind, targetCount: input.targets.length })
    return planRefactorImpl(projectID, input)
  }

  export async function analyzeImpact(projectID: ProjectID, input: AnalyzeImpactInput): Promise<ImpactReport> {
    log.info("analyzeImpact", { projectID, changes: input.changes.length })
    return analyzeImpactImpl(projectID, input)
  }

  export async function detectHardcodes(projectID: ProjectID, input: DetectHardcodesInput): Promise<HardcodeReport> {
    log.info("detectHardcodes", { projectID })
    return detectHardcodesImpl(input)
  }

  export async function applySafeRefactor(projectID: ProjectID, input: ApplySafeRefactorInput): Promise<ApplyResult> {
    log.info("applySafeRefactor", { projectID, planId: input.planId, mode: input.mode })
    return applySafeRefactorImpl(projectID, input)
  }

  export async function detectRaces(projectID: ProjectID, input: DetectRacesInput): Promise<RaceReport> {
    log.info("detectRaces", { projectID })
    return detectRacesImpl(input)
  }

  export async function detectLifecycle(projectID: ProjectID, input: DetectLifecycleInput): Promise<LifecycleReport> {
    log.info("detectLifecycle", { projectID })
    return detectLifecycleImpl(input)
  }

  export async function detectSecurity(projectID: ProjectID, input: DetectSecurityInput): Promise<SecurityReport> {
    log.info("detectSecurity", { projectID })
    return detectSecurityImpl(input)
  }

  // ─── Plan management (read-only helpers for callers) ────────────────

  export function getPlan(projectID: ProjectID, planId: RefactorPlanID): RefactorPlan | null {
    const row = DebugEngineQuery.getPlan(projectID, planId)
    if (!row) return null
    return planRowToPublic(row)
  }

  export function listPlans(
    projectID: ProjectID,
    opts?: { status?: RefactorPlanStatus; limit?: number },
  ): RefactorPlan[] {
    return DebugEngineQuery.listPlans(projectID, opts).map(planRowToPublic)
  }

  function planRowToPublic(row: PlanRow): RefactorPlan {
    return {
      planId: row.id,
      kind: row.kind,
      summary: row.summary,
      edits: row.edits as RefactorEdit[],
      affectedFiles: row.affected_files,
      affectedSymbols: row.affected_symbols.map((id) => CodeNodeID.make(id)),
      risk: row.risk,
      status: row.status,
      explain: {
        source: "debug-engine",
        tool: "plan-refactor",
        queryId: `de_plan-refactor_persisted_${row.id}`,
        graphQueries: [],
        heuristicsApplied: ["persisted-plan"],
        indexedAt: row.time_created,
        completeness: "full",
      },
    }
  }

  // Test helper. Clears every DRE row for a project without going through
  // the feature functions.
  export function __clearProject(projectID: ProjectID): void {
    DebugEngineQuery.__clearProject(projectID)
  }
}
