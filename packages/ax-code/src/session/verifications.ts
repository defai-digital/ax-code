import {
  computeEnvelopeId,
  type VerificationEnvelope,
  VerificationEnvelopeSchema,
} from "../quality/verification-envelope"
import { EventQuery } from "../replay/query"
import { Log } from "../util/log"
import type { SessionID } from "./schema"
import { isRecord } from "./record"

export namespace SessionVerifications {
  const log = Log.create({ service: "session-verifications" })

  // Walks the session event log and rebuilds the VerificationEnvelope[]
  // emitted by tools that record verification runs, including verify_project
  // and refactor_apply. The loader is intentionally
  // tool-name agnostic: any tool.result whose metadata carries a
  // verificationEnvelopes array of validated envelopes is included.
  //
  // Each envelope is re-validated via VerificationEnvelopeSchema. Entries
  // that fail validation are skipped (with a warning) so a single corrupted
  // record cannot block the rest.
  type LoadedEnvelope = { envelope: VerificationEnvelope; envelopeId: string }
  type LoadedEnvelopeRun = {
    tool: string
    callID: string
    metadata?: Record<string, unknown>
    /** Latest-owned citations; unique across runs for counts and selection. */
    envelopes: LoadedEnvelope[]
    /** All validated members of the original run, including re-emitted siblings. */
    verificationSet: LoadedEnvelope[]
  }

  export function runPolicyFailed(run: Pick<LoadedEnvelopeRun, "metadata">): boolean {
    const policy = run.metadata?.policy
    if (!isRecord(policy)) return false
    return policy.requiredChecksPassed === false
  }

  export function loadRunsWithIds(sessionID: SessionID): LoadedEnvelopeRun[] {
    const events = EventQuery.bySession(sessionID)
    // Dedup by computeEnvelopeId (deterministic hash of envelope content).
    // Re-running refactor_apply on the same plan in the same session
    // produces identical envelopes; keep one so consumers and sidebar counts
    // don't double-count the same verification run. Keep the LATEST copy:
    // sourceState is not part of the id, and the freshness check of a cited
    // envelope must see the source state of the most recent run, not one
    // taken before later edits. Keep each owning run's full verification set
    // separately: deduplication must never hide a failed or stale sibling.
    // Walk newest-first, then restore event order.
    const seen = new Set<string>()
    const runs: LoadedEnvelopeRun[] = []
    for (const event of [...events].reverse()) {
      if (event.type !== "tool.result") continue
      if (event.status !== "completed") continue
      const candidate = event.metadata?.verificationEnvelopes
      if (!Array.isArray(candidate)) continue
      const envelopes: LoadedEnvelope[] = []
      const localIds = new Set<string>()
      for (let i = 0; i < candidate.length; i++) {
        const parsed = VerificationEnvelopeSchema.safeParse(candidate[i])
        if (!parsed.success) {
          log.warn("dropping malformed verificationEnvelope metadata entry", {
            sessionID,
            tool: event.tool,
            callID: event.callID,
            index: i,
            issues: parsed.error.issues.length,
          })
          continue
        }
        const id = computeEnvelopeId(parsed.data)
        if (localIds.has(id)) continue
        localIds.add(id)
        envelopes.push({ envelope: parsed.data, envelopeId: id })
      }
      const owned = envelopes.filter((item) => !seen.has(item.envelopeId))
      for (const item of envelopes) seen.add(item.envelopeId)
      if (owned.length > 0)
        runs.push({
          tool: event.tool,
          callID: event.callID,
          metadata: event.metadata,
          envelopes: owned,
          verificationSet: envelopes,
        })
    }
    return runs.reverse()
  }

  /** Resolve a citation to its latest owner while retaining the original run's siblings. */
  export function resolveEnvelope(
    sessionID: SessionID,
    envelopeId: string,
  ): { run: LoadedEnvelopeRun; verification: LoadedEnvelope } {
    for (const run of loadRunsWithIds(sessionID)) {
      const verification = run.envelopes.find((item) => item.envelopeId === envelopeId)
      if (verification) return { run, verification }
    }
    throw new Error(
      `envelopeId references an unknown VerificationEnvelope: ${envelopeId} (no envelope with this id exists in session ${sessionID})`,
    )
  }

  export function load(sessionID: SessionID): VerificationEnvelope[] {
    return loadWithIds(sessionID).map((item) => item.envelope)
  }

  // Same as load() but each envelope is paired with its derived envelopeId
  // (computed via computeEnvelopeId). Useful for consumers that need to
  // cross-reference findings.evidenceRefs[].kind === "verification" entries
  // against the envelopes recorded in this session — see Phase 2 P2.5.
  export function loadWithIds(sessionID: SessionID): LoadedEnvelope[] {
    return loadRunsWithIds(sessionID).flatMap((run) => run.envelopes)
  }
}
