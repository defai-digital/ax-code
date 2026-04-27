import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionBoardDecision } from "./promotion-board-decision"

export namespace QualityPromotionReleaseDecisionRecord {
  export const PromotionMode = z.enum(["pass", "warn_override", "force"])
  export type PromotionMode = z.output<typeof PromotionMode>

  export const RecordSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    boardDecisionStatus: z.enum(["pass", "fail"]),
    recommendation: z.lazy(() => QualityPromotionBoardDecision.DecisionSummary.shape.recommendation),
    requiredOverride: z.enum(["none", "allow_warn", "force"]),
    disposition: z.lazy(() => QualityPromotionBoardDecision.Disposition),
    overrideAccepted: z.boolean(),
    authorizedPromotion: z.boolean(),
    promotionMode: PromotionMode,
    gates: z.array(
      z.object({
        name: z.string(),
        status: z.enum(["pass", "fail"]),
        detail: z.string(),
      }),
    ),
  })
  export type RecordSummary = z.output<typeof RecordSummary>

  export const RecordArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-release-decision-record"),
    recordID: z.string(),
    source: z.string(),
    recordedAt: z.string(),
    boardDecision: z.lazy(() => QualityPromotionBoardDecision.DecisionArtifact),
    summary: RecordSummary,
  })
  export type RecordArtifact = z.output<typeof RecordArtifact>

  export const StoredRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-release-decision-record-record"),
    record: RecordArtifact,
  })
  export type StoredRecord = z.output<typeof StoredRecord>

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, recordID: string) {
    return ["quality_model_release_decision_record", encode(source), recordID]
  }

  function sortRecords(records: RecordArtifact[]) {
    return [...records].sort((a, b) => {
      const byRecordedAt = a.recordedAt.localeCompare(b.recordedAt)
      if (byRecordedAt !== 0) return byRecordedAt
      return a.recordID.localeCompare(b.recordID)
    })
  }

  function matchesDecisionBundle(
    decisionBundle: QualityPromotionBoardDecision.DecisionArtifact["reviewDossier"]["submissionBundle"]["decisionBundle"],
    record: RecordArtifact,
  ) {
    return (
      record.boardDecision.reviewDossier.submissionBundle.decisionBundle.createdAt === decisionBundle.createdAt &&
      record.boardDecision.reviewDossier.submissionBundle.decisionBundle.source === decisionBundle.source &&
      JSON.stringify(record.boardDecision.reviewDossier.submissionBundle.decisionBundle) ===
        JSON.stringify(decisionBundle)
    )
  }

  function expectedPromotionMode(boardDecision: QualityPromotionBoardDecision.DecisionArtifact): PromotionMode {
    if (boardDecision.summary.requiredOverride === "force") return "force"
    if (boardDecision.summary.requiredOverride === "allow_warn") return "warn_override"
    return "pass"
  }

  function evaluateSummary(boardDecision: QualityPromotionBoardDecision.DecisionArtifact) {
    const promotionMode = expectedPromotionMode(boardDecision)
    const authorizedPromotion =
      boardDecision.disposition !== "approved"
        ? false
        : boardDecision.summary.requiredOverride === "none"
          ? !boardDecision.overrideAccepted
          : boardDecision.overrideAccepted

    const gates = [
      {
        name: "board-decision-readiness",
        status: boardDecision.summary.overallStatus,
        detail:
          boardDecision.summary.overallStatus === "pass"
            ? `board decision ${boardDecision.decisionID} is ready`
            : (boardDecision.summary.gates.find((gate) => gate.status === "fail")?.detail ??
              "board decision not ready"),
      },
      {
        name: "promotion-authorization",
        status: boardDecision.disposition === "approved" ? "pass" : "fail",
        detail:
          boardDecision.disposition === "approved"
            ? "board decision authorizes release promotion"
            : `board decision disposition is ${boardDecision.disposition}`,
      },
      {
        name: "override-mode",
        status: authorizedPromotion ? "pass" : "fail",
        detail: authorizedPromotion
          ? `release decision authorizes promotion mode ${promotionMode}`
          : boardDecision.summary.requiredOverride === "none"
            ? "release decision must not accept an override when none is required"
            : `release decision did not accept required override ${boardDecision.summary.requiredOverride}`,
      },
    ] as const

    return RecordSummary.parse({
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
      boardDecisionStatus: boardDecision.summary.overallStatus,
      recommendation: boardDecision.summary.recommendation,
      requiredOverride: boardDecision.summary.requiredOverride,
      disposition: boardDecision.disposition,
      overrideAccepted: boardDecision.overrideAccepted,
      authorizedPromotion,
      promotionMode,
      gates,
    })
  }

  export function create(input: { boardDecision: QualityPromotionBoardDecision.DecisionArtifact }) {
    const recordedAt = new Date().toISOString()
    const recordID = `${Date.now()}-${encode(input.boardDecision.source)}-release-decision-record`
    const decisionReasons = QualityPromotionBoardDecision.verify(
      input.boardDecision.reviewDossier.submissionBundle.decisionBundle,
      input.boardDecision,
    )
    if (decisionReasons.length > 0) {
      throw new Error(
        `Cannot create promotion release decision record for ${input.boardDecision.source}: invalid board decision (${decisionReasons[0]})`,
      )
    }
    const summary = evaluateSummary(input.boardDecision)
    return RecordArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-release-decision-record",
      recordID,
      source: input.boardDecision.source,
      recordedAt,
      boardDecision: input.boardDecision,
      summary,
    })
  }

  export function verify(
    decisionBundle: QualityPromotionBoardDecision.DecisionArtifact["reviewDossier"]["submissionBundle"]["decisionBundle"],
    record: RecordArtifact,
  ) {
    const reasons: string[] = []
    if (record.source !== decisionBundle.source) {
      reasons.push(`release decision record source mismatch: ${record.source} vs ${decisionBundle.source}`)
    }
    if (
      JSON.stringify(record.boardDecision.reviewDossier.submissionBundle.decisionBundle) !==
      JSON.stringify(decisionBundle)
    ) {
      reasons.push(`release decision record decision bundle mismatch for ${decisionBundle.source}`)
    }
    const decisionReasons = QualityPromotionBoardDecision.verify(decisionBundle, record.boardDecision)
    if (decisionReasons.length > 0) {
      reasons.push(
        `release decision record board decision mismatch for ${decisionBundle.source} (${decisionReasons[0]})`,
      )
    }
    const expectedSummary = evaluateSummary(record.boardDecision)
    if (JSON.stringify(record.summary) !== JSON.stringify(expectedSummary)) {
      reasons.push(`release decision record summary mismatch for ${decisionBundle.source}`)
    }
    return reasons
  }

  export async function resolveForBundle(
    decisionBundle: QualityPromotionBoardDecision.DecisionArtifact["reviewDossier"]["submissionBundle"]["decisionBundle"],
    records: RecordArtifact[] = [],
  ) {
    const persisted = (await list(decisionBundle.source)).filter((record) =>
      matchesDecisionBundle(decisionBundle, record),
    )
    const deduped = new Map<string, RecordArtifact>()
    for (const record of [...persisted, ...records]) {
      if (!matchesDecisionBundle(decisionBundle, record)) continue
      if (verify(decisionBundle, record).length > 0) continue
      deduped.set(record.recordID, record)
    }
    return sortRecords([...deduped.values()])
  }

  export async function get(input: { source: string; recordID: string }) {
    const stored = await Storage.read<unknown>(key(input.source, input.recordID))
    return StoredRecord.parse(stored)
  }

  export async function append(record: RecordArtifact) {
    await QualityPromotionBoardDecision.append(record.boardDecision)
    const next = StoredRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-release-decision-record-record",
      record,
    })
    try {
      const existing = await get({ source: record.source, recordID: record.recordID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(
        `Promotion release decision record ${record.recordID} already exists for source ${record.source} with different content`,
      )
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(record.source, record.recordID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source
      ? [["quality_model_release_decision_record", encode(source)]]
      : [["quality_model_release_decision_record"]]
    const records: RecordArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const recordID = parts[parts.length - 1]
        if (!encodedSource || !recordID) continue
        const stored = await get({ source: decode(encodedSource), recordID })
        records.push(stored.record)
      }
    }

    return sortRecords(records)
  }

  export async function assertPersisted(record: RecordArtifact) {
    await QualityPromotionBoardDecision.assertPersisted(record.boardDecision)
    const persisted = await get({ source: record.source, recordID: record.recordID })
    const prev = JSON.stringify(persisted.record)
    const curr = JSON.stringify(record)
    if (prev !== curr) {
      throw new Error(
        `Persisted promotion release decision record ${record.recordID} does not match the provided artifact`,
      )
    }
    return persisted
  }

  export function renderReport(record: RecordArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion release decision record")
    lines.push("")
    lines.push(`- source: ${record.source}`)
    lines.push(`- record id: ${record.recordID}`)
    lines.push(`- recorded at: ${record.recordedAt}`)
    lines.push(`- board decision id: ${record.boardDecision.decisionID}`)
    lines.push(`- decider: ${record.boardDecision.decider}`)
    lines.push(`- recommendation: ${record.summary.recommendation}`)
    lines.push(`- required override: ${record.summary.requiredOverride}`)
    lines.push(`- disposition: ${record.summary.disposition}`)
    lines.push(`- override accepted: ${record.summary.overrideAccepted}`)
    lines.push(`- authorized promotion: ${record.summary.authorizedPromotion}`)
    lines.push(`- promotion mode: ${record.summary.promotionMode}`)
    lines.push(`- overall status: ${record.summary.overallStatus}`)
    lines.push("")
    for (const gate of record.summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: RecordSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion release decision summary")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- board decision status: ${summary.boardDecisionStatus}`)
    lines.push(`- recommendation: ${summary.recommendation}`)
    lines.push(`- required override: ${summary.requiredOverride}`)
    lines.push(`- disposition: ${summary.disposition}`)
    lines.push(`- override accepted: ${summary.overrideAccepted}`)
    lines.push(`- authorized promotion: ${summary.authorizedPromotion}`)
    lines.push(`- promotion mode: ${summary.promotionMode}`)
    lines.push("")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
