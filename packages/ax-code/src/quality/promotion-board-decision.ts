import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionReviewDossier } from "./promotion-review-dossier"

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
    gates: z.array(z.object({
      name: z.string(),
      status: z.enum(["pass", "fail"]),
      detail: z.string(),
    })),
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

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, decisionID: string) {
    return ["quality_model_board_decision", encode(source), decisionID]
  }

  function sortDecisions(decisions: DecisionArtifact[]) {
    return [...decisions].sort((a, b) => {
      const byDecidedAt = a.decidedAt.localeCompare(b.decidedAt)
      if (byDecidedAt !== 0) return byDecidedAt
      return a.decisionID.localeCompare(b.decisionID)
    })
  }

  function matchesDecisionBundle(
    decisionBundle: QualityPromotionReviewDossier.DossierArtifact["submissionBundle"]["decisionBundle"],
    decision: DecisionArtifact,
  ) {
    return (
      decision.reviewDossier.submissionBundle.decisionBundle.createdAt === decisionBundle.createdAt &&
      decision.reviewDossier.submissionBundle.decisionBundle.source === decisionBundle.source &&
      JSON.stringify(decision.reviewDossier.submissionBundle.decisionBundle) === JSON.stringify(decisionBundle)
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
        detail: input.reviewDossier.summary.overallStatus === "pass"
          ? `review dossier ${input.reviewDossier.dossierID} is ready`
          : input.reviewDossier.summary.gates.find((gate) => gate.status === "fail")?.detail ?? "review dossier not ready",
      },
      {
        name: "board-disposition",
        status: input.disposition === "approved" ? "pass" : "fail",
        detail: input.disposition === "approved"
          ? "board decision authorizes promotion"
          : `board decision marked promotion as ${input.disposition}`,
      },
      {
        name: "override-acknowledgement",
        status: requiredOverride === "none"
          ? input.overrideAccepted ? "fail" : "pass"
          : input.disposition !== "approved"
            ? "fail"
            : input.overrideAccepted ? "pass" : "fail",
        detail: requiredOverride === "none"
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
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
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
    if (JSON.stringify(decision.reviewDossier.submissionBundle.decisionBundle) !== JSON.stringify(decisionBundle)) {
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
    if (JSON.stringify(decision.summary) !== JSON.stringify(expectedSummary)) {
      reasons.push(`board decision summary mismatch for ${decisionBundle.source}`)
    }
    return reasons
  }

  export async function resolveForBundle(
    decisionBundle: QualityPromotionReviewDossier.DossierArtifact["submissionBundle"]["decisionBundle"],
    decisions: DecisionArtifact[] = [],
  ) {
    const persisted = (await list(decisionBundle.source)).filter((decision) => matchesDecisionBundle(decisionBundle, decision))
    const deduped = new Map<string, DecisionArtifact>()
    for (const decision of [...persisted, ...decisions]) {
      if (!matchesDecisionBundle(decisionBundle, decision)) continue
      if (verify(decisionBundle, decision).length > 0) continue
      deduped.set(decision.decisionID, decision)
    }
    return sortDecisions([...deduped.values()])
  }

  export async function get(input: { source: string; decisionID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.decisionID))
    return DecisionRecord.parse(record)
  }

  export async function append(decision: DecisionArtifact) {
    await QualityPromotionReviewDossier.append(decision.reviewDossier)
    const next = DecisionRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-board-decision-record",
      decision,
    })
    try {
      const existing = await get({ source: decision.source, decisionID: decision.decisionID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(`Promotion board decision ${decision.decisionID} already exists for source ${decision.source} with different content`)
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(decision.source, decision.decisionID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_board_decision", encode(source)]] : [["quality_model_board_decision"]]
    const decisions: DecisionArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const decisionID = parts[parts.length - 1]
        if (!encodedSource || !decisionID) continue
        const record = await get({ source: decode(encodedSource), decisionID })
        decisions.push(record.decision)
      }
    }

    return sortDecisions(decisions)
  }

  export async function assertPersisted(decision: DecisionArtifact) {
    await QualityPromotionReviewDossier.assertPersisted(decision.reviewDossier)
    const persisted = await get({ source: decision.source, decisionID: decision.decisionID })
    const prev = JSON.stringify(persisted.decision)
    const curr = JSON.stringify(decision)
    if (prev !== curr) {
      throw new Error(`Persisted promotion board decision ${decision.decisionID} does not match the provided artifact`)
    }
    return persisted
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
    for (const gate of decision.summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
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
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
