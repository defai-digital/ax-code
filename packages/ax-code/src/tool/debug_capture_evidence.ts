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
  }),
  execute: async (args, ctx) => {
    // Strict-validate caseId references an existing open case in the
    // session. Same pattern as register_finding's evidenceRefs check —
    // prevents the model from fabricating case ids.
    const knownCases = SessionDebug.caseIdSet(ctx.sessionID as SessionID)
    if (!knownCases.has(args.caseId)) {
      throw new Error(
        `caseId references an unknown debug case: ${args.caseId} (no DebugCase with this id was opened in session ${ctx.sessionID})`,
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
      source: { tool: "debug_capture_evidence", version: Installation.VERSION, runId: ctx.sessionID },
    })

    return {
      title: `debug_capture_evidence ${args.kind}`,
      output: `Captured ${args.kind} evidence ${evidenceId} for case ${args.caseId}`,
      metadata: {
        evidenceId,
        debugEvidence,
      },
    }
  },
})
