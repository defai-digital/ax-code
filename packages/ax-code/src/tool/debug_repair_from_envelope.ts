import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./debug_repair_from_envelope.txt"
import { ENVELOPE_ID_PATTERN } from "../quality/verification-envelope"
import { briefFromFailure, shouldHandoff } from "../planner/verification/repair-handoff"
import { SessionVerifications } from "../session/verifications"
import type { SessionID } from "../session/schema"
import { ToolNumber } from "./schema"

export const DebugRepairFromEnvelopeTool = Tool.define("debug_repair_from_envelope", {
  description: DESCRIPTION,
  parameters: z.object({
    envelopeId: z
      .string()
      .regex(ENVELOPE_ID_PATTERN, "envelopeId must be 16-char hex from verify_project/refactor_apply"),
    maxFailures: ToolNumber(z.number().int().min(1).max(50)).optional(),
  }),
  execute: async (args, ctx) => {
    const sessionID = ctx.sessionID as SessionID
    const verificationRun = SessionVerifications.loadRunsWithIds(sessionID).find((run) =>
      run.envelopes.some((item) => item.envelopeId === args.envelopeId),
    )
    const verification = verificationRun?.envelopes.find((item) => item.envelopeId === args.envelopeId)
    if (!verificationRun || !verification) {
      throw new Error(
        `envelopeId references an unknown VerificationEnvelope: ${args.envelopeId} (no envelope with this id exists in session ${ctx.sessionID})`,
      )
    }

    const decision = shouldHandoff(verification.envelope, {
      ...(args.maxFailures ? { maxFailures: args.maxFailures } : {}),
    })
    const brief = decision.handoff ? briefFromFailure(verification.envelope) : undefined
    const policyFailed = SessionVerifications.runPolicyFailed(verificationRun)

    return {
      title: decision.handoff
        ? `debug_repair_from_envelope ready ${args.envelopeId}`
        : `debug_repair_from_envelope rejected ${args.envelopeId}`,
      output: [
        `Envelope: ${args.envelopeId}`,
        `Source: ${verificationRun.tool}/${verificationRun.callID}`,
        `Decision: ${decision.handoff ? "candidate" : "rejected"}`,
        `Reasoning: ${decision.reasoning}`,
        ...(policyFailed ? ["Verification policy: failed"] : []),
        ...(brief ? ["", brief] : []),
      ].join("\n"),
      metadata: {
        envelopeId: args.envelopeId,
        decision,
        brief,
        verificationRun: {
          tool: verificationRun.tool,
          callID: verificationRun.callID,
          policyFailed,
        },
        envelope: verification.envelope,
      },
    }
  },
})
