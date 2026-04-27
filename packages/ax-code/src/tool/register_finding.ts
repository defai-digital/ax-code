import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./register_finding.txt"
import {
  CategoryEnum,
  computeFindingId,
  EvidenceRef,
  FindingAnchor,
  FindingSchema,
  RULE_ID_PATTERN,
  SeverityEnum,
  WorkflowEnum,
} from "../quality/finding"
import { Installation } from "../installation"
import { SessionVerifications } from "../session/verifications"
import type { SessionID } from "../session/schema"

export const RegisterFindingTool = Tool.define("register_finding", {
  description: DESCRIPTION,
  parameters: z.object({
    workflow: WorkflowEnum,
    category: CategoryEnum,
    severity: SeverityEnum,
    summary: z.string().min(1).max(200),
    file: z.string().min(1),
    anchor: FindingAnchor,
    rationale: z.string().min(1),
    evidence: z.array(z.string()),
    evidenceRefs: z.array(EvidenceRef).optional(),
    suggestedNextAction: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    ruleId: z.string().regex(RULE_ID_PATTERN).optional(),
    tool: z.string().min(1).optional(),
  }),
  execute: async (args, ctx) => {
    // Phase 2 P2.5 step 4: reject hallucinated verification refs. If the
    // model cites a verification envelope by id, the id must correspond to
    // an envelope actually recorded in this session — otherwise the
    // finding's "verified by" trail is fabricated. Other evidenceRef kinds
    // (log/graph/diff) are not validated here because they don't yet have
    // a corresponding session-level loader; they'll be validated in their
    // own slices.
    const verificationRefs = args.evidenceRefs?.filter((ref) => ref.kind === "verification") ?? []
    if (verificationRefs.length > 0) {
      const knownIds = SessionVerifications.envelopeIdSet(ctx.sessionID as SessionID)
      for (const ref of verificationRefs) {
        if (!knownIds.has(ref.id)) {
          throw new Error(
            `evidenceRefs references unknown verification envelope id: ${ref.id} (no envelope with this id was recorded in session ${ctx.sessionID})`,
          )
        }
      }
    }

    const findingId = computeFindingId({
      workflow: args.workflow,
      category: args.category,
      file: args.file,
      anchor: args.anchor,
      ruleId: args.ruleId,
    })

    const finding = FindingSchema.parse({
      schemaVersion: 1,
      findingId,
      workflow: args.workflow,
      category: args.category,
      severity: args.severity,
      confidence: args.confidence,
      summary: args.summary,
      file: args.file,
      anchor: args.anchor,
      rationale: args.rationale,
      evidence: args.evidence,
      evidenceRefs: args.evidenceRefs,
      suggestedNextAction: args.suggestedNextAction,
      ruleId: args.ruleId,
      source: {
        tool: args.tool ?? "review",
        version: Installation.VERSION,
        runId: ctx.sessionID,
      },
    })

    const anchorRef =
      finding.anchor.kind === "line"
        ? `${finding.file}:${finding.anchor.line}${finding.anchor.endLine ? `-${finding.anchor.endLine}` : ""}`
        : `${finding.file} (${finding.anchor.symbolId})`

    return {
      title: `register_finding ${finding.severity} ${finding.category}`,
      output: `Recorded ${finding.severity} ${finding.category} finding ${finding.findingId} at ${anchorRef}: ${finding.summary}`,
      metadata: {
        findingId: finding.findingId,
        finding,
      },
    }
  },
})
