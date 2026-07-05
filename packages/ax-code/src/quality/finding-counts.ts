import type { Finding } from "./finding"
import { Severity } from "./finding-registry"
import type { Severity as SeverityValue } from "./finding-registry"

// Pure helpers for counting findings by workflow / severity. Lives outside
// session/ so both server-side aggregators and client-side renderers can
// import without pulling Node-only deps (EventQuery, Database).

export type SeverityCounts = Record<SeverityValue, number> & {
  total: number
}

export type Counts = {
  review: SeverityCounts
  debug: SeverityCounts
  qa: SeverityCounts
}

export function emptySeverityCounts(): SeverityCounts {
  return {
    ...Object.fromEntries(Severity.map((severity) => [severity, 0])),
    total: 0,
  } as SeverityCounts
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
    bucket[finding.severity as SeverityValue] += 1
    bucket.total += 1
  }
  return counts
}
