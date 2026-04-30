import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./debug_apply_verification.txt"
import { DEBUG_ID_PATTERN, DebugHypothesisSchema } from "../debug-engine/runtime-debug"
import {
  applyVerificationToHypothesis,
  classifyEnvelope,
  resolveCaseStatus,
} from "../debug-engine/verify-after-fix"
import { Installation } from "../installation"
import { SessionDebug } from "../session/debug"
import { SessionVerifications } from "../session/verifications"
import type { SessionID } from "../session/schema"

export const DebugApplyVerificationTool = Tool.define("debug_apply_verification", {
  description: DESCRIPTION,
  parameters: z.object({
    hypothesisId: z.string().regex(DEBUG_ID_PATTERN, "hypothesisId must be 16-char hex from debug_propose_hypothesis"),
    envelopeId: z.string().regex(DEBUG_ID_PATTERN, "envelopeId must be 16-char hex from verify_project/refactor_apply"),
  }),
  execute: async (args, ctx) => {
    const sessionID = ctx.sessionID as SessionID
    const debug = SessionDebug.load(sessionID)
    const hypothesis = debug.hypotheses.find((item) => item.hypothesisId === args.hypothesisId)
    if (!hypothesis) {
      throw new Error(
        `hypothesisId references an unknown debug hypothesis: ${args.hypothesisId} (no DebugHypothesis with this id exists in session ${ctx.sessionID})`,
      )
    }

    const debugCase = debug.cases.find((item) => item.caseId === hypothesis.caseId)
    if (!debugCase) {
      throw new Error(
        `hypothesis ${args.hypothesisId} references missing debug case ${hypothesis.caseId} in session ${ctx.sessionID}`,
      )
    }

    const verification = SessionVerifications.loadWithIds(sessionID).find((item) => item.envelopeId === args.envelopeId)
    if (!verification) {
      throw new Error(
        `envelopeId references an unknown VerificationEnvelope: ${args.envelopeId} (no envelope with this id exists in session ${ctx.sessionID})`,
      )
    }

    const verificationOutcome = classifyEnvelope(verification.envelope)
    const applied = applyVerificationToHypothesis({
      hypothesis,
      envelope: verification.envelope,
    })
    const debugHypothesis = DebugHypothesisSchema.parse({
      ...applied,
      source: { tool: "debug_apply_verification", version: Installation.VERSION, runId: ctx.sessionID },
    })
    const caseHypotheses = debug.hypotheses
      .map((item) => (item.hypothesisId === debugHypothesis.hypothesisId ? debugHypothesis : item))
      .filter((item) => item.caseId === debugCase.caseId)
    const effectiveCaseStatus = resolveCaseStatus(debugCase.status, caseHypotheses)

    return {
      title: `debug_apply_verification ${verification.envelopeId}`,
      output: [
        `Applied verification ${verification.envelopeId} to hypothesis ${debugHypothesis.hypothesisId}`,
        `Outcome: ${verificationOutcome}`,
        `Hypothesis status: ${debugHypothesis.status}`,
        `Case status: ${effectiveCaseStatus}`,
      ].join("\n"),
      metadata: {
        hypothesisId: debugHypothesis.hypothesisId,
        envelopeId: verification.envelopeId,
        verificationOutcome,
        effectiveCaseStatus,
        debugHypothesis,
      },
    }
  },
})
