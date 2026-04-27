import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./debug_propose_hypothesis.txt"
import {
  computeDebugHypothesisId,
  DebugHypothesisSchema,
  DebugHypothesisStatus,
  DEBUG_ID_PATTERN,
} from "../debug-engine/runtime-debug"
import { Installation } from "../installation"
import { SessionDebug } from "../session/debug"
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

    // Strict-validate caseId AND every evidenceRef. Use indexedIds() so we
    // walk the session event log once for both checks (caseIdSet +
    // evidenceIdSet would walk it twice).
    const evidenceRefs = args.evidenceRefs ?? []
    const { caseIds, evidenceIds } = SessionDebug.indexedIds(sessionID)
    if (!caseIds.has(args.caseId)) {
      throw new Error(
        `caseId references an unknown debug case: ${args.caseId} (no DebugCase with this id was opened in session ${ctx.sessionID})`,
      )
    }
    for (const id of evidenceRefs) {
      if (!evidenceIds.has(id)) {
        throw new Error(
          `evidenceRefs references an unknown evidence id: ${id} (no DebugEvidence with this id was captured in session ${ctx.sessionID})`,
        )
      }
    }

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
