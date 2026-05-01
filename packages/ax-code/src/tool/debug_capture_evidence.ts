import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./debug_capture_evidence.txt"
import {
  computeDebugEvidenceId,
  DebugEvidenceKind,
  DebugEvidenceSchema,
  DEBUG_ID_PATTERN,
} from "../debug-engine/runtime-debug"
import { Installation } from "../installation"
import { SessionDebug } from "../session/debug"
import type { SessionID } from "../session/schema"

export const DebugCaptureEvidenceTool = Tool.define("debug_capture_evidence", {
  description: DESCRIPTION,
  parameters: z.object({
    caseId: z.string().regex(DEBUG_ID_PATTERN, "caseId must be 16-char hex from debug_open_case"),
    kind: DebugEvidenceKind,
    content: z.string().min(1),
    planId: z
      .string()
      .regex(DEBUG_ID_PATTERN, "planId must be 16-char hex from debug_plan_instrumentation")
      .optional()
      .describe(
        "Optional planId returned by debug_plan_instrumentation. Provide this when the evidence was produced by an instrumentation probe so the capture is traceable back to the plan.",
      ),
  }),
  execute: async (args, ctx) => {
    const sessionID = ctx.sessionID as SessionID
    // Strict-validate caseId references an existing open case in the
    // session. Same pattern as register_finding's evidenceRefs check —
    // prevents the model from fabricating case ids.
    const { caseIds, planIds } = SessionDebug.indexedIds(sessionID)
    if (!caseIds.has(args.caseId)) {
      throw new Error(
        `caseId references an unknown debug case: ${args.caseId} (no DebugCase with this id was opened in session ${ctx.sessionID})`,
      )
    }
    if (args.planId !== undefined && !planIds.has(args.planId)) {
      throw new Error(
        `planId references an unknown instrumentation plan: ${args.planId} (no DebugInstrumentationPlan with this id exists in session ${ctx.sessionID})`,
      )
    }
    if (args.kind === "instrumentation_result" && args.planId === undefined) {
      throw new Error(
        `debug_capture_evidence: kind "instrumentation_result" requires planId — pass the id returned by debug_plan_instrumentation`,
      )
    }

    const evidenceId = computeDebugEvidenceId({
      caseId: args.caseId,
      kind: args.kind,
      content: args.content,
    })

    const debugEvidence = DebugEvidenceSchema.parse({
      schemaVersion: 1,
      evidenceId,
      caseId: args.caseId,
      kind: args.kind,
      capturedAt: new Date().toISOString(),
      content: args.content,
      planId: args.planId,
      source: { tool: "debug_capture_evidence", version: Installation.VERSION, runId: ctx.sessionID },
    })

    const planSuffix = args.planId ? ` (from plan ${args.planId})` : ""
    return {
      title: `debug_capture_evidence ${args.kind}`,
      output: `Captured ${args.kind} evidence ${evidenceId} for case ${args.caseId}${planSuffix}`,
      metadata: {
        evidenceId,
        debugEvidence,
      },
    }
  },
})
