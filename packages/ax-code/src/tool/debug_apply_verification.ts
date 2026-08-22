import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./debug_apply_verification.txt"
import { DEBUG_ID_PATTERN, DebugHypothesisSchema, type DebugHypothesis } from "@ax-code/ax-code-reason/runtime-debug"
import {
  applyVerificationSetToHypothesis,
  classifyEnvelopeSet,
  resolveCaseStatus,
} from "@ax-code/ax-code-reason/verify-after-fix"
import { transitionHypothesis } from "@ax-code/ax-code-reason/lifecycle"
import { classifyEnvelopeFreshness, enforceCitationFreshness } from "@ax-code/ax-code-reason/quality/freshness"
import { Installation } from "../installation"
import { Instance } from "../project/instance"
import { currentSourceState } from "../quality/source-state"
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

    const verificationRun = SessionVerifications.loadRunsWithIds(sessionID).find((run) =>
      run.envelopes.some((item) => item.envelopeId === args.envelopeId),
    )
    const verification = verificationRun?.envelopes.find((item) => item.envelopeId === args.envelopeId)
    if (!verificationRun || !verification) {
      throw new Error(
        `envelopeId references an unknown VerificationEnvelope: ${args.envelopeId} (no envelope with this id exists in session ${ctx.sessionID})`,
      )
    }

    const verificationSet = verificationRun.envelopes.map((item) => item.envelope)
    const verificationEnvelopeIds = verificationRun.envelopes.map((item) => item.envelopeId)
    const verificationPolicyFailed = SessionVerifications.runPolicyFailed(verificationRun)

    // Phase 1 (PRD D3): applying a verification to a hypothesis is an
    // authoritative citation — the evidence must still describe the current
    // worktree. Stale or unfingerprintable evidence fails closed: the call
    // stays inconclusive (hypothesis untouched, like the policy-failed path)
    // and reports needs_verification instead of confirming/refuting.
    const current = await currentSourceState(Instance.worktree, Instance.project.vcs ?? "")
    const verificationFreshness = verificationRun.envelopes.map((item) => ({
      envelopeId: item.envelopeId,
      ...classifyEnvelopeFreshness(item.envelope, current),
    }))
    const staleEvidence = verificationFreshness.filter((item) => !enforceCitationFreshness(item, "authoritative").ok)
    const needsVerification = staleEvidence.length > 0

    const verificationOutcome =
      verificationPolicyFailed || needsVerification ? "inconclusive" : classifyEnvelopeSet(verificationSet)

    // Phase 3 (D5): delegate the status flip to the hypothesis state machine.
    // When the transition is legal (active → confirmed/refuted) the hypothesis
    // is applied as before; when it's illegal (a terminal hypothesis), the
    // hypothesis stays put and the rejection reason is surfaced.
    let applied: DebugHypothesis = hypothesis
    let transitionRejection: { reason: string; from: string; to: string } | undefined
    if (!verificationPolicyFailed && !needsVerification && verificationOutcome !== "inconclusive") {
      const target = verificationOutcome === "confirmed" ? "confirmed" : "refuted"
      const transition = transitionHypothesis(hypothesis.status, target, { envelopes: verificationSet })
      if (transition.ok) {
        applied = applyVerificationSetToHypothesis({
          hypothesis,
          envelopes: verificationSet,
        })
      } else {
        transitionRejection = { reason: transition.reason, from: hypothesis.status, to: target }
      }
    }
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
        `Applied verification set ${verificationRun.callID} to hypothesis ${debugHypothesis.hypothesisId}`,
        `Selected envelope: ${verification.envelopeId}`,
        `Outcome: ${verificationOutcome}`,
        ...(verificationPolicyFailed ? ["Verification policy: failed"] : []),
        ...(needsVerification
          ? [
              `Needs verification: stale evidence (${staleEvidence
                .map((item) => `${item.envelopeId}=${item.status}${"reason" in item ? `/${item.reason}` : ""}`)
                .join(", ")}) — re-run verify_project against the current worktree before confirming`,
            ]
          : []),
        ...(transitionRejection
          ? [
              `Transition rejected: ${transitionRejection.reason} (cannot move ${transitionRejection.from} → ${transitionRejection.to})`,
            ]
          : []),
        `Hypothesis status: ${debugHypothesis.status}`,
        `Case status: ${effectiveCaseStatus}`,
      ].join("\n"),
      metadata: {
        hypothesisId: debugHypothesis.hypothesisId,
        envelopeId: verification.envelopeId,
        verificationEnvelopeIds,
        verificationOutcome,
        verificationPolicyFailed,
        effectiveCaseStatus,
        debugHypothesis,
        // Freshness metadata is only attached on the failure path so fresh
        // citations keep the exact pre-Phase-1 metadata shape.
        ...(needsVerification ? { needsVerification: true, verificationFreshness: staleEvidence } : {}),
        // Phase 3 (D5): attached only when the transition was rejected so the
        // legal-transition metadata shape stays unchanged.
        ...(transitionRejection ? { transitionRejection } : {}),
      },
    }
  },
})
