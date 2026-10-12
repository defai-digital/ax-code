import z from "zod"
import { QualityStorageKey } from "../storage-key"
import { QualityPromotionReviewDossier } from "./promotion-review-dossier"
import { createPromotionArtifactStore } from "./artifact-store"
import { overallStatusFromGates, pushGateLines } from "./promotion-summary"
import { jsonEqual } from "../json"
import { compareStringFields, uniqueBy } from "../sort"

export namespace QualityPromotionBoardDecision {
  export const Disposition = z.enum(["approved", "held", "rejected"])
  export type Disposition = z.output<typeof Disposition>

  export const DecisionSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    reviewDossierStatus: z.enum(["pass", "fail"]),
    recommendation: z.lazy(() => QualityPromotionReviewDossier.Recommendation),
    requiredOverride: z.enum(["none", "allow_warn", "force"]),
    disposition: Disposition,
    overrideAccepted: z.boolean(),
    gates: z.array(
      z.object({
        name: z.string(),
        status: z.enum(["pass", "fail"]),
        detail: z.string(),
      }),
    ),
  })
  export type DecisionSummary = z.output<typeof DecisionSummary>

  export const DecisionArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-board-decision"),
    decisionID: z.string(),
    source: z.string(),
    decidedAt: z.string(),
    decider: z.string(),
    role: z.string().nullable(),
    team: z.string().nullable().default(null),
    reportingChain: z.string().nullable().default(null),
    disposition: Disposition,
    overrideAccepted: z.boolean(),
    rationale: z.string().nullable(),
    reviewDossier: z.lazy(() => QualityPromotionReviewDossier.DossierArtifact),
    summary: DecisionSummary,
  })
  export type DecisionArtifact = z.output<typeof DecisionArtifact>

  export const DecisionRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-board-decision-record"),
    decision: DecisionArtifact,
  })
  export type DecisionRecord = z.output<typeof DecisionRecord>

  const encode = QualityStorageKey.encode

  function sortDecisions(decisions: DecisionArtifact[]) {
    return [...decisions].sort((a, b) => compareStringFields(a, b, ["decidedAt", "decisionID"]))
  }

  const store = createPromotionArtifactStore<DecisionArtifact, DecisionRecord>({
    keyPrefix: "quality_model_board_decision",
    recordKind: "ax-code-quality-promotion-board-decision-record",
    artifactField: "decision",
    idField: "decisionID",
    noun: "Promotion board decision",
    recordSchema: DecisionRecord,
    sort: sortDecisions,
    parent: {
      append: (decision) => QualityPromotionReviewDossier.append(decision.reviewDossier),
      assertPersisted: (decision) => QualityPromotionReviewDossier.assertPersisted(decision.reviewDossier),
    },
  })

  function matchesDecisionBundle(
    decisionBundle: QualityPromotionReviewDossier.DossierArtifact["submissionBundle"]["decisionBundle"],
    decision: DecisionArtifact,
  ) {
    return (
      decision.reviewDossier.submissionBundle.decisionBundle.createdAt === decisionBundle.createdAt &&
      decision.reviewDossier.submissionBundle.decisionBundle.source === decisionBundle.source &&
      jsonEqual(decision.reviewDossier.submissionBundle.decisionBundle, decisionBundle)
    )
  }

  function evaluateSummary(input: {
    reviewDossier: QualityPromotionReviewDossier.DossierArtifact
    disposition: Disposition
    overrideAccepted: boolean
  }) {
    const requiredOverride = input.reviewDossier.summary.requiredOverride
    const gates = [
      {
        name: "review-dossier-readiness",
        status: input.reviewDossier.summary.overallStatus,
        detail:
          input.reviewDossier.summary.overallStatus === "pass"
            ? `review dossier ${input.reviewDossier.dossierID} is ready`
            : (input.reviewDossier.summary.gates.find((gate) => gate.status === "fail")?.detail ??
              "review dossier not ready"),
      },
      {
        name: "board-disposition",
        status: input.disposition === "approved" ? "pass" : "fail",
        detail:
          input.disposition === "approved"
            ? "board decision authorizes promotion"
            : `board decision marked promotion as ${input.disposition}`,
      },
      {
        name: "override-acknowledgement",
        status:
          requiredOverride === "none"
            ? input.overrideAccepted
              ? "fail"
              : "pass"
            : input.disposition !== "approved"
              ? "fail"
              : input.overrideAccepted
                ? "pass"
                : "fail",
        detail:
          requiredOverride === "none"
            ? input.overrideAccepted
              ? "override accepted even though no override is required"
              : "no override required"
            : input.disposition !== "approved"
              ? `required override ${requiredOverride} cannot be accepted because the board did not approve promotion`
              : input.overrideAccepted
                ? `board accepted required override ${requiredOverride}`
                : `required override ${requiredOverride} was not accepted by the board decision`,
      },
    ] as const

    return DecisionSummary.parse({
      overallStatus: overallStatusFromGates(gates),
      reviewDossierStatus: input.reviewDossier.summary.overallStatus,
      recommendation: input.reviewDossier.summary.recommendation,
      requiredOverride,
      disposition: input.disposition,
      overrideAccepted: input.overrideAccepted,
      gates,
    })
  }

  export function create(input: {
    reviewDossier: QualityPromotionReviewDossier.DossierArtifact
    decider: string
    role?: string | null
    team?: string | null
    reportingChain?: string | null
    disposition?: Disposition
    overrideAccepted?: boolean
    rationale?: string | null
  }) {
    const decidedAt = new Date().toISOString()
    const decisionID = `${Date.now()}-${encode(input.reviewDossier.source)}-${encode(input.decider)}-board-decision`
    const dossierReasons = QualityPromotionReviewDossier.verify(
      input.reviewDossier.submissionBundle.decisionBundle,
      input.reviewDossier,
    )
    if (dossierReasons.length > 0) {
      throw new Error(
        `Cannot create promotion board decision for ${input.reviewDossier.source}: invalid review dossier (${dossierReasons[0]})`,
      )
    }
    const disposition = input.disposition ?? "approved"
    const overrideAccepted = input.overrideAccepted ?? false
    const summary = evaluateSummary({
      reviewDossier: input.reviewDossier,
      disposition,
      overrideAccepted,
    })
    return DecisionArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-board-decision",
      decisionID,
      source: input.reviewDossier.source,
      decidedAt,
      decider: input.decider,
      role: input.role ?? null,
      team: input.team?.trim() || null,
      reportingChain: input.reportingChain?.trim() || null,
      disposition,
      overrideAccepted,
      rationale: input.rationale ?? null,
      reviewDossier: input.reviewDossier,
      summary,
    })
  }

  export function verify(
    decisionBundle: QualityPromotionReviewDossier.DossierArtifact["submissionBundle"]["decisionBundle"],
    decision: DecisionArtifact,
  ) {
    const reasons: string[] = []
    if (decision.source !== decisionBundle.source) {
      reasons.push(`board decision source mismatch: ${decision.source} vs ${decisionBundle.source}`)
    }
    if (!jsonEqual(decision.reviewDossier.submissionBundle.decisionBundle, decisionBundle)) {
      reasons.push(`board decision decision bundle mismatch for ${decisionBundle.source}`)
    }
    const dossierReasons = QualityPromotionReviewDossier.verify(decisionBundle, decision.reviewDossier)
    if (dossierReasons.length > 0) {
      reasons.push(`board decision review dossier mismatch for ${decisionBundle.source} (${dossierReasons[0]})`)
    }
    const expectedSummary = evaluateSummary({
      reviewDossier: decision.reviewDossier,
      disposition: decision.disposition,
      overrideAccepted: decision.overrideAccepted,
    })
    if (!jsonEqual(decision.summary, expectedSummary)) {
      reasons.push(`board decision summary mismatch for ${decisionBundle.source}`)
    }
    return reasons
  }

  export async function resolveForBundle(
    decisionBundle: QualityPromotionReviewDossier.DossierArtifact["submissionBundle"]["decisionBundle"],
    decisions: DecisionArtifact[] = [],
  ) {
    const persisted = (await list(decisionBundle.source)).filter((decision) =>
      matchesDecisionBundle(decisionBundle, decision),
    )
    const validDecisions = [...persisted, ...decisions].filter(
      (decision) => matchesDecisionBundle(decisionBundle, decision) && verify(decisionBundle, decision).length === 0,
    )
    return sortDecisions(uniqueBy(validDecisions, (decision) => decision.decisionID))
  }

  export async function get(input: { source: string; decisionID: string }) {
    return store.get({ source: input.source, id: input.decisionID })
  }

  export function append(decision: DecisionArtifact) {
    return store.append(decision)
  }

  export function list(source?: string) {
    return store.list(source)
  }

  export function assertPersisted(decision: DecisionArtifact) {
    return store.assertPersisted(decision)
  }

  export function renderReport(decision: DecisionArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion board decision")
    lines.push("")
    lines.push(`- source: ${decision.source}`)
    lines.push(`- decision id: ${decision.decisionID}`)
    lines.push(`- decided at: ${decision.decidedAt}`)
    lines.push(`- decider: ${decision.decider}`)
    lines.push(`- role: ${decision.role ?? "n/a"}`)
    lines.push(`- team: ${decision.team ?? "n/a"}`)
    lines.push(`- reporting chain: ${decision.reportingChain ?? "n/a"}`)
    lines.push(`- disposition: ${decision.disposition}`)
    lines.push(`- override accepted: ${decision.overrideAccepted}`)
    lines.push(`- rationale: ${decision.rationale ?? "n/a"}`)
    lines.push(`- review dossier id: ${decision.reviewDossier.dossierID}`)
    lines.push(`- recommendation: ${decision.summary.recommendation}`)
    lines.push(`- required override: ${decision.summary.requiredOverride}`)
    lines.push(`- overall status: ${decision.summary.overallStatus}`)
    lines.push("")
    pushGateLines(lines, decision.summary.gates)
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: DecisionSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion board decision summary")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- review dossier status: ${summary.reviewDossierStatus}`)
    lines.push(`- recommendation: ${summary.recommendation}`)
    lines.push(`- required override: ${summary.requiredOverride}`)
    lines.push(`- disposition: ${summary.disposition}`)
    lines.push(`- override accepted: ${summary.overrideAccepted}`)
    lines.push("")
    pushGateLines(lines, summary.gates)
    lines.push("")
    return lines.join("\n")
  }
}
