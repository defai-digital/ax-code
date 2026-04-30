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
    // Reject hallucinated or cross-lane verification refs. If the model cites
    // a verification envelope by id, the id must correspond to an envelope
    // actually recorded in this session and the envelope workflow must match
    // this finding's workflow. Otherwise a review finding could launder QA or
    // debug evidence into the wrong assurance lane.
    const verificationRefs = args.evidenceRefs?.filter((ref) => ref.kind === "verification") ?? []
    if (verificationRefs.length > 0) {
      const envelopesById = new Map(
        SessionVerifications.loadWithIds(ctx.sessionID as SessionID).map((item) => [item.envelopeId, item.envelope]),
      )
      for (const ref of verificationRefs) {
        const envelope = envelopesById.get(ref.id)
        if (!envelope) {
          throw new Error(
            `evidenceRefs references unknown verification envelope id: ${ref.id} (no envelope with this id was recorded in session ${ctx.sessionID})`,
          )
        }
        if (envelope.workflow !== args.workflow) {
          throw new Error(
            `evidenceRefs verification id ${ref.id} belongs to workflow "${envelope.workflow}"; register_finding with workflow "${args.workflow}" only accepts matching verification evidence.`,
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
