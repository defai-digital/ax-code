import type { Finding } from "./finding"
import type { Severity } from "./finding-registry"

// Pure helpers for counting findings by workflow / severity. Lives outside
// session/ so both server-side aggregators and client-side renderers can
// import without pulling Node-only deps (EventQuery, Database).

export type SeverityCounts = {
  CRITICAL: number
  HIGH: number
  MEDIUM: number
  LOW: number
  INFO: number
  total: number
}

export type Counts = {
  review: SeverityCounts
  debug: SeverityCounts
  qa: SeverityCounts
}

export function emptySeverityCounts(): SeverityCounts {
  return { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0, total: 0 }
}

export function emptyCounts(): Counts {
  return {
    review: emptySeverityCounts(),
    debug: emptySeverityCounts(),
    qa: emptySeverityCounts(),
  }
}

export function countByWorkflow(findings: readonly Finding[]): Counts {
  const counts = emptyCounts()
  for (const finding of findings) {
    const bucket = counts[finding.workflow]
    bucket[finding.severity as Severity] += 1
    bucket.total += 1
  }
  return counts
}
