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
  // emitted by tools that record verification runs. Currently the only
  // producer is refactor_apply (which writes metadata.verificationEnvelopes
  // alongside its legacy result.checks), but the loader is intentionally
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
    envelopes: LoadedEnvelope[]
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
    // produces identical envelopes; we keep the first so consumers and
    // sidebar counts don't double-count the same verification run.
    const seen = new Set<string>()
    const runs: LoadedEnvelopeRun[] = []
    for (const event of events) {
      if (event.type !== "tool.result") continue
      if (event.status !== "completed") continue
      const candidate = event.metadata?.verificationEnvelopes
      if (!Array.isArray(candidate)) continue
      const envelopes: LoadedEnvelope[] = []
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
        if (seen.has(id)) continue
        seen.add(id)
        envelopes.push({ envelope: parsed.data, envelopeId: id })
      }
      if (envelopes.length > 0)
        runs.push({ tool: event.tool, callID: event.callID, metadata: event.metadata, envelopes })
    }
    return runs
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
