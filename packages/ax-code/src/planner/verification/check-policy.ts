import type { VerificationEnvelope } from "../../quality/verification-envelope"

// Phase 2 P2.2: smallest-relevant-checks-first policy.
//
// Given a workflow's intent (changed files, prior failures, explicit escalation
// hints), pick the narrowest verification scope that still answers the
// question "is this change OK". Workflows start at `file` scope and only
// escalate when they have a concrete reason to.
//
// This module is policy ONLY — no IO, no command execution. Callers feed
// the decision into the runner module to actually run the checks.

export type CheckScope = VerificationEnvelope["scope"]["kind"]

export type SelectChecksInput = {
  // The set of files the workflow is reasoning about. Empty → no narrow
  // scope is meaningful, escalate to workspace.
  changedFiles: readonly string[]
  // Force a specific scope (CLI flag, policy rule, repair-handoff loop).
  // When set, takes precedence over the heuristics below.
  forceScope?: CheckScope
  // Hints from previous runs of the same workflow. Used to climb the
  // ladder when a narrower scope produced inconclusive results.
  priorEscalation?: CheckScope
  // Coarse package boundary detector — caller supplies a function that
  // maps a file path to a package id (e.g. directory of nearest
  // package.json). When all changed files share a single package id,
  // selectChecks may pick `package` scope. Optional — when undefined the
  // policy falls back to the file/workspace binary.
  packageOf?: (file: string) => string | null
}

export type CheckSelection = {
  scope: CheckScope
  reasoning: string
  paths?: string[]
}

const ESCALATION_LADDER: CheckScope[] = ["file", "package", "workspace"]

function ladderIndex(scope: CheckScope): number {
  const idx = ESCALATION_LADDER.indexOf(scope)
  // `custom` is not on the ladder — treat it as the broadest level so
  // priorEscalation: "custom" doesn't downgrade the scope.
  return idx < 0 ? ESCALATION_LADDER.length : idx
}

function highestOf(a: CheckScope, b: CheckScope): CheckScope {
  // "highest" = broadest. Defined ladder positions win over "custom"
  // (off-ladder) only when "custom" comes from a forceScope; otherwise
  // we keep whichever is broader by ladder index.
  return ladderIndex(b) > ladderIndex(a) ? b : a
}

export function selectChecks(input: SelectChecksInput): CheckSelection {
  // Forced scope short-circuits everything. CLI flags and policy rules
  // expect this to be honored verbatim.
  if (input.forceScope) {
    const reasoning = `forceScope=${input.forceScope}`
    if (input.forceScope === "file" || input.forceScope === "package") {
      return { scope: input.forceScope, reasoning, paths: [...input.changedFiles] }
    }
    return { scope: input.forceScope, reasoning }
  }

  if (input.changedFiles.length === 0) {
    return { scope: "workspace", reasoning: "no changed files; nothing narrower is meaningful" }
  }

  // If the caller can tell us about package boundaries and all changed
  // files share a single package, prefer `package` over `file` only when
  // there are 2+ files (single-file changes are still cheaper at `file`).
  if (input.packageOf && input.changedFiles.length >= 2) {
    const packages = new Set<string>()
    let allKnown = true
    for (const file of input.changedFiles) {
      const pkg = input.packageOf(file)
      if (pkg === null) {
        allKnown = false
        break
      }
      packages.add(pkg)
    }
    if (allKnown && packages.size === 1) {
      const baseline: CheckSelection = {
        scope: "package",
        reasoning: `${input.changedFiles.length} changed files in a single package`,
        paths: [...input.changedFiles],
      }
      return applyPriorEscalation(baseline, input.priorEscalation)
    }
    if (allKnown && packages.size > 1) {
      const baseline: CheckSelection = {
        scope: "workspace",
        reasoning: `changed files span ${packages.size} packages; package scope can't cover them`,
      }
      return applyPriorEscalation(baseline, input.priorEscalation)
    }
  }

  // Default: start narrow at file scope.
  const baseline: CheckSelection = {
    scope: "file",
    reasoning: input.changedFiles.length === 1 ? "single changed file" : `${input.changedFiles.length} changed files`,
    paths: [...input.changedFiles],
  }
  return applyPriorEscalation(baseline, input.priorEscalation)
}

function applyPriorEscalation(baseline: CheckSelection, prior: CheckScope | undefined): CheckSelection {
  if (!prior) return baseline
  const next = highestOf(baseline.scope, prior)
  if (next === baseline.scope) return baseline
  // Climbed the ladder — drop paths when the new scope can't honor them.
  if (next === "workspace" || next === "custom") {
    return {
      scope: next,
      reasoning: `${baseline.reasoning}; escalated from ${baseline.scope} per priorEscalation=${prior}`,
    }
  }
  return {
    scope: next,
    reasoning: `${baseline.reasoning}; escalated from ${baseline.scope} per priorEscalation=${prior}`,
    paths: baseline.paths,
  }
}
