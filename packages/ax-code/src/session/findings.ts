import { EventQuery } from "../replay/query"
import { FindingSchema, type Finding } from "../quality/finding"
import { Log } from "../util/log"
import type { SessionID } from "./schema"

export namespace SessionFindings {
  const log = Log.create({ service: "session-findings" })

  // Walks the session event log and rebuilds the Finding[] emitted by
  // register_finding tool calls. Each tool.result that carries a
  // metadata.finding payload is re-validated against FindingSchema v1;
  // entries that fail validation are skipped (with a warning) so a single
  // corrupted record cannot block the whole list.
  export function load(sessionID: SessionID): Finding[] {
    const events = EventQuery.bySession(sessionID)
    const findings: Finding[] = []
    for (const event of events) {
      if (event.type !== "tool.result") continue
      if (event.tool !== "register_finding") continue
      if (event.status !== "completed") continue
      const candidate = event.metadata?.finding
      if (!candidate) continue
      const parsed = FindingSchema.safeParse(candidate)
      if (!parsed.success) {
        log.warn("dropping malformed register_finding metadata", {
          sessionID,
          callID: event.callID,
          issues: parsed.error.issues.length,
        })
        continue
      }
      findings.push(parsed.data)
    }
    return findings
  }

  // Severity buckets for the same Finding[]. Useful for sidebar / dashboard
  // surfaces that want a per-workflow count per severity without re-walking
  // events.
  export type Counts = {
    review: SeverityCounts
    debug: SeverityCounts
    qa: SeverityCounts
  }

  export type SeverityCounts = {
    CRITICAL: number
    HIGH: number
    MEDIUM: number
    LOW: number
    INFO: number
    total: number
  }

  function emptySeverityCounts(): SeverityCounts {
    return { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0, total: 0 }
  }

  export function countByWorkflow(findings: Finding[]): Counts {
    const counts: Counts = {
      review: emptySeverityCounts(),
      debug: emptySeverityCounts(),
      qa: emptySeverityCounts(),
    }
    for (const finding of findings) {
      const bucket = counts[finding.workflow]
      bucket[finding.severity] += 1
      bucket.total += 1
    }
    return counts
  }
}
