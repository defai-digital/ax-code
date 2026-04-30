import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./debug_propose_hypothesis.txt"
import {
  computeDebugHypothesisId,
  DebugHypothesisSchema,
  DebugHypothesisStatus,
  DEBUG_ID_PATTERN,
} from "../debug-engine/runtime-debug"
import { classifyEnvelopeSet } from "../debug-engine/verify-after-fix"
import { Installation } from "../installation"
import { SessionDebug } from "../session/debug"
import { SessionVerifications } from "../session/verifications"
import type { SessionID } from "../session/schema"

const StaticAnalysisInput = z.object({
  sourceCallId: z.string().min(1),
  chainLength: z.number().int().min(0),
  chainConfidence: z.number().min(0).max(0.95),
})

// Combine static and runtime signals into a single confidence number
// (0..0.95). Lives here rather than runtime-debug.ts because it's a tool
// concern — the schema doesn't care how confidence was computed, only
// that it's in range.
//
// Formula:
//   base = 0.4
// + static.chainConfidence × 0.3 if staticAnalysis is supplied
// + min(0.05 × evidence count, 0.25) for runtime support
//   capped at 0.95 (never claim certainty in debug)
function computeConfidence(input: {
  staticAnalysis?: z.infer<typeof StaticAnalysisInput>
  evidenceCount: number
}): number {
  const base = 0.4
  const staticBoost = input.staticAnalysis ? input.staticAnalysis.chainConfidence * 0.3 : 0
  const runtimeBoost = Math.min(input.evidenceCount * 0.05, 0.25)
  return Math.min(base + staticBoost + runtimeBoost, 0.95)
}

function validateConfirmedStatus(input: {
  status: z.infer<typeof DebugHypothesisStatus> | undefined
  evidenceRefs: readonly string[]
  verificationRuns: ReturnType<typeof SessionVerifications.loadRunsWithIds>
}) {
  if (input.status !== "confirmed") return
  const referencedRuns = input.verificationRuns.filter((run) =>
    run.envelopes.some((item) => input.evidenceRefs.includes(item.envelopeId)),
  )
  if (
    referencedRuns.length > 0 &&
    referencedRuns.every(
      (run) =>
        !SessionVerifications.runPolicyFailed(run) &&
        classifyEnvelopeSet(run.envelopes.map((item) => item.envelope)) === "confirmed",
    )
  ) {
    return
  }
  throw new Error(
    "Cannot mark hypothesis as confirmed without a successful VerificationEnvelope evidence set from this session. Run verify_project after the fix and cite at least one passed envelope, no failed/error/timeout envelopes, and no failed verification policy.",
  )
}

function validateEvidencePresence(input: {
  evidenceRefs: readonly string[]
  staticAnalysis: z.infer<typeof StaticAnalysisInput> | undefined
}) {
  if (input.evidenceRefs.length > 0 || input.staticAnalysis) return
  throw new Error(
    "Cannot propose a debug hypothesis without evidenceRefs or staticAnalysis. Capture evidence first or cite a debug_analyze call chain.",
  )
}

export const DebugProposeHypothesisTool = Tool.define("debug_propose_hypothesis", {
  description: DESCRIPTION,
  parameters: z.object({
    caseId: z.string().regex(DEBUG_ID_PATTERN, "caseId must be 16-char hex from debug_open_case"),
    claim: z.string().min(1).max(500),
    staticAnalysis: StaticAnalysisInput.optional(),
    evidenceRefs: z.array(z.string().regex(DEBUG_ID_PATTERN)).optional(),
    status: DebugHypothesisStatus.optional(),
  }),
  execute: async (args, ctx) => {
    const sessionID = ctx.sessionID as SessionID

    // Strict-validate caseId AND every evidenceRef. evidenceRefs can point
    // at EITHER a DebugEvidence id OR a VerificationEnvelope id (the
    // Phase 0 design intent — see verify-after-fix.ts: a hypothesis that
    // has been verified-after-fix carries the envelope id alongside the
    // raw evidence ids). Reject only ids that exist in NEITHER namespace.
    const evidenceRefs = args.evidenceRefs ?? []
    const { caseIds, evidenceIds } = SessionDebug.indexedIds(sessionID)
    if (!caseIds.has(args.caseId)) {
      throw new Error(
        `caseId references an unknown debug case: ${args.caseId} (no DebugCase with this id was opened in session ${ctx.sessionID})`,
      )
    }
    validateEvidencePresence({
      evidenceRefs,
      staticAnalysis: args.staticAnalysis,
    })
    const verificationRuns = SessionVerifications.loadRunsWithIds(sessionID)
    const verificationEnvelopes = verificationRuns.flatMap((run) => run.envelopes)
    if (evidenceRefs.length > 0) {
      const envelopeIds = new Set(verificationEnvelopes.map((item) => item.envelopeId))
      for (const id of evidenceRefs) {
        if (!evidenceIds.has(id) && !envelopeIds.has(id)) {
          throw new Error(
            `evidenceRefs references an unknown id: ${id} (no DebugEvidence and no VerificationEnvelope with this id exist in session ${ctx.sessionID})`,
          )
        }
      }
    }
    validateConfirmedStatus({
      status: args.status,
      evidenceRefs,
      verificationRuns,
    })

    const hypothesisId = computeDebugHypothesisId({ caseId: args.caseId, claim: args.claim })
    const confidence = computeConfidence({
      staticAnalysis: args.staticAnalysis,
      evidenceCount: evidenceRefs.length,
    })

    const debugHypothesis = DebugHypothesisSchema.parse({
      schemaVersion: 1,
      hypothesisId,
      caseId: args.caseId,
      claim: args.claim,
      confidence,
      staticAnalysis: args.staticAnalysis,
      evidenceRefs,
      status: args.status ?? "active",
      source: { tool: "debug_propose_hypothesis", version: Installation.VERSION, runId: ctx.sessionID },
    })

    return {
      title: `debug_propose_hypothesis ${hypothesisId}`,
      output: `Proposed hypothesis ${hypothesisId} (confidence ${confidence.toFixed(2)}): ${args.claim.slice(0, 80)}${args.claim.length > 80 ? "…" : ""}`,
      metadata: {
        hypothesisId,
        confidence,
        debugHypothesis,
      },
    }
  },
})
