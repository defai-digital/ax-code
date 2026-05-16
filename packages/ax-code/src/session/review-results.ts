import { ReviewResultSchema, type ReviewResult } from "../quality/review-result"
import { EventQuery } from "../replay/query"
import { Log } from "../util/log"
import type { SessionID } from "./schema"

export namespace SessionReviewResults {
  const log = Log.create({ service: "session-review-results" })

  export function load(sessionID: SessionID): ReviewResult[] {
    const events = EventQuery.bySession(sessionID)
    const seen = new Set<string>()
    const results: ReviewResult[] = []
    for (const event of events) {
      if (event.type !== "tool.result") continue
      if (event.status !== "completed") continue
      const candidate = event.metadata?.reviewResult
      if (!candidate) continue
      const parsed = ReviewResultSchema.safeParse(candidate)
      if (!parsed.success) {
        log.warn("dropping malformed reviewResult metadata", {
          sessionID,
          tool: event.tool,
          callID: event.callID,
          issues: parsed.error.issues.length,
        })
        continue
      }
      if (seen.has(parsed.data.reviewId)) continue
      seen.add(parsed.data.reviewId)
      results.push(parsed.data)
    }
    return results
  }

  export function latest(sessionID: SessionID): ReviewResult | undefined {
    return load(sessionID).at(-1)
  }
}
