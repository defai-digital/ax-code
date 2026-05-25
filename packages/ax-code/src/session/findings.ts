import { EventQuery } from "../replay/query"
import { FindingSchema, type Finding } from "../quality/finding"
import { Log } from "../util/log"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session-findings" })

// Walks the session event log and rebuilds the Finding[] emitted by tools.
// Each completed tool.result that carries a metadata.finding payload is
// re-validated against FindingSchema v1; entries that fail validation are
// skipped (with a warning) so a single corrupted record cannot block the
// whole list. register_finding is the manual producer; debug_analyze can
// also emit a graph-backed debug finding.
export function loadSessionFindings(sessionID: SessionID): Finding[] {
  const events = EventQuery.bySession(sessionID)
  // Dedup by findingId (deterministic hash). Multiple tool calls for the
  // same defect, e.g. the model re-runs /review and re-emits the same anchor,
  // produce identical findingIds; we keep the first occurrence so the audit
  // trail and the rendered list don't diverge.
  const seen = new Set<string>()
  const findings: Finding[] = []
  for (const event of events) {
    if (event.type !== "tool.result") continue
    if (event.status !== "completed") continue
    const candidate = event.metadata?.finding
    if (!candidate) continue
    const parsed = FindingSchema.safeParse(candidate)
    if (!parsed.success) {
      log.warn("dropping malformed finding metadata", {
        sessionID,
        callID: event.callID,
        issues: parsed.error.issues.length,
      })
      continue
    }
    if (seen.has(parsed.data.findingId)) continue
    seen.add(parsed.data.findingId)
    findings.push(parsed.data)
  }
  return findings
}
