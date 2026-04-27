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
