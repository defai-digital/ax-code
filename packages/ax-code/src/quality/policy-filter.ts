import type { Finding } from "./finding"
import type { Severity } from "./finding-registry"
import type { PolicyRules } from "./policy"
import { Glob } from "../util/glob"

// Phase 4 P4.5: post-emit filter that applies a PolicyRules object to a
// list of findings. Pure function — no IO, no mutation. Returns the kept
// findings, the dropped ones with reasons (so consumers can show the
// user *why* a finding was suppressed), and any structural warnings
// (e.g. required_categories missing from the run).
//
// Filter ordering: severity_floor → prohibited_categories → scope_glob.
// Each filter contributes a reason string when it drops a finding.

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
}

export type DroppedFinding = {
  finding: Finding
  reasons: string[]
}

export type PolicyFilterResult = {
  kept: Finding[]
  dropped: DroppedFinding[]
  warnings: string[]
}

export function applyPolicyFilter(findings: readonly Finding[], rules: PolicyRules | undefined): PolicyFilterResult {
  if (!rules) {
    return { kept: [...findings], dropped: [], warnings: [] }
  }

  const kept: Finding[] = []
  const dropped: DroppedFinding[] = []
  const floor = rules.severity_floor ? SEVERITY_RANK[rules.severity_floor] : undefined
  const prohibited = new Set(rules.prohibited_categories ?? [])

  for (const finding of findings) {
    const reasons: string[] = []

    if (floor !== undefined && SEVERITY_RANK[finding.severity] > floor) {
      reasons.push(`severity ${finding.severity} below floor ${rules.severity_floor}`)
    }

    if (prohibited.has(finding.category)) {
      reasons.push(`category ${finding.category} is prohibited by policy`)
    }

    if (rules.scope_glob && rules.scope_glob.length > 0) {
      const inScope = rules.scope_glob.some((pattern) => Glob.match(pattern, finding.file))
      if (!inScope) {
        reasons.push(`file ${finding.file} not matched by scope_glob`)
      }
    }

    if (reasons.length === 0) {
      kept.push(finding)
    } else {
      dropped.push({ finding, reasons })
    }
  }

  const warnings: string[] = []
  if (rules.required_categories && rules.required_categories.length > 0) {
    const present = new Set(kept.map((f) => f.category))
    const missing = rules.required_categories.filter((c) => !present.has(c))
    if (missing.length > 0) {
      warnings.push(`required_categories missing from kept findings: ${missing.join(", ")}`)
    }
  }

  return { kept, dropped, warnings }
}
