import fs from "fs/promises"
import path from "path"
import { Instance } from "../src/project/instance"
import { SessionID } from "../src/session/schema"
import { QualityCalibrationModel } from "../src/quality/calibration-model"
import { QualityPromotionAdoptionDissentHandling } from "../src/quality/promotion-adoption-dissent-handling"
import { QualityPromotionAdoptionDissentResolution } from "../src/quality/promotion-adoption-dissent-resolution"
import { QualityPromotionAdoptionDissentSupersession } from "../src/quality/promotion-adoption-dissent-supersession"
import { QualityPromotionAdoptionReview } from "../src/quality/promotion-adoption-review"
import { QualityPromotionArchiveManifest } from "../src/quality/promotion-archive-manifest"
import { QualityPromotionAuditManifest } from "../src/quality/promotion-audit-manifest"
import { QualityPromotionBoardDecision } from "../src/quality/promotion-board-decision"
import { QualityPromotionApprovalPacket } from "../src/quality/promotion-approval-packet"
import { QualityPromotionApproval } from "../src/quality/promotion-approval"
import { QualityPromotionApprovalPolicy } from "../src/quality/promotion-approval-policy"
import { QualityPromotionApprovalPolicyStore } from "../src/quality/promotion-approval-policy-store"
import { QualityPromotionDecisionBundle } from "../src/quality/promotion-decision-bundle"
import { QualityPromotionExportBundle } from "../src/quality/promotion-export-bundle"
import { QualityPromotionHandoffPackage } from "../src/quality/promotion-handoff-package"
import { QualityModelRegistry } from "../src/quality/model-registry"
import { QualityPromotionEligibility } from "../src/quality/promotion-eligibility"
import { QualityPromotionPortableExport } from "../src/quality/promotion-portable-export"
import { QualityPromotionPackagedArchive } from "../src/quality/promotion-packaged-archive"
import { QualityPromotionReleasePolicy } from "../src/quality/promotion-release-policy"
import { QualityPromotionReleaseDecisionRecord } from "../src/quality/promotion-release-decision-record"
import { QualityPromotionReleasePacket } from "../src/quality/promotion-release-packet"
import { QualityPromotionReleasePolicyStore } from "../src/quality/promotion-release-policy-store"
import { QualityPromotionReviewDossier } from "../src/quality/promotion-review-dossier"
import { QualityPromotionSignedArchive } from "../src/quality/promotion-signed-archive"
import { QualityPromotionSignedArchiveAttestationPolicy } from "../src/quality/promotion-signed-archive-attestation-policy"
import { QualityPromotionSignedArchiveAttestationPolicyStore } from "../src/quality/promotion-signed-archive-attestation-policy-store"
import { QualityPromotionSignedArchiveAttestationPacket } from "../src/quality/promotion-signed-archive-attestation-packet"
import { QualityPromotionSignedArchiveAttestationRecord } from "../src/quality/promotion-signed-archive-attestation-record"
import { QualityPromotionSignedArchiveGovernancePacket } from "../src/quality/promotion-signed-archive-governance-packet"
import { QualityPromotionSignedArchiveReviewDossier } from "../src/quality/promotion-signed-archive-review-dossier"
import { QualityPromotionSignedArchiveTrust } from "../src/quality/promotion-signed-archive-trust"
import { QualityPromotionSubmissionBundle } from "../src/quality/promotion-submission-bundle"
import { QualityPromotionWatch } from "../src/quality/promotion-watch"
import { QualityReentryContext } from "../src/quality/reentry-context"
import { QualityReentryRemediation } from "../src/quality/reentry-remediation"
import { ProbabilisticRollout } from "../src/quality/probabilistic-rollout"
import { QualityLabelStore } from "../src/quality/label-store"
import { QualityRollbackAdvisor } from "../src/quality/rollback-advisor"
import { QualityShadowStore } from "../src/quality/shadow-store"
import { QualityStabilityGuard } from "../src/quality/stability-guard"

function arg(name: string) {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return
  const next = process.argv[idx + 1]
  if (!next || next.startsWith("--")) throw new Error(`Missing value for ${name}`)
  return next
}

function argsMany(name: string) {
  const values: string[] = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] !== name) continue
    const next = process.argv[i + 1]
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${name}`)
    values.push(next)
  }
  return values
}

function hasArg(name: string) {
  return process.argv.includes(name)
}

function policyScope(defaultScope: "resolved" | QualityPromotionApprovalPolicyStore.Scope = "resolved") {
  const scope = arg("--scope") ?? defaultScope
  if (scope !== "resolved" && scope !== "global" && scope !== "project") {
    throw new Error(`Unsupported --scope ${scope}`)
  }
  return scope
}

async function readJson<T>(file: string) {
  return JSON.parse(await Bun.file(file).text()) as T
}

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, content.endsWith("\n") ? content : content + "\n")
}

async function resolveArchiveSigningInputForCLI() {
  const attestedBy = arg("--archive-attestor")
  const keyID = arg("--archive-key-id")
  const keyEnv = arg("--archive-signing-key-env")
  const keyFile = arg("--archive-signing-key-file")
  const hasAny = !!attestedBy || !!keyID || !!keyEnv || !!keyFile

  if (!hasAny) return
  if (!attestedBy) throw new Error("--archive-attestor is required when archive signing is requested")
  if (!keyID) throw new Error("--archive-key-id is required when archive signing is requested")
  if ((keyEnv && keyFile) || (!keyEnv && !keyFile)) {
    throw new Error("Provide exactly one of --archive-signing-key-env or --archive-signing-key-file")
  }
  if (keyEnv) {
    const value = process.env[keyEnv]
    if (!value) throw new Error(`Archive signing key environment variable ${keyEnv} is not set`)
    return {
      attestedBy,
      keyID,
      keySource: "env" as const,
      keyLocator: keyEnv,
      keyMaterial: value,
    }
  }
  const resolvedFile = path.resolve(process.cwd(), keyFile!)
  const value = (await fs.readFile(resolvedFile, "utf8")).trimEnd()
  if (!value) throw new Error(`Archive signing key file ${resolvedFile} is empty`)
  return {
    attestedBy,
    keyID,
    keySource: "file" as const,
    keyLocator: resolvedFile,
    keyMaterial: value,
  }
}

async function exportMode() {
  const workflow = ProbabilisticRollout.Workflow.parse(arg("--workflow") ?? "review")
  const sessionIDs = argsMany("--session")
  if (sessionIDs.length === 0) throw new Error("At least one --session value is required for export mode")

  const out = path.resolve(process.cwd(), arg("--out") ?? `.tmp/quality-${workflow}-replay.json`)
  const exports = await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      const items: ProbabilisticRollout.ReplayExport[] = []
      for (const sessionID of sessionIDs) {
        items.push(await ProbabilisticRollout.exportReplay(SessionID.make(sessionID), workflow))
      }
      return items
    },
  })

  await write(out, JSON.stringify(exports, null, 2))
  console.log(`Exported ${exports.length} replay package(s) to ${out}`)
}

async function replayReadinessMode() {
  const workflow = ProbabilisticRollout.Workflow.parse(arg("--workflow") ?? "review")
  const sessionIDs = argsMany("--session")
  if (sessionIDs.length === 0) throw new Error("At least one --session value is required for replay-readiness mode")

  const summaries = await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      const out: ProbabilisticRollout.ReplayReadinessSummary[] = []
      for (const sessionID of sessionIDs) {
        const replay = await ProbabilisticRollout.exportReplay(SessionID.make(sessionID), workflow)
        const labels = await QualityLabelStore.list(sessionID, workflow)
        out.push(ProbabilisticRollout.summarizeReplayReadiness({ replay, labels }))
      }
      return out
    },
  })

  const file = ProbabilisticRollout.ReplayReadinessFile.parse({
    schemaVersion: 1,
    kind: "ax-code-quality-replay-readiness-file",
    workflow,
    generatedAt: new Date().toISOString(),
    summaries,
  })
  const out = path.resolve(process.cwd(), arg("--out") ?? `.tmp/quality-${workflow}-replay-readiness.json`)
  await write(out, JSON.stringify(file, null, 2))

  if (file.summaries.length === 1) {
    console.log(ProbabilisticRollout.renderReplayReadinessReport(file.summaries[0]!))
    return
  }

  for (const summary of file.summaries) {
    console.log(
      `${summary.sessionID} · workflow=${summary.workflow} · overall=${summary.overallStatus} · ready=${summary.readyForBenchmark} · next=${summary.nextAction ?? "none"}`,
    )
  }
}

function flattenReplay(input: unknown) {
  const array = Array.isArray(input) ? input : [input]
  const exports = array.map((item) => ProbabilisticRollout.ReplayExport.parse(item))
  return exports.flatMap((item) => item.items)
}

async function loadPredictionFile(file: string) {
  return ProbabilisticRollout.PredictionFile.parse(await readJson<unknown>(path.resolve(process.cwd(), file)))
}

async function loadModelFile(file: string) {
  return QualityCalibrationModel.ModelFile.parse(await readJson<unknown>(path.resolve(process.cwd(), file)))
}

async function loadBenchmarkBundle(file: string) {
  return QualityCalibrationModel.BenchmarkBundle.parse(await readJson<unknown>(path.resolve(process.cwd(), file)))
}

async function loadDecisionBundle(file: string) {
  return QualityPromotionDecisionBundle.DecisionBundle.parse(await readJson<unknown>(path.resolve(process.cwd(), file)))
}

async function loadApprovalArtifact(file: string) {
  return QualityPromotionApproval.ApprovalArtifact.parse(await readJson<unknown>(path.resolve(process.cwd(), file)))
}

async function loadAdoptionReviewArtifact(file: string) {
  return QualityPromotionAdoptionReview.ReviewArtifact.parse(await readJson<unknown>(path.resolve(process.cwd(), file)))
}

async function loadAdoptionDissentResolutionArtifact(file: string) {
  return QualityPromotionAdoptionDissentResolution.ResolutionArtifact.parse(
    await readJson<unknown>(path.resolve(process.cwd(), file)),
  )
}

async function loadAdoptionDissentSupersessionArtifact(file: string) {
  return QualityPromotionAdoptionDissentSupersession.SupersessionArtifact.parse(
    await readJson<unknown>(path.resolve(process.cwd(), file)),
  )
}

async function loadAdoptionDissentHandlingArtifact(file: string) {
  return QualityPromotionAdoptionDissentHandling.HandlingArtifact.parse(
    await readJson<unknown>(path.resolve(process.cwd(), file)),
  )
}

async function loadApprovalPacketArtifact(file: string) {
  return QualityPromotionApprovalPacket.PacketArtifact.parse(await readJson<unknown>(path.resolve(process.cwd(), file)))
}

async function loadSubmissionBundleArtifact(file: string) {
  return QualityPromotionSubmissionBundle.BundleArtifact.parse(
    await readJson<unknown>(path.resolve(process.cwd(), file)),
  )
}

async function loadReviewDossierArtifact(file: string) {
  return QualityPromotionReviewDossier.DossierArtifact.parse(await readJson<unknown>(path.resolve(process.cwd(), file)))
}

async function loadBoardDecisionArtifact(file: string) {
  return QualityPromotionBoardDecision.DecisionArtifact.parse(
    await readJson<unknown>(path.resolve(process.cwd(), file)),
  )
}

async function loadReleaseDecisionRecordArtifact(file: string) {
  return QualityPromotionReleaseDecisionRecord.RecordArtifact.parse(
    await readJson<unknown>(path.resolve(process.cwd(), file)),
  )
}

async function loadReleasePacketArtifact(file: string) {
  return QualityPromotionReleasePacket.PacketArtifact.parse(await readJson<unknown>(path.resolve(process.cwd(), file)))
}

export namespace QualityRolloutProjectScope {
  export function normalize(projectID: string | null | undefined) {
    const trimmed = projectID?.trim()
    return trimmed ? trimmed : null
  }

  export function reconcile(input: { explicitProjectID?: string | null; artifactProjectID?: string | null }) {
    const explicitProjectID = normalize(input.explicitProjectID)
    const artifactProjectID = normalize(input.artifactProjectID)
    if (explicitProjectID && artifactProjectID && explicitProjectID !== artifactProjectID) {
      throw new Error(
        `Explicit --project-id ${explicitProjectID} does not match artifact project id ${artifactProjectID}`,
      )
    }
    return explicitProjectID ?? artifactProjectID ?? null
  }

  export function fromDecisionBundle(bundle: QualityPromotionDecisionBundle.DecisionBundle) {
    return normalize(bundle.releasePolicy?.provenance.policyProjectID)
  }

  export function fromSubmissionBundle(bundle: QualityPromotionSubmissionBundle.BundleArtifact) {
    return fromDecisionBundle(bundle.decisionBundle)
  }

  export function fromReviewDossier(dossier: QualityPromotionReviewDossier.DossierArtifact) {
    return fromSubmissionBundle(dossier.submissionBundle)
  }

  export function fromBoardDecision(decision: QualityPromotionBoardDecision.DecisionArtifact) {
    return fromReviewDossier(decision.reviewDossier)
  }

  export function fromReleaseDecisionRecord(record: QualityPromotionReleaseDecisionRecord.RecordArtifact) {
    return fromBoardDecision(record.boardDecision)
  }

  export function fromReleasePacket(packet: QualityPromotionReleasePacket.PacketArtifact) {
    return fromReleaseDecisionRecord(packet.releaseDecisionRecord)
  }

  export function fromPromotionRecord(record: QualityModelRegistry.PromotionRecord) {
    return (
      normalize(record.signedArchiveAttestation?.policyProjectID) ??
      normalize(record.signedArchiveAttestationRecord?.policyProjectID) ??
      normalize(record.signedArchiveAttestationPacket?.policyProjectID) ??
      normalize(record.signedArchiveGovernancePacket?.policyProjectID) ??
      normalize(record.signedArchiveReviewDossier?.policyProjectID) ??
      normalize(record.signedArchiveTrust?.resolution.projectID) ??
      normalize(record.releasePolicy?.policyProjectID)
    )
  }
}

async function loadAuditManifestArtifact(file: string) {
  return QualityPromotionAuditManifest.ManifestArtifact.parse(
    await readJson<unknown>(path.resolve(process.cwd(), file)),
  )
}

async function loadArchiveManifestArtifact(file: string) {
  return QualityPromotionArchiveManifest.ArchiveArtifact.parse(
    await readJson<unknown>(path.resolve(process.cwd(), file)),
  )
}

async function loadExportBundleArtifact(file: string) {
  return QualityPromotionExportBundle.ExportArtifact.parse(await readJson<unknown>(path.resolve(process.cwd(), file)))
}

async function loadHandoffPackageArtifact(file: string) {
  return QualityPromotionHandoffPackage.PackageArtifact.parse(
    await readJson<unknown>(path.resolve(process.cwd(), file)),
  )
}

async function loadPortableExportArtifact(file: string) {
  return QualityPromotionPortableExport.ExportArtifact.parse(await readJson<unknown>(path.resolve(process.cwd(), file)))
}

async function loadPackagedArchiveArtifact(file: string) {
  return QualityPromotionPackagedArchive.ArchiveArtifact.parse(
    await readJson<unknown>(path.resolve(process.cwd(), file)),
  )
}

async function loadSignedArchiveArtifact(file: string) {
  return QualityPromotionSignedArchive.ArchiveArtifact.parse(await readJson<unknown>(path.resolve(process.cwd(), file)))
}

async function loadSignedArchiveAttestationRecordArtifact(file: string) {
  return QualityPromotionSignedArchiveAttestationRecord.RecordArtifact.parse(
    await readJson<unknown>(path.resolve(process.cwd(), file)),
  )
}

async function loadSignedArchiveAttestationPacketArtifact(file: string) {
  return QualityPromotionSignedArchiveAttestationPacket.PacketArtifact.parse(
    await readJson<unknown>(path.resolve(process.cwd(), file)),
  )
}

async function loadSignedArchiveGovernancePacketArtifact(file: string) {
  return QualityPromotionSignedArchiveGovernancePacket.PacketArtifact.parse(
    await readJson<unknown>(path.resolve(process.cwd(), file)),
  )
}

async function loadSignedArchiveReviewDossierArtifact(file: string) {
  return QualityPromotionSignedArchiveReviewDossier.DossierArtifact.parse(
    await readJson<unknown>(path.resolve(process.cwd(), file)),
  )
}

async function loadSignedArchiveTrustArtifact(file: string) {
  return QualityPromotionSignedArchiveTrust.TrustArtifact.parse(
    await readJson<unknown>(path.resolve(process.cwd(), file)),
  )
}

async function resolveApprovalPacketForDecisionBundle(
  decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
  explicitArtifacts?: QualityPromotionApprovalPacket.PacketArtifact[],
) {
  const approvals = await QualityPromotionApprovalPacket.resolveApprovalsForBundle(
    decisionBundle,
    await Promise.all(argsMany("--approval").map((approvalFile) => loadApprovalArtifact(approvalFile))),
  )
  const adoptionReviews = await QualityPromotionAdoptionReview.resolveForBundle(
    decisionBundle,
    await Promise.all(argsMany("--adoption-review").map((reviewFile) => loadAdoptionReviewArtifact(reviewFile))),
  )
  const dissentHandling = (
    await QualityPromotionAdoptionDissentHandling.resolveForBundle(
      decisionBundle,
      adoptionReviews,
      await Promise.all(
        argsMany("--dissent-handling").map((handlingFile) => loadAdoptionDissentHandlingArtifact(handlingFile)),
      ),
    )
  ).at(-1)

  return (
    (
      await QualityPromotionApprovalPacket.resolveForBundle(
        decisionBundle,
        explicitArtifacts ??
          (await Promise.all(
            argsMany("--approval-packet").map((packetFile) => loadApprovalPacketArtifact(packetFile)),
          )),
      )
    ).at(-1) ??
    QualityPromotionApprovalPacket.create({
      bundle: decisionBundle,
      approvals,
      adoptionReviews,
      dissentHandling,
    })
  )
}

async function resolveSubmissionBundleForDecisionBundle(
  decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
  explicitArtifacts?: QualityPromotionSubmissionBundle.BundleArtifact[],
) {
  return (
    (
      await QualityPromotionSubmissionBundle.resolveForBundle(
        decisionBundle,
        explicitArtifacts ??
          (await Promise.all(
            argsMany("--submission-bundle").map((submissionFile) => loadSubmissionBundleArtifact(submissionFile)),
          )),
      )
    ).at(-1) ??
    QualityPromotionSubmissionBundle.create({
      decisionBundle,
      approvalPacket: await resolveApprovalPacketForDecisionBundle(decisionBundle),
    })
  )
}

async function resolveReviewDossierForDecisionBundle(
  decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
  explicitArtifacts?: QualityPromotionReviewDossier.DossierArtifact[],
) {
  return (
    (
      await QualityPromotionReviewDossier.resolveForBundle(
        decisionBundle,
        explicitArtifacts ??
          (await Promise.all(
            argsMany("--review-dossier").map((dossierFile) => loadReviewDossierArtifact(dossierFile)),
          )),
      )
    ).at(-1) ??
    QualityPromotionReviewDossier.create({
      submissionBundle: await resolveSubmissionBundleForDecisionBundle(decisionBundle),
    })
  )
}

function boardDispositionArg() {
  const raw = arg("--disposition") ?? "approved"
  return QualityPromotionBoardDecision.Disposition.parse(raw)
}

function createBoardDecisionFromDossier(reviewDossier: QualityPromotionReviewDossier.DossierArtifact) {
  const decider = arg("--decider")
  if (!decider) throw new Error("--decider is required to create a board decision artifact")
  return QualityPromotionBoardDecision.create({
    reviewDossier,
    decider,
    role: arg("--role") ?? null,
    team: arg("--team") ?? null,
    reportingChain: arg("--reporting-chain") ?? null,
    disposition: boardDispositionArg(),
    overrideAccepted: hasArg("--override-accepted"),
    rationale: arg("--rationale") ?? null,
  })
}

async function resolveBoardDecisionForDecisionBundle(
  decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
  explicitArtifacts?: QualityPromotionBoardDecision.DecisionArtifact[],
) {
  return (
    (
      await QualityPromotionBoardDecision.resolveForBundle(
        decisionBundle,
        explicitArtifacts ??
          (await Promise.all(
            argsMany("--board-decision").map((decisionFile) => loadBoardDecisionArtifact(decisionFile)),
          )),
      )
    ).at(-1) ?? createBoardDecisionFromDossier(await resolveReviewDossierForDecisionBundle(decisionBundle))
  )
}

async function resolveReleaseDecisionRecordForDecisionBundle(
  decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
  explicitArtifacts?: QualityPromotionReleaseDecisionRecord.RecordArtifact[],
) {
  return (
    (
      await QualityPromotionReleaseDecisionRecord.resolveForBundle(
        decisionBundle,
        explicitArtifacts ??
          (await Promise.all(
            argsMany("--release-decision-record").map((recordFile) => loadReleaseDecisionRecordArtifact(recordFile)),
          )),
      )
    ).at(-1) ??
    QualityPromotionReleaseDecisionRecord.create({
      boardDecision: await resolveBoardDecisionForDecisionBundle(decisionBundle),
    })
  )
}

async function resolveReleasePacketForDecisionBundle(
  decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
  explicitArtifacts?: QualityPromotionReleasePacket.PacketArtifact[],
) {
  return (
    (
      await QualityPromotionReleasePacket.resolveForBundle(
        decisionBundle,
        explicitArtifacts ??
          (await Promise.all(argsMany("--release-packet").map((packetFile) => loadReleasePacketArtifact(packetFile)))),
      )
    ).at(-1) ??
    QualityPromotionReleasePacket.create({
      releaseDecisionRecord: await resolveReleaseDecisionRecordForDecisionBundle(decisionBundle),
    })
  )
}

async function resolveReleasePacketForPromotion(
  promotion: QualityModelRegistry.PromotionRecord,
  explicitArtifacts?: QualityPromotionReleasePacket.PacketArtifact[],
) {
  const explicit =
    explicitArtifacts ??
    (await Promise.all(argsMany("--release-packet").map((packetFile) => loadReleasePacketArtifact(packetFile))))
  const resolved = explicit.length > 0 ? explicit : await QualityPromotionReleasePacket.list(promotion.source)
  const packetID = promotion.releasePacket?.packetID
  if (!packetID) {
    throw new Error(`Promotion ${promotion.promotionID} does not include release packet provenance`)
  }
  const match = resolved.find((packet) => packet.packetID === packetID)
  if (!match) {
    throw new Error(`Could not resolve release packet ${packetID} for promotion ${promotion.promotionID}`)
  }
  return match
}

async function resolveAuditManifestForPromotion(
  promotion: QualityModelRegistry.PromotionRecord,
  explicitArtifacts?: QualityPromotionAuditManifest.ManifestArtifact[],
) {
  return (
    (
      await QualityPromotionAuditManifest.resolveForPromotion(
        QualityPromotionAuditManifest.PromotionSnapshot.parse({
          promotionID: promotion.promotionID,
          source: promotion.source,
          promotedAt: promotion.promotedAt,
          previousActiveSource: promotion.previousActiveSource,
          decision: promotion.decision,
          decisionBundleCreatedAt: promotion.decisionBundleCreatedAt ?? null,
          boardDecision: promotion.boardDecision,
          releaseDecisionRecord: promotion.releaseDecisionRecord,
          releasePacket: promotion.releasePacket,
          reviewDossier: promotion.reviewDossier,
          submissionBundle: promotion.submissionBundle,
          approvalPacket: promotion.approvalPacket,
        }),
        explicitArtifacts ??
          (await Promise.all(
            argsMany("--audit-manifest").map((manifestFile) => loadAuditManifestArtifact(manifestFile)),
          )),
      )
    ).at(-1) ??
    QualityPromotionAuditManifest.create({
      releasePacket: await resolveReleasePacketForPromotion(promotion),
      promotion: QualityPromotionAuditManifest.PromotionSnapshot.parse({
        promotionID: promotion.promotionID,
        source: promotion.source,
        promotedAt: promotion.promotedAt,
        previousActiveSource: promotion.previousActiveSource,
        decision: promotion.decision,
        decisionBundleCreatedAt: promotion.decisionBundleCreatedAt ?? null,
        boardDecision: promotion.boardDecision,
        releaseDecisionRecord: promotion.releaseDecisionRecord,
        releasePacket: promotion.releasePacket,
        reviewDossier: promotion.reviewDossier,
        submissionBundle: promotion.submissionBundle,
        approvalPacket: promotion.approvalPacket,
      }),
    })
  )
}

async function resolveExportBundleForPromotion(
  promotion: QualityModelRegistry.PromotionRecord,
  explicitArtifacts?: QualityPromotionExportBundle.ExportArtifact[],
) {
  return (
    (
      await QualityPromotionExportBundle.resolveForPromotion(
        QualityPromotionAuditManifest.PromotionSnapshot.parse({
          promotionID: promotion.promotionID,
          source: promotion.source,
          promotedAt: promotion.promotedAt,
          previousActiveSource: promotion.previousActiveSource,
          decision: promotion.decision,
          decisionBundleCreatedAt: promotion.decisionBundleCreatedAt ?? null,
          boardDecision: promotion.boardDecision,
          releaseDecisionRecord: promotion.releaseDecisionRecord,
          releasePacket: promotion.releasePacket,
          reviewDossier: promotion.reviewDossier,
          submissionBundle: promotion.submissionBundle,
          approvalPacket: promotion.approvalPacket,
        }),
        explicitArtifacts ??
          (await Promise.all(argsMany("--export-bundle").map((bundleFile) => loadExportBundleArtifact(bundleFile)))),
      )
    ).at(-1) ??
    QualityPromotionExportBundle.create({
      auditManifest: await resolveAuditManifestForPromotion(promotion),
    })
  )
}

async function resolveArchiveManifestForPromotion(
  promotion: QualityModelRegistry.PromotionRecord,
  explicitArtifacts?: QualityPromotionArchiveManifest.ArchiveArtifact[],
) {
  return (
    (
      await QualityPromotionArchiveManifest.resolveForPromotion(
        QualityPromotionAuditManifest.PromotionSnapshot.parse({
          promotionID: promotion.promotionID,
          source: promotion.source,
          promotedAt: promotion.promotedAt,
          previousActiveSource: promotion.previousActiveSource,
          decision: promotion.decision,
          decisionBundleCreatedAt: promotion.decisionBundleCreatedAt ?? null,
          boardDecision: promotion.boardDecision,
          releaseDecisionRecord: promotion.releaseDecisionRecord,
          releasePacket: promotion.releasePacket,
          reviewDossier: promotion.reviewDossier,
          submissionBundle: promotion.submissionBundle,
          approvalPacket: promotion.approvalPacket,
        }),
        explicitArtifacts ??
          (await Promise.all(
            argsMany("--archive-manifest").map((archiveFile) => loadArchiveManifestArtifact(archiveFile)),
          )),
      )
    ).at(-1) ??
    QualityPromotionArchiveManifest.create({
      exportBundle: await resolveExportBundleForPromotion(promotion),
    })
  )
}

async function resolveHandoffPackageForPromotion(
  promotion: QualityModelRegistry.PromotionRecord,
  explicitArtifacts?: QualityPromotionHandoffPackage.PackageArtifact[],
) {
  return (
    (
      await QualityPromotionHandoffPackage.resolveForPromotion(
        QualityPromotionAuditManifest.PromotionSnapshot.parse({
          promotionID: promotion.promotionID,
          source: promotion.source,
          promotedAt: promotion.promotedAt,
          previousActiveSource: promotion.previousActiveSource,
          decision: promotion.decision,
          decisionBundleCreatedAt: promotion.decisionBundleCreatedAt ?? null,
          boardDecision: promotion.boardDecision,
          releaseDecisionRecord: promotion.releaseDecisionRecord,
          releasePacket: promotion.releasePacket,
          reviewDossier: promotion.reviewDossier,
          submissionBundle: promotion.submissionBundle,
          approvalPacket: promotion.approvalPacket,
        }),
        explicitArtifacts ??
          (await Promise.all(
            argsMany("--handoff-package").map((packetFile) => loadHandoffPackageArtifact(packetFile)),
          )),
      )
    ).at(-1) ??
    QualityPromotionHandoffPackage.create({
      archiveManifest: await resolveArchiveManifestForPromotion(promotion),
    })
  )
}

async function resolvePortableExportForPromotion(
  promotion: QualityModelRegistry.PromotionRecord,
  explicitArtifacts?: QualityPromotionPortableExport.ExportArtifact[],
) {
  return (
    (
      await QualityPromotionPortableExport.resolveForPromotion(
        QualityPromotionAuditManifest.PromotionSnapshot.parse({
          promotionID: promotion.promotionID,
          source: promotion.source,
          promotedAt: promotion.promotedAt,
          previousActiveSource: promotion.previousActiveSource,
          decision: promotion.decision,
          decisionBundleCreatedAt: promotion.decisionBundleCreatedAt ?? null,
          boardDecision: promotion.boardDecision,
          releaseDecisionRecord: promotion.releaseDecisionRecord,
          releasePacket: promotion.releasePacket,
          reviewDossier: promotion.reviewDossier,
          submissionBundle: promotion.submissionBundle,
          approvalPacket: promotion.approvalPacket,
        }),
        explicitArtifacts ??
          (await Promise.all(argsMany("--portable-export").map((file) => loadPortableExportArtifact(file)))),
      )
    ).at(-1) ??
    QualityPromotionPortableExport.create({
      handoffPackage: await resolveHandoffPackageForPromotion(promotion),
    })
  )
}

async function resolvePackagedArchiveForPromotion(
  promotion: QualityModelRegistry.PromotionRecord,
  explicitArtifacts?: QualityPromotionPackagedArchive.ArchiveArtifact[],
) {
  return (
    (
      await QualityPromotionPackagedArchive.resolveForPromotion(
        QualityPromotionAuditManifest.PromotionSnapshot.parse({
          promotionID: promotion.promotionID,
          source: promotion.source,
          promotedAt: promotion.promotedAt,
          previousActiveSource: promotion.previousActiveSource,
          decision: promotion.decision,
          decisionBundleCreatedAt: promotion.decisionBundleCreatedAt ?? null,
          boardDecision: promotion.boardDecision,
          releaseDecisionRecord: promotion.releaseDecisionRecord,
          releasePacket: promotion.releasePacket,
          reviewDossier: promotion.reviewDossier,
          submissionBundle: promotion.submissionBundle,
          approvalPacket: promotion.approvalPacket,
        }),
        explicitArtifacts ??
          (await Promise.all(argsMany("--packaged-archive").map((file) => loadPackagedArchiveArtifact(file)))),
      )
    ).at(-1) ??
    QualityPromotionPackagedArchive.create({
      portableExport: await resolvePortableExportForPromotion(promotion),
    })
  )
}

async function resolveSignedArchiveForPromotion(
  promotion: QualityModelRegistry.PromotionRecord,
  explicitArtifacts?: QualityPromotionSignedArchive.ArchiveArtifact[],
) {
  return (
    await QualityPromotionSignedArchive.resolveForPromotion(
      QualityPromotionAuditManifest.PromotionSnapshot.parse({
        promotionID: promotion.promotionID,
        source: promotion.source,
        promotedAt: promotion.promotedAt,
        previousActiveSource: promotion.previousActiveSource,
        decision: promotion.decision,
        decisionBundleCreatedAt: promotion.decisionBundleCreatedAt ?? null,
        boardDecision: promotion.boardDecision,
        releaseDecisionRecord: promotion.releaseDecisionRecord,
        releasePacket: promotion.releasePacket,
        reviewDossier: promotion.reviewDossier,
        submissionBundle: promotion.submissionBundle,
        approvalPacket: promotion.approvalPacket,
      }),
      explicitArtifacts ??
        (await Promise.all(argsMany("--signed-archive").map((file) => loadSignedArchiveArtifact(file)))),
    )
  ).at(-1)
}

async function evaluateSignedArchiveAttestationForPromotion(input: {
  promotion: QualityModelRegistry.PromotionRecord
  explicitArchives?: QualityPromotionSignedArchive.ArchiveArtifact[]
  explicitTrusts?: QualityPromotionSignedArchiveTrust.TrustArtifact[]
}) {
  const signing = await resolveArchiveSigningInputForCLI()
  if (!signing) {
    throw new Error("Archive signing inputs are required for signed archive attestation record operations")
  }
  const archive = await resolveSignedArchiveForPromotion(input.promotion, input.explicitArchives)
  if (!archive) {
    throw new Error(`No signed archive available for promotion ${input.promotion.promotionID}`)
  }
  const projectID =
    (await effectiveProjectIDForCLI({
      projectID: QualityRolloutProjectScope.fromPromotionRecord(input.promotion),
    })) ?? undefined
  const trust = await QualityPromotionSignedArchiveTrust.evaluate({
    archive,
    keyMaterial: signing.keyMaterial,
    projectID,
    trusts: input.explicitTrusts,
  })
  const policyResolution = await resolveSignedArchiveAttestationPolicyForCLI({ projectID })
  const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
    trust,
    policy: policyResolution.policy,
    policySource: policyResolution.source,
    policyProjectID: policyResolution.projectID,
  })
  return {
    archive,
    trust,
    attestation,
    projectID,
    policyResolution,
  }
}

function signedArchiveAttestationPacketPromotionReference(input: {
  promotion: QualityModelRegistry.PromotionRecord
  attestationRecord: QualityPromotionSignedArchiveAttestationRecord.RecordArtifact
}) {
  const { promotion, attestationRecord } = input
  const releasePacket = promotion.releasePacket
  if (!releasePacket) {
    throw new Error(`Promotion ${promotion.promotionID} does not include release packet provenance`)
  }
  return QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
    promotionID: promotion.promotionID,
    source: promotion.source,
    promotedAt: promotion.promotedAt,
    decision: promotion.decision,
    previousActiveSource: promotion.previousActiveSource,
    releasePacketID: releasePacket.packetID,
    promotionMode: releasePacket.promotionMode,
    authorizedPromotion: releasePacket.authorizedPromotion,
    signedArchiveID: attestationRecord.signedArchive.signedArchiveID,
  })
}

function verifiedSignedArchiveAttestationRecordOrThrow(
  promotion: QualityModelRegistry.PromotionRecord,
  record: QualityPromotionSignedArchiveAttestationRecord.RecordArtifact,
) {
  const reasons = QualityPromotionSignedArchiveAttestationRecord.verify(record)
  if (reasons.length > 0) {
    throw new Error(
      `Signed archive attestation record ${record.recordID} for promotion ${promotion.promotionID} is invalid (${reasons[0]})`,
    )
  }
  return record
}

function verifiedSignedArchiveAttestationPacketOrThrow(
  promotion: QualityModelRegistry.PromotionRecord,
  packet: QualityPromotionSignedArchiveAttestationPacket.PacketArtifact,
) {
  const reasons = QualityPromotionSignedArchiveAttestationPacket.verify(packet)
  if (reasons.length > 0) {
    throw new Error(
      `Signed archive attestation packet ${packet.packetID} for promotion ${promotion.promotionID} is invalid (${reasons[0]})`,
    )
  }
  return packet
}

function verifiedSignedArchiveGovernancePacketOrThrow(
  promotion: QualityModelRegistry.PromotionRecord,
  packet: QualityPromotionSignedArchiveGovernancePacket.PacketArtifact,
) {
  const reasons = QualityPromotionSignedArchiveGovernancePacket.verify(packet)
  if (reasons.length > 0) {
    throw new Error(
      `Signed archive governance packet ${packet.packetID} for promotion ${promotion.promotionID} is invalid (${reasons[0]})`,
    )
  }
  return packet
}

async function resolveSignedArchiveAttestationRecordForPromotion(
  promotion: QualityModelRegistry.PromotionRecord,
  explicitArtifacts?: QualityPromotionSignedArchiveAttestationRecord.RecordArtifact[],
) {
  const explicit =
    explicitArtifacts ??
    (await Promise.all(
      argsMany("--signed-archive-attestation-record").map((file) => loadSignedArchiveAttestationRecordArtifact(file)),
    ))
  const resolved =
    explicit.length > 0 ? explicit : await QualityPromotionSignedArchiveAttestationRecord.list(promotion.source)
  const recordID = promotion.signedArchiveAttestationRecord?.recordID
  if (recordID) {
    const match = resolved.find((record) => record.recordID === recordID)
    if (match) return verifiedSignedArchiveAttestationRecordOrThrow(promotion, match)
    if (explicit.length > 0) {
      throw new Error(
        `Could not resolve signed archive attestation record ${recordID} for promotion ${promotion.promotionID}`,
      )
    }
    throw new Error(
      `Could not resolve signed archive attestation record ${recordID} for promotion ${promotion.promotionID}`,
    )
  }
  const matchesByPromotion = resolved
    .filter((record) => record.promotionID === promotion.promotionID)
    .map((record) => verifiedSignedArchiveAttestationRecordOrThrow(promotion, record))
  if (matchesByPromotion.length === 1) return matchesByPromotion[0]
  if (matchesByPromotion.length > 1) {
    throw new Error(
      `Multiple signed archive attestation records match promotion ${promotion.promotionID}; pass --signed-archive-attestation-record explicitly`,
    )
  }
  if (explicit.length > 0) {
    throw new Error(`No explicit signed archive attestation record matches promotion ${promotion.promotionID}`)
  }
  throw new Error(`No signed archive attestation record available for promotion ${promotion.promotionID}`)
}

async function resolveSignedArchiveAttestationPacketForPromotion(
  promotion: QualityModelRegistry.PromotionRecord,
  explicitArtifacts?: QualityPromotionSignedArchiveAttestationPacket.PacketArtifact[],
  explicitRecords?: QualityPromotionSignedArchiveAttestationRecord.RecordArtifact[],
) {
  const explicit =
    explicitArtifacts ??
    (await Promise.all(
      argsMany("--signed-archive-attestation-packet").map((file) => loadSignedArchiveAttestationPacketArtifact(file)),
    ))
  const resolved =
    explicit.length > 0 ? explicit : await QualityPromotionSignedArchiveAttestationPacket.list(promotion.source)
  const packetID = promotion.signedArchiveAttestationPacket?.packetID
  if (packetID) {
    const match = resolved.find((packet) => packet.packetID === packetID)
    if (match) return verifiedSignedArchiveAttestationPacketOrThrow(promotion, match)
    if (explicit.length > 0) {
      throw new Error(
        `Could not resolve signed archive attestation packet ${packetID} for promotion ${promotion.promotionID}`,
      )
    }
  }
  const matchesByPromotion = resolved
    .filter((packet) => packet.promotion.promotionID === promotion.promotionID)
    .map((packet) => verifiedSignedArchiveAttestationPacketOrThrow(promotion, packet))
  if (matchesByPromotion.length === 1) return matchesByPromotion[0]
  if (matchesByPromotion.length > 1) {
    throw new Error(
      `Multiple signed archive attestation packets match promotion ${promotion.promotionID}; pass --signed-archive-attestation-packet explicitly`,
    )
  }
  if (explicit.length > 0) {
    throw new Error(`No explicit signed archive attestation packet matches promotion ${promotion.promotionID}`)
  }
  const attestationRecord = await resolveSignedArchiveAttestationRecordForPromotion(promotion, explicitRecords)
  return QualityPromotionSignedArchiveAttestationPacket.create({
    promotion: signedArchiveAttestationPacketPromotionReference({
      promotion,
      attestationRecord,
    }),
    attestationRecord,
  })
}

async function resolveSignedArchiveGovernancePacketForPromotion(
  promotion: QualityModelRegistry.PromotionRecord,
  explicitArtifacts?: QualityPromotionSignedArchiveGovernancePacket.PacketArtifact[],
  explicitAttestationPackets?: QualityPromotionSignedArchiveAttestationPacket.PacketArtifact[],
  explicitAttestationRecords?: QualityPromotionSignedArchiveAttestationRecord.RecordArtifact[],
  explicitReleasePackets?: QualityPromotionReleasePacket.PacketArtifact[],
) {
  const explicit =
    explicitArtifacts ??
    (await Promise.all(
      argsMany("--signed-archive-governance-packet").map((file) => loadSignedArchiveGovernancePacketArtifact(file)),
    ))
  const resolved =
    explicit.length > 0 ? explicit : await QualityPromotionSignedArchiveGovernancePacket.list(promotion.source)
  const packetID = promotion.signedArchiveGovernancePacket?.packetID
  if (packetID) {
    const match = resolved.find((packet) => packet.packetID === packetID)
    if (match) return verifiedSignedArchiveGovernancePacketOrThrow(promotion, match)
    if (explicit.length > 0) {
      throw new Error(
        `Could not resolve signed archive governance packet ${packetID} for promotion ${promotion.promotionID}`,
      )
    }
    throw new Error(
      `Could not resolve signed archive governance packet ${packetID} for promotion ${promotion.promotionID}`,
    )
  }
  const promotionReference = QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
    promotionID: promotion.promotionID,
    source: promotion.source,
    promotedAt: promotion.promotedAt,
    decision: promotion.decision,
    previousActiveSource: promotion.previousActiveSource,
    releasePacketID: promotion.releasePacket?.packetID ?? null,
    promotionMode: promotion.releasePacket?.promotionMode ?? null,
    authorizedPromotion: promotion.releasePacket?.authorizedPromotion ?? null,
    signedArchiveID: promotion.signedArchive?.signedArchiveID ?? null,
  })
  const matchesByPromotion = resolved
    .filter((packet) => packet.promotion.promotionID === promotion.promotionID)
    .map((packet) => verifiedSignedArchiveGovernancePacketOrThrow(promotion, packet))
  if (matchesByPromotion.length === 1) return matchesByPromotion[0]
  if (matchesByPromotion.length > 1) {
    throw new Error(
      `Multiple signed archive governance packets match promotion ${promotion.promotionID}; pass --signed-archive-governance-packet explicitly`,
    )
  }
  if (explicit.length > 0) {
    throw new Error(`No explicit signed archive governance packet matches promotion ${promotion.promotionID}`)
  }
  const releasePacket = await resolveReleasePacketForPromotion(promotion, explicitReleasePackets)
  const attestationPacket = await resolveSignedArchiveAttestationPacketForPromotion(
    promotion,
    explicitAttestationPackets,
    explicitAttestationRecords,
  )
  return QualityPromotionSignedArchiveGovernancePacket.create({
    promotion: QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
      ...promotionReference,
      releasePacketID: promotion.releasePacket?.packetID ?? releasePacket.packetID,
      promotionMode: promotion.releasePacket?.promotionMode ?? releasePacket.summary.promotionMode,
      authorizedPromotion: promotion.releasePacket?.authorizedPromotion ?? releasePacket.summary.authorizedPromotion,
      signedArchiveID: promotion.signedArchive?.signedArchiveID ?? attestationPacket.summary.signedArchiveID,
    }),
    releasePacket,
    attestationPacket,
  })
}

function verifiedSignedArchiveReviewDossierOrThrow(
  promotion: QualityModelRegistry.PromotionRecord,
  dossier: QualityPromotionSignedArchiveReviewDossier.DossierArtifact,
) {
  const reasons = QualityPromotionSignedArchiveReviewDossier.verify(dossier)
  if (reasons.length > 0) {
    throw new Error(
      `Signed archive review dossier ${dossier.dossierID} for promotion ${promotion.promotionID} is invalid (${reasons[0]})`,
    )
  }
  return dossier
}

async function resolveSignedArchiveReviewDossierForPromotion(
  promotion: QualityModelRegistry.PromotionRecord,
  explicitArtifacts?: QualityPromotionSignedArchiveReviewDossier.DossierArtifact[],
  explicitGovernancePackets?: QualityPromotionSignedArchiveGovernancePacket.PacketArtifact[],
  explicitAttestationPackets?: QualityPromotionSignedArchiveAttestationPacket.PacketArtifact[],
  explicitAttestationRecords?: QualityPromotionSignedArchiveAttestationRecord.RecordArtifact[],
  explicitReleasePackets?: QualityPromotionReleasePacket.PacketArtifact[],
  explicitHandoffPackages?: QualityPromotionHandoffPackage.PackageArtifact[],
) {
  const explicit =
    explicitArtifacts ??
    (await Promise.all(
      argsMany("--signed-archive-review-dossier").map((file) => loadSignedArchiveReviewDossierArtifact(file)),
    ))
  const resolved =
    explicit.length > 0 ? explicit : await QualityPromotionSignedArchiveReviewDossier.list(promotion.source)
  const dossierID = promotion.signedArchiveReviewDossier?.dossierID
  if (dossierID) {
    const match = resolved.find((dossier) => dossier.dossierID === dossierID)
    if (match) return verifiedSignedArchiveReviewDossierOrThrow(promotion, match)
    if (explicit.length > 0) {
      throw new Error(
        `Could not resolve signed archive review dossier ${dossierID} for promotion ${promotion.promotionID}`,
      )
    }
    throw new Error(
      `Could not resolve signed archive review dossier ${dossierID} for promotion ${promotion.promotionID}`,
    )
  }
  const matchesByPromotion = resolved
    .filter((dossier) => dossier.governancePacket.promotion.promotionID === promotion.promotionID)
    .map((dossier) => verifiedSignedArchiveReviewDossierOrThrow(promotion, dossier))
  if (matchesByPromotion.length === 1) return matchesByPromotion[0]
  if (matchesByPromotion.length > 1) {
    throw new Error(
      `Multiple signed archive review dossiers match promotion ${promotion.promotionID}; pass --signed-archive-review-dossier explicitly`,
    )
  }
  if (explicit.length > 0) {
    throw new Error(`No explicit signed archive review dossier matches promotion ${promotion.promotionID}`)
  }
  const governancePacket = await resolveSignedArchiveGovernancePacketForPromotion(
    promotion,
    explicitGovernancePackets,
    explicitAttestationPackets,
    explicitAttestationRecords,
    explicitReleasePackets,
  )
  const handoffPackage = await resolveHandoffPackageForPromotion(promotion, explicitHandoffPackages)
  return QualityPromotionSignedArchiveReviewDossier.create({
    governancePacket,
    handoffPackage,
  })
}

function hasApprovalPolicyOverrideArgs() {
  return [
    "--warn-approvals",
    "--warn-min-role",
    "--warn-distinct-approvers",
    "--force-approvals",
    "--force-min-role",
    "--force-distinct-approvers",
    "--reentry-approvals",
    "--reentry-min-role",
    "--reentry-distinct-approvers",
    "--reentry-require-independent-reviewer",
    "--reentry-allow-self-approval",
    "--reentry-require-fresh-approver",
    "--reentry-allow-prior-approver-reuse",
    "--reentry-max-prior-overlap-ratio",
    "--reentry-disable-prior-overlap-cap",
    "--reentry-reviewer-carryover-budget",
    "--reentry-disable-reviewer-carryover-budget",
    "--reentry-team-carryover-budget",
    "--reentry-disable-team-carryover-budget",
    "--reentry-max-prior-reporting-chain-overlap-ratio",
    "--reentry-disable-prior-reporting-chain-overlap-cap",
    "--reentry-reporting-chain-carryover-budget",
    "--reentry-disable-reporting-chain-carryover-budget",
    "--reentry-require-role-cohort-diversity",
    "--reentry-allow-single-role-cohort",
    "--reentry-min-role-cohorts",
    "--reentry-require-team-diversity",
    "--reentry-allow-single-team",
    "--reentry-min-teams",
    "--reentry-require-reporting-chain-diversity",
    "--reentry-allow-single-reporting-chain",
    "--reentry-min-reporting-chains",
    "--reentry-approval-concentration-budget",
    "--reentry-disable-approval-concentration-budget",
    "--reentry-approval-concentration-preset",
    "--reentry-approval-concentration-contextual",
    "--reentry-approval-concentration-workflow",
    "--reentry-approval-concentration-risk-tier",
    "--reentry-approval-concentration-same-policy-retry",
    "--reentry-approval-concentration-force-path",
    "--reentry-approval-concentration-prior-rollbacks",
    "--reentry-approval-concentration-weight-approver",
    "--reentry-approval-concentration-weight-team",
    "--reentry-approval-concentration-weight-reporting-chain",
  ].some((name) => hasArg(name))
}

async function approvalPolicyOverrides(
  basePolicy?: QualityPromotionApprovalPolicy.Policy,
): Promise<QualityPromotionApprovalPolicy.PolicyOverrides> {
  const warnDistinct = hasArg("--warn-distinct-approvers") ? true : undefined
  const forceDistinct = hasArg("--force-distinct-approvers") ? true : undefined
  const reentryDistinct = hasArg("--reentry-distinct-approvers") ? true : undefined
  const reentryIndependent = hasArg("--reentry-allow-self-approval")
    ? false
    : hasArg("--reentry-require-independent-reviewer")
      ? true
      : undefined
  const reentryFresh = hasArg("--reentry-allow-prior-approver-reuse")
    ? false
    : hasArg("--reentry-require-fresh-approver")
      ? true
      : undefined
  const reentryOverlapCap = hasArg("--reentry-disable-prior-overlap-cap")
    ? null
    : arg("--reentry-max-prior-overlap-ratio")
      ? Number(arg("--reentry-max-prior-overlap-ratio"))
      : undefined
  const reentryCarryoverBudget = hasArg("--reentry-disable-reviewer-carryover-budget")
    ? null
    : arg("--reentry-reviewer-carryover-budget")
      ? Number(arg("--reentry-reviewer-carryover-budget"))
      : undefined
  const reentryTeamCarryoverBudget = hasArg("--reentry-disable-team-carryover-budget")
    ? null
    : arg("--reentry-team-carryover-budget")
      ? Number(arg("--reentry-team-carryover-budget"))
      : undefined
  const reentryReportingChainOverlapCap = hasArg("--reentry-disable-prior-reporting-chain-overlap-cap")
    ? null
    : arg("--reentry-max-prior-reporting-chain-overlap-ratio")
      ? Number(arg("--reentry-max-prior-reporting-chain-overlap-ratio"))
      : undefined
  const reentryReportingChainCarryoverBudget = hasArg("--reentry-disable-reporting-chain-carryover-budget")
    ? null
    : arg("--reentry-reporting-chain-carryover-budget")
      ? Number(arg("--reentry-reporting-chain-carryover-budget"))
      : undefined
  const reentryApprovalConcentrationBudget = hasArg("--reentry-disable-approval-concentration-budget")
    ? null
    : arg("--reentry-approval-concentration-budget")
      ? Number(arg("--reentry-approval-concentration-budget"))
      : undefined
  const reentryApprovalConcentrationRiskTier = arg("--reentry-approval-concentration-risk-tier") as
    | QualityPromotionApprovalPolicy.ApprovalConcentrationRiskTier
    | undefined
  const reentryApprovalConcentrationWorkflow = arg("--reentry-approval-concentration-workflow") as
    | QualityPromotionApprovalPolicy.ApprovalConcentrationWorkflow
    | undefined
  const reentryApprovalConcentrationSamePolicyRetry = hasArg("--reentry-approval-concentration-same-policy-retry")
    ? true
    : undefined
  const reentryApprovalConcentrationForcePath = hasArg("--reentry-approval-concentration-force-path") ? true : undefined
  const reentryApprovalConcentrationPriorRollbacks = arg("--reentry-approval-concentration-prior-rollbacks")
    ? Number(arg("--reentry-approval-concentration-prior-rollbacks"))
    : undefined
  const contextualDecisionBundle = hasArg("--reentry-approval-concentration-contextual")
    ? await loadDecisionBundle(
        arg("--decision-bundle") ??
          (() => {
            throw new Error("--decision-bundle is required with --reentry-approval-concentration-contextual")
          })(),
      )
    : null
  const contextualRecommendation = contextualDecisionBundle
    ? QualityPromotionApprovalPolicy.recommendConcentrationFromContext({
        bundle: contextualDecisionBundle,
        workflow: reentryApprovalConcentrationWorkflow,
        riskTier: reentryApprovalConcentrationRiskTier,
        samePolicyRetry: reentryApprovalConcentrationSamePolicyRetry,
        forcePath: reentryApprovalConcentrationForcePath,
        priorRollbacks: reentryApprovalConcentrationPriorRollbacks,
      })
    : null
  const reentryApprovalConcentrationRecommendation =
    contextualRecommendation?.recommendation ??
    (reentryApprovalConcentrationRiskTier
      ? QualityPromotionApprovalPolicy.recommendConcentration({
          workflow: reentryApprovalConcentrationWorkflow,
          riskTier: reentryApprovalConcentrationRiskTier,
          samePolicyRetry: reentryApprovalConcentrationSamePolicyRetry,
          forcePath: reentryApprovalConcentrationForcePath,
          priorRollbacks: reentryApprovalConcentrationPriorRollbacks,
        })
      : null)
  const reentryApprovalConcentrationPreset =
    (arg("--reentry-approval-concentration-preset") as
      | QualityPromotionApprovalPolicy.ApprovalConcentrationPreset
      | undefined) ?? reentryApprovalConcentrationRecommendation?.preset
  const concentrationWeightApproverArg = arg("--reentry-approval-concentration-weight-approver")
  const concentrationWeightTeamArg = arg("--reentry-approval-concentration-weight-team")
  const concentrationWeightReportingChainArg = arg("--reentry-approval-concentration-weight-reporting-chain")
  const reentryApprovalConcentrationWeights =
    concentrationWeightApproverArg !== undefined ||
    concentrationWeightTeamArg !== undefined ||
    concentrationWeightReportingChainArg !== undefined
      ? {
          approver:
            concentrationWeightApproverArg !== undefined
              ? Number(concentrationWeightApproverArg)
              : reentryApprovalConcentrationPreset
                ? QualityPromotionApprovalPolicy.concentrationWeightsForPreset(reentryApprovalConcentrationPreset)
                    .approver
                : (basePolicy?.rules.reentry.approvalConcentrationWeights.approver ??
                  QualityPromotionApprovalPolicy.DEFAULT_REENTRY_APPROVAL_CONCENTRATION_WEIGHTS.approver),
          team:
            concentrationWeightTeamArg !== undefined
              ? Number(concentrationWeightTeamArg)
              : reentryApprovalConcentrationPreset
                ? QualityPromotionApprovalPolicy.concentrationWeightsForPreset(reentryApprovalConcentrationPreset).team
                : (basePolicy?.rules.reentry.approvalConcentrationWeights.team ??
                  QualityPromotionApprovalPolicy.DEFAULT_REENTRY_APPROVAL_CONCENTRATION_WEIGHTS.team),
          reportingChain:
            concentrationWeightReportingChainArg !== undefined
              ? Number(concentrationWeightReportingChainArg)
              : reentryApprovalConcentrationPreset
                ? QualityPromotionApprovalPolicy.concentrationWeightsForPreset(reentryApprovalConcentrationPreset)
                    .reportingChain
                : (basePolicy?.rules.reentry.approvalConcentrationWeights.reportingChain ??
                  QualityPromotionApprovalPolicy.DEFAULT_REENTRY_APPROVAL_CONCENTRATION_WEIGHTS.reportingChain),
        }
      : undefined
  const reentryRoleCohortDiversity = hasArg("--reentry-allow-single-role-cohort")
    ? false
    : hasArg("--reentry-require-role-cohort-diversity")
      ? true
      : undefined
  const reentryTeamDiversity = hasArg("--reentry-allow-single-team")
    ? false
    : hasArg("--reentry-require-team-diversity")
      ? true
      : undefined
  const reentryReportingChainDiversity = hasArg("--reentry-allow-single-reporting-chain")
    ? false
    : hasArg("--reentry-require-reporting-chain-diversity")
      ? true
      : undefined
  return {
    allowWarn: {
      minimumApprovals: arg("--warn-approvals") ? Number(arg("--warn-approvals")) : undefined,
      minimumRole: (arg("--warn-min-role") as QualityPromotionApprovalPolicy.ApprovalRole | undefined) ?? undefined,
      requireDistinctApprovers: warnDistinct,
    },
    force: {
      minimumApprovals: arg("--force-approvals") ? Number(arg("--force-approvals")) : undefined,
      minimumRole: (arg("--force-min-role") as QualityPromotionApprovalPolicy.ApprovalRole | undefined) ?? undefined,
      requireDistinctApprovers: forceDistinct,
    },
    reentry: {
      minimumApprovals: arg("--reentry-approvals") ? Number(arg("--reentry-approvals")) : undefined,
      minimumRole: (arg("--reentry-min-role") as QualityPromotionApprovalPolicy.ApprovalRole | undefined) ?? undefined,
      requireDistinctApprovers: reentryDistinct,
      requireIndependentReviewer: reentryIndependent,
      requirePriorApproverExclusion: reentryFresh,
      maxPriorApproverOverlapRatio: reentryOverlapCap,
      reviewerCarryoverBudget: reentryCarryoverBudget,
      teamCarryoverBudget: reentryTeamCarryoverBudget,
      maxPriorReportingChainOverlapRatio: reentryReportingChainOverlapCap,
      reportingChainCarryoverBudget: reentryReportingChainCarryoverBudget,
      requireRoleCohortDiversity: reentryRoleCohortDiversity,
      minimumDistinctRoleCohorts: arg("--reentry-min-role-cohorts")
        ? Number(arg("--reentry-min-role-cohorts"))
        : undefined,
      requireReviewerTeamDiversity: reentryTeamDiversity,
      minimumDistinctReviewerTeams: arg("--reentry-min-teams") ? Number(arg("--reentry-min-teams")) : undefined,
      requireReportingChainDiversity: reentryReportingChainDiversity,
      minimumDistinctReportingChains: arg("--reentry-min-reporting-chains")
        ? Number(arg("--reentry-min-reporting-chains"))
        : undefined,
      approvalConcentrationBudget:
        reentryApprovalConcentrationBudget ?? reentryApprovalConcentrationRecommendation?.budget,
      approvalConcentrationPreset: reentryApprovalConcentrationPreset,
      approvalConcentrationWeights: reentryApprovalConcentrationWeights,
    },
  }
}

async function currentProjectID(input?: { required?: boolean }) {
  const explicit = arg("--project-id")
  if (explicit) return explicit
  try {
    return await Instance.provide({
      directory: process.cwd(),
      fn: () => Instance.project.id,
    })
  } catch (error) {
    if (input?.required) {
      throw new Error(`Unable to resolve current project id: ${error instanceof Error ? error.message : String(error)}`)
    }
    return
  }
}

async function effectiveProjectIDForCLI(input?: { required?: boolean; projectID?: string | null }) {
  const projectID = QualityRolloutProjectScope.reconcile({
    explicitProjectID: arg("--project-id"),
    artifactProjectID: input?.projectID,
  })
  if (projectID) return projectID
  return (await currentProjectID({ required: input?.required })) ?? null
}

async function resolveApprovalPolicyForCLI(input?: { requireProject?: boolean; projectID?: string | null }) {
  const projectID = await effectiveProjectIDForCLI({
    required: input?.requireProject,
    projectID: input?.projectID,
  })
  const resolved = await QualityPromotionApprovalPolicyStore.resolve({
    projectID: projectID ?? null,
  })
  if (!hasApprovalPolicyOverrideArgs()) return resolved
  return QualityPromotionApprovalPolicyStore.resolve({
    projectID: projectID ?? null,
    policy: QualityPromotionApprovalPolicy.merge(resolved.policy, await approvalPolicyOverrides(resolved.policy)),
  })
}

function hasSignedArchiveAttestationPolicyOverrideArgs() {
  return [
    "--minimum-trust-scope",
    "--allow-retired-historical",
    "--disallow-retired-historical",
    "--allow-revoked-historical",
    "--disallow-revoked-historical",
  ].some((name) => hasArg(name))
}

function signedArchiveAttestationPolicyOverrides(): QualityPromotionSignedArchiveAttestationPolicy.PolicyOverrides {
  const minimumTrustScope = arg("--minimum-trust-scope")
  const allowRetiredHistorical = hasArg("--allow-retired-historical")
    ? true
    : hasArg("--disallow-retired-historical")
      ? false
      : undefined
  const allowRevokedHistorical = hasArg("--allow-revoked-historical")
    ? true
    : hasArg("--disallow-revoked-historical")
      ? false
      : undefined

  if (hasArg("--allow-retired-historical") && hasArg("--disallow-retired-historical")) {
    throw new Error("Choose only one of --allow-retired-historical or --disallow-retired-historical")
  }
  if (hasArg("--allow-revoked-historical") && hasArg("--disallow-revoked-historical")) {
    throw new Error("Choose only one of --allow-revoked-historical or --disallow-revoked-historical")
  }

  return {
    minimumTrustScope: minimumTrustScope
      ? QualityPromotionSignedArchiveAttestationPolicy.MinimumTrustScope.parse(minimumTrustScope)
      : undefined,
    allowRetiredHistorical,
    allowRevokedHistorical,
  }
}

async function resolveSignedArchiveAttestationPolicyForCLI(input?: {
  requireProject?: boolean
  projectID?: string | null
}) {
  const projectID = await effectiveProjectIDForCLI({
    required: input?.requireProject,
    projectID: input?.projectID,
  })
  const resolved = await QualityPromotionSignedArchiveAttestationPolicyStore.resolve({
    projectID: projectID ?? null,
  })
  if (!hasSignedArchiveAttestationPolicyOverrideArgs()) return resolved
  return QualityPromotionSignedArchiveAttestationPolicyStore.resolve({
    projectID: projectID ?? null,
    policy: QualityPromotionSignedArchiveAttestationPolicy.merge(
      resolved.policy,
      signedArchiveAttestationPolicyOverrides(),
    ),
  })
}

function hasReleasePolicyOverrideArgs() {
  return (
    hasApprovalPolicyOverrideArgs() ||
    [
      "--cooldown-hours",
      "--repeat-window-hours",
      "--repeat-threshold",
      "--watch-min-records",
      "--watch-max-records",
      "--watch-abstention-warn-rate",
      "--watch-abstention-fail-rate",
      "--watch-avg-confidence-warn-abs-delta",
      "--watch-avg-confidence-fail-abs-delta",
      "--watch-max-confidence-warn-abs-delta",
      "--watch-require-candidate-coverage",
      "--watch-allow-missing-candidate",
    ].some((name) => hasArg(name))
  )
}

function stabilityPolicyOverrides(): Partial<QualityPromotionReleasePolicy.StabilityPolicy> {
  return {
    cooldownHours: arg("--cooldown-hours") ? Number(arg("--cooldown-hours")) : undefined,
    repeatFailureWindowHours: arg("--repeat-window-hours") ? Number(arg("--repeat-window-hours")) : undefined,
    repeatFailureThreshold: arg("--repeat-threshold") ? Number(arg("--repeat-threshold")) : undefined,
  }
}

function watchPolicyOverrides(): Partial<QualityPromotionReleasePolicy.WatchPolicy> {
  return {
    minRecords: arg("--watch-min-records") ? Number(arg("--watch-min-records")) : undefined,
    maxRecords: arg("--watch-max-records") ? Number(arg("--watch-max-records")) : undefined,
    abstentionWarnRate: arg("--watch-abstention-warn-rate") ? Number(arg("--watch-abstention-warn-rate")) : undefined,
    abstentionFailRate: arg("--watch-abstention-fail-rate") ? Number(arg("--watch-abstention-fail-rate")) : undefined,
    avgConfidenceWarnAbsDelta: arg("--watch-avg-confidence-warn-abs-delta")
      ? Number(arg("--watch-avg-confidence-warn-abs-delta"))
      : undefined,
    avgConfidenceFailAbsDelta: arg("--watch-avg-confidence-fail-abs-delta")
      ? Number(arg("--watch-avg-confidence-fail-abs-delta"))
      : undefined,
    maxConfidenceWarnAbsDelta: arg("--watch-max-confidence-warn-abs-delta")
      ? Number(arg("--watch-max-confidence-warn-abs-delta"))
      : undefined,
    requireCandidateCoverage: hasArg("--watch-require-candidate-coverage")
      ? true
      : hasArg("--watch-allow-missing-candidate")
        ? false
        : undefined,
  }
}

async function resolveReleasePolicyForCLI(input?: { requireProject?: boolean; projectID?: string | null }) {
  const projectID = await effectiveProjectIDForCLI({
    required: input?.requireProject,
    projectID: input?.projectID,
  })
  const resolved = await QualityPromotionReleasePolicyStore.resolve({
    projectID: projectID ?? null,
  })
  if (!hasReleasePolicyOverrideArgs()) return resolved
  return QualityPromotionReleasePolicyStore.resolve({
    projectID: projectID ?? null,
    policy: QualityPromotionReleasePolicy.merge(resolved.policy, {
      stability: stabilityPolicyOverrides(),
      watch: watchPolicyOverrides(),
      approval: await approvalPolicyOverrides(resolved.policy.approval),
    }),
  })
}

async function loadLabels(itemsFileLabelsArg: string | undefined, sessionIDs: string[]) {
  if (itemsFileLabelsArg) {
    return ProbabilisticRollout.LabelFile.parse(
      await readJson<unknown>(path.resolve(process.cwd(), itemsFileLabelsArg)),
    ).labels
  }
  if (sessionIDs.length === 0) {
    throw new Error("Provide --labels <file> or at least one --session value to load stored labels")
  }
  const exported = await QualityLabelStore.exportFile({ sessionIDs })
  return exported.labels
}

async function labelsImportMode() {
  const file = arg("--file")
  if (!file) throw new Error("--file is required for labels-import mode")
  const labelFile = ProbabilisticRollout.LabelFile.parse(await readJson<unknown>(path.resolve(process.cwd(), file)))
  const persisted = await QualityLabelStore.appendMany(labelFile.labels)
  console.log(`Persisted ${persisted.length} label record(s)`)
}

async function labelsExportMode() {
  const sessionIDs = argsMany("--session")
  if (sessionIDs.length === 0) throw new Error("At least one --session value is required for labels-export mode")
  const workflow = arg("--workflow")
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-labels.json")
  const exported = await QualityLabelStore.exportFile({
    sessionIDs,
    workflow: workflow ? ProbabilisticRollout.Workflow.parse(workflow) : undefined,
  })
  await write(out, JSON.stringify(exported, null, 2))
  console.log(`Exported ${exported.labels.length} label(s) to ${out}`)
}

async function reportMode() {
  const itemsFile = arg("--items")
  if (!itemsFile) throw new Error("--items is required for report mode")

  const threshold = Number(arg("--threshold") ?? "0.5")
  const abstainRaw = arg("--abstain-below")
  const abstainBelow = abstainRaw === undefined ? undefined : Number(abstainRaw)
  const predictionArg = arg("--predictions")
  const summaryOut = path.resolve(process.cwd(), arg("--summary-out") ?? ".tmp/quality-calibration-summary.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-calibration-report.md")

  const items = flattenReplay(await readJson<unknown>(path.resolve(process.cwd(), itemsFile)))
  const labels = await loadLabels(arg("--labels"), argsMany("--session"))
  const predictions = predictionArg ? await loadPredictionFile(predictionArg) : undefined
  const summary = ProbabilisticRollout.summarizeCalibration(items, labels, {
    threshold,
    abstainBelow,
    predictions: predictions?.predictions,
    source: predictions?.source,
  })
  const report = ProbabilisticRollout.renderCalibrationReport(summary)

  await write(summaryOut, JSON.stringify(summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function trainMode() {
  const itemsFile = arg("--items")
  if (!itemsFile) throw new Error("--items is required for train mode")

  const items = flattenReplay(await readJson<unknown>(path.resolve(process.cwd(), itemsFile)))
  const labels = await loadLabels(arg("--labels"), argsMany("--session"))
  const model = QualityCalibrationModel.train(items, labels, {
    source: arg("--source") ?? undefined,
    binCount: arg("--bins") ? Number(arg("--bins")) : undefined,
    minBinCount: arg("--min-bin-count") ? Number(arg("--min-bin-count")) : undefined,
    laplaceAlpha: arg("--laplace-alpha") ? Number(arg("--laplace-alpha")) : undefined,
  })
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-calibration-model.json")
  await write(out, JSON.stringify(model, null, 2))
  console.log(`Trained calibration model ${model.source} with ${model.training.labeledItems} labeled item(s)`)
}

async function predictMode() {
  const itemsFile = arg("--items")
  const modelFile = arg("--model")
  if (!itemsFile || !modelFile) throw new Error("--items and --model are required for predict mode")

  const items = flattenReplay(await readJson<unknown>(path.resolve(process.cwd(), itemsFile)))
  const model = await loadModelFile(modelFile)
  const predictions = QualityCalibrationModel.predict(items, model)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-predictions.json")
  await write(out, JSON.stringify(predictions, null, 2))
  console.log(`Generated ${predictions.predictions.length} prediction(s) from ${model.source}`)
}

async function benchmarkMode() {
  const itemsFile = arg("--items")
  if (!itemsFile) throw new Error("--items is required for benchmark mode")

  const items = flattenReplay(await readJson<unknown>(path.resolve(process.cwd(), itemsFile)))
  const labels = await loadLabels(arg("--labels"), argsMany("--session"))
  const threshold = arg("--threshold") ? Number(arg("--threshold")) : undefined
  const abstainBelow = arg("--abstain-below") ? Number(arg("--abstain-below")) : undefined
  const benchmark = QualityCalibrationModel.benchmark(items, labels, {
    ratio: arg("--ratio") ? Number(arg("--ratio")) : undefined,
    source: arg("--source") ?? undefined,
    binCount: arg("--bins") ? Number(arg("--bins")) : undefined,
    minBinCount: arg("--min-bin-count") ? Number(arg("--min-bin-count")) : undefined,
    laplaceAlpha: arg("--laplace-alpha") ? Number(arg("--laplace-alpha")) : undefined,
    threshold,
    abstainBelow,
  })

  const bundleOut = path.resolve(process.cwd(), arg("--bundle-out") ?? ".tmp/quality-benchmark-bundle.json")
  const modelOut = path.resolve(process.cwd(), arg("--model-out") ?? ".tmp/quality-benchmark-model.json")
  const predictionsOut = path.resolve(
    process.cwd(),
    arg("--predictions-out") ?? ".tmp/quality-benchmark-predictions.json",
  )
  const baselineSummaryOut = path.resolve(
    process.cwd(),
    arg("--baseline-summary-out") ?? ".tmp/quality-benchmark-baseline-summary.json",
  )
  const candidateSummaryOut = path.resolve(
    process.cwd(),
    arg("--candidate-summary-out") ?? ".tmp/quality-benchmark-candidate-summary.json",
  )
  const comparisonOut = path.resolve(process.cwd(), arg("--comparison-out") ?? ".tmp/quality-benchmark-comparison.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-benchmark-report.md")
  const report = QualityCalibrationModel.renderBenchmarkReport(benchmark.bundle)

  await write(bundleOut, JSON.stringify(benchmark.bundle, null, 2))
  await write(modelOut, JSON.stringify(benchmark.model, null, 2))
  await write(predictionsOut, JSON.stringify(benchmark.predictions, null, 2))
  await write(baselineSummaryOut, JSON.stringify(benchmark.baselineSummary, null, 2))
  await write(candidateSummaryOut, JSON.stringify(benchmark.candidateSummary, null, 2))
  await write(comparisonOut, JSON.stringify(benchmark.comparison, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelRegisterMode() {
  const file = arg("--file")
  if (!file) throw new Error("--file is required for model-register mode")
  const model = await loadModelFile(file)
  const record = await QualityModelRegistry.register(model)
  console.log(`Registered model ${record.model.source}`)
}

async function modelListMode() {
  const records = await QualityModelRegistry.list()
  const active = await QualityModelRegistry.getActive()
  if (records.length === 0) {
    console.log("No registered quality models")
    return
  }
  for (const record of records) {
    const current = active?.source === record.model.source ? " (active)" : ""
    console.log(
      `${record.model.source}${current} · trained=${record.model.trainedAt} · labeled=${record.model.training.labeledItems}`,
    )
  }
}

async function modelActivateMode() {
  const source = arg("--source")
  if (!source) throw new Error("--source is required for model-activate mode")
  const active = await QualityModelRegistry.activate(source)
  console.log(`Activated model ${active.source}`)
}

async function modelClearActiveMode() {
  await QualityModelRegistry.clearActive()
  console.log("Cleared active quality model")
}

async function modelExportMode() {
  const source = arg("--source")
  if (!source) throw new Error("--source is required for model-export mode")
  const out = path.resolve(process.cwd(), arg("--out") ?? `.tmp/${source}.model.json`)
  const model = (await QualityModelRegistry.get(source)).model
  await write(out, JSON.stringify(model, null, 2))
  console.log(`Exported model ${source} to ${out}`)
}

async function modelPromoteMode() {
  const bundleFile = arg("--bundle")
  const decisionBundleFile = arg("--decision-bundle")
  const submissionBundleFile = arg("--submission-bundle")
  const reviewDossierFile = arg("--review-dossier")
  const boardDecisionFile = arg("--board-decision")
  const releaseDecisionRecordFile = arg("--release-decision-record")
  const releasePacketFile = arg("--release-packet")
  const approvalPacketFiles = argsMany("--approval-packet")
  const approvalFiles = argsMany("--approval")
  const adoptionReviewFiles = argsMany("--adoption-review")
  const dissentHandlingFiles = argsMany("--dissent-handling")
  const dissentResolutionFiles = argsMany("--dissent-resolution")
  const dissentSupersessionFiles = argsMany("--dissent-supersession")
  const targetKinds = [
    bundleFile,
    decisionBundleFile,
    submissionBundleFile,
    reviewDossierFile,
    boardDecisionFile,
    releaseDecisionRecordFile,
    releasePacketFile,
  ].filter(Boolean)
  if (targetKinds.length !== 1) {
    throw new Error(
      "Provide exactly one of --bundle, --decision-bundle, --submission-bundle, --review-dossier, --board-decision, --release-decision-record, or --release-packet for model-promote mode",
    )
  }
  if (releasePacketFile && (hasArg("--allow-warn") || hasArg("--force"))) {
    throw new Error(
      "--release-packet cannot be combined with --allow-warn or --force because promotion mode is part of the artifact",
    )
  }
  if (
    releasePacketFile &&
    (approvalPacketFiles.length > 0 ||
      approvalFiles.length > 0 ||
      adoptionReviewFiles.length > 0 ||
      dissentHandlingFiles.length > 0 ||
      dissentResolutionFiles.length > 0 ||
      dissentSupersessionFiles.length > 0)
  ) {
    throw new Error("--release-packet cannot be combined with approval, review, or dissent-handling inputs")
  }
  if (releaseDecisionRecordFile && (hasArg("--allow-warn") || hasArg("--force"))) {
    throw new Error(
      "--release-decision-record cannot be combined with --allow-warn or --force because override authorization is part of the artifact",
    )
  }
  if (
    releaseDecisionRecordFile &&
    (approvalPacketFiles.length > 0 ||
      approvalFiles.length > 0 ||
      adoptionReviewFiles.length > 0 ||
      dissentHandlingFiles.length > 0 ||
      dissentResolutionFiles.length > 0 ||
      dissentSupersessionFiles.length > 0)
  ) {
    throw new Error("--release-decision-record cannot be combined with approval, review, or dissent-handling inputs")
  }
  if (boardDecisionFile && (hasArg("--allow-warn") || hasArg("--force"))) {
    throw new Error(
      "--board-decision cannot be combined with --allow-warn or --force because override authorization is part of the artifact",
    )
  }
  if (
    boardDecisionFile &&
    (approvalPacketFiles.length > 0 ||
      approvalFiles.length > 0 ||
      adoptionReviewFiles.length > 0 ||
      dissentHandlingFiles.length > 0 ||
      dissentResolutionFiles.length > 0 ||
      dissentSupersessionFiles.length > 0)
  ) {
    throw new Error("--board-decision cannot be combined with approval, review, or dissent-handling inputs")
  }
  if (
    reviewDossierFile &&
    (approvalPacketFiles.length > 0 ||
      approvalFiles.length > 0 ||
      adoptionReviewFiles.length > 0 ||
      dissentHandlingFiles.length > 0 ||
      dissentResolutionFiles.length > 0 ||
      dissentSupersessionFiles.length > 0)
  ) {
    throw new Error("--review-dossier cannot be combined with approval, review, or dissent-handling inputs")
  }
  if (
    submissionBundleFile &&
    (approvalPacketFiles.length > 0 ||
      approvalFiles.length > 0 ||
      adoptionReviewFiles.length > 0 ||
      dissentHandlingFiles.length > 0 ||
      dissentResolutionFiles.length > 0 ||
      dissentSupersessionFiles.length > 0)
  ) {
    throw new Error("--submission-bundle cannot be combined with approval, review, or dissent-handling inputs")
  }
  if (approvalPacketFiles.length > 1) {
    throw new Error("Provide at most one --approval-packet for model-promote mode")
  }
  if (approvalPacketFiles.length > 0 && !decisionBundleFile) {
    throw new Error("--approval-packet requires --decision-bundle")
  }
  if (
    approvalPacketFiles.length > 0 &&
    (approvalFiles.length > 0 ||
      adoptionReviewFiles.length > 0 ||
      dissentHandlingFiles.length > 0 ||
      dissentResolutionFiles.length > 0 ||
      dissentSupersessionFiles.length > 0)
  ) {
    throw new Error(
      "--approval-packet cannot be combined with --approval, --adoption-review, or dissent-handling inputs",
    )
  }
  if (approvalFiles.length > 0 && !decisionBundleFile) {
    throw new Error("--approval requires --decision-bundle")
  }
  if (adoptionReviewFiles.length > 0 && !decisionBundleFile) {
    throw new Error("--adoption-review requires --decision-bundle")
  }
  if (adoptionReviewFiles.length > 0 && approvalFiles.length === 0) {
    throw new Error("--adoption-review requires at least one --approval")
  }
  if (dissentResolutionFiles.length > 0 && !decisionBundleFile) {
    throw new Error("--dissent-resolution requires --decision-bundle")
  }
  if (dissentResolutionFiles.length > 0 && approvalFiles.length === 0) {
    throw new Error("--dissent-resolution requires at least one --approval")
  }
  if (dissentHandlingFiles.length > 0 && !decisionBundleFile) {
    throw new Error("--dissent-handling requires --decision-bundle")
  }
  if (dissentHandlingFiles.length > 0 && approvalFiles.length === 0) {
    throw new Error("--dissent-handling requires at least one --approval")
  }
  if (dissentHandlingFiles.length > 0 && (dissentResolutionFiles.length > 0 || dissentSupersessionFiles.length > 0)) {
    throw new Error("--dissent-handling cannot be combined with --dissent-resolution or --dissent-supersession")
  }
  if (dissentSupersessionFiles.length > 0 && !decisionBundleFile) {
    throw new Error("--dissent-supersession requires --decision-bundle")
  }
  if (dissentSupersessionFiles.length > 0 && approvalFiles.length === 0) {
    throw new Error("--dissent-supersession requires at least one --approval")
  }
  const archiveSigning = await resolveArchiveSigningInputForCLI()
  if (archiveSigning && !releasePacketFile) {
    throw new Error("Archive signing in model-promote mode currently requires --release-packet")
  }
  const loadedDecisionBundle = decisionBundleFile ? await loadDecisionBundle(decisionBundleFile) : undefined
  const loadedSubmissionBundle = submissionBundleFile
    ? await loadSubmissionBundleArtifact(submissionBundleFile)
    : undefined
  const loadedReviewDossier = reviewDossierFile ? await loadReviewDossierArtifact(reviewDossierFile) : undefined
  const loadedBoardDecision = boardDecisionFile ? await loadBoardDecisionArtifact(boardDecisionFile) : undefined
  const loadedReleaseDecisionRecord = releaseDecisionRecordFile
    ? await loadReleaseDecisionRecordArtifact(releaseDecisionRecordFile)
    : undefined
  const loadedReleasePacket = releasePacketFile ? await loadReleasePacketArtifact(releasePacketFile) : undefined
  const releaseProjectID = loadedReleasePacket
    ? QualityRolloutProjectScope.fromReleasePacket(loadedReleasePacket)
    : loadedReleaseDecisionRecord
      ? QualityRolloutProjectScope.fromReleaseDecisionRecord(loadedReleaseDecisionRecord)
      : loadedBoardDecision
        ? QualityRolloutProjectScope.fromBoardDecision(loadedBoardDecision)
        : loadedReviewDossier
          ? QualityRolloutProjectScope.fromReviewDossier(loadedReviewDossier)
          : loadedSubmissionBundle
            ? QualityRolloutProjectScope.fromSubmissionBundle(loadedSubmissionBundle)
            : loadedDecisionBundle
              ? QualityRolloutProjectScope.fromDecisionBundle(loadedDecisionBundle)
              : null
  const releasePolicyResolution = await resolveReleasePolicyForCLI({
    projectID: releaseProjectID,
  })
  const attestationPolicyResolution = archiveSigning
    ? await resolveSignedArchiveAttestationPolicyForCLI({
        projectID: loadedReleasePacket ? QualityRolloutProjectScope.fromReleasePacket(loadedReleasePacket) : null,
      })
    : undefined

  const result = loadedReleasePacket
    ? await QualityModelRegistry.promoteReleasePacket(loadedReleasePacket, {
        releasePolicyResolution,
        archiveSigning,
        attestationPolicyResolution,
      })
    : loadedReleaseDecisionRecord
      ? await QualityModelRegistry.promoteReleaseDecisionRecord(loadedReleaseDecisionRecord, {
          releasePolicyResolution,
        })
      : loadedBoardDecision
        ? await QualityModelRegistry.promoteBoardDecision(loadedBoardDecision, {
            releasePolicyResolution,
          })
        : loadedReviewDossier
          ? await QualityModelRegistry.promoteReviewDossier(loadedReviewDossier, {
              allowWarn: hasArg("--allow-warn"),
              force: hasArg("--force"),
              releasePolicyResolution,
            })
          : loadedSubmissionBundle
            ? await QualityModelRegistry.promoteSubmissionBundle(loadedSubmissionBundle, {
                allowWarn: hasArg("--allow-warn"),
                force: hasArg("--force"),
                releasePolicyResolution,
              })
            : loadedDecisionBundle
              ? approvalPacketFiles.length > 0
                ? await QualityModelRegistry.promoteApprovedDecisionBundle(loadedDecisionBundle, undefined, {
                    allowWarn: hasArg("--allow-warn"),
                    force: hasArg("--force"),
                    approvalPacket: await loadApprovalPacketArtifact(approvalPacketFiles[0]!),
                    approvalPolicy: releasePolicyResolution.policy.approval,
                    approvalPolicySource: releasePolicyResolution.source,
                    projectID: releasePolicyResolution.projectID,
                    releasePolicyResolution,
                  })
                : approvalFiles.length > 0
                  ? await QualityModelRegistry.promoteApprovedDecisionBundle(
                      loadedDecisionBundle,
                      await Promise.all(approvalFiles.map((file) => loadApprovalArtifact(file))),
                      {
                        allowWarn: hasArg("--allow-warn"),
                        force: hasArg("--force"),
                        adoptionReviews: await Promise.all(
                          adoptionReviewFiles.map((file) => loadAdoptionReviewArtifact(file)),
                        ),
                        dissentHandling:
                          dissentHandlingFiles.length > 0
                            ? await Promise.all(
                                dissentHandlingFiles.map((file) => loadAdoptionDissentHandlingArtifact(file)),
                              )
                            : undefined,
                        dissentResolutions: await Promise.all(
                          dissentResolutionFiles.map((file) => loadAdoptionDissentResolutionArtifact(file)),
                        ),
                        dissentSupersessions: await Promise.all(
                          dissentSupersessionFiles.map((file) => loadAdoptionDissentSupersessionArtifact(file)),
                        ),
                        approvalPolicy: releasePolicyResolution.policy.approval,
                        approvalPolicySource: releasePolicyResolution.source,
                        projectID: releasePolicyResolution.projectID,
                        releasePolicyResolution,
                      },
                    )
                  : await QualityModelRegistry.promoteDecisionBundle(loadedDecisionBundle, {
                      allowWarn: hasArg("--allow-warn"),
                      force: hasArg("--force"),
                      releasePolicyResolution,
                    })
              : await QualityModelRegistry.promote(await loadBenchmarkBundle(bundleFile!), {
                  allowWarn: hasArg("--allow-warn"),
                  force: hasArg("--force"),
                  ...releasePolicyResolution.policy.stability,
                  releasePolicy: {
                    policy: releasePolicyResolution.policy,
                    provenance: QualityPromotionReleasePolicyStore.provenance(releasePolicyResolution),
                  },
                })
  console.log(
    `Promoted model ${result.active.source} with decision ${result.record.decision} (benchmark status ${result.record.benchmark.overallStatus})`,
  )
  if (result.eligibility.decision !== "go") {
    console.log(`Promotion eligibility: ${result.eligibility.decision} (${result.eligibility.requiredOverride})`)
  }
  const canonicalSummary = QualityModelRegistry.summarizeCanonicalPromotion(result.record)
  console.log(
    `Canonical summary: stage=${canonicalSummary.currentStage} · artifact=${canonicalSummary.canonicalArtifactKind}:${canonicalSummary.canonicalArtifactID} · next=${canonicalSummary.nextAction ?? "none"}`,
  )
  if (result.record.approval) {
    console.log(`Promotion approval: ${result.record.approval.approver} · ${result.record.approval.approvalID}`)
  }
  if (result.record.auditManifest) {
    console.log(
      `Audit manifest: ${result.record.auditManifest.manifestID} · mode=${result.record.auditManifest.promotionMode} · overall=${result.record.auditManifest.overallStatus}`,
    )
  }
  if (result.record.exportBundle) {
    console.log(
      `Export bundle: ${result.record.exportBundle.bundleID} · mode=${result.record.exportBundle.promotionMode} · overall=${result.record.exportBundle.overallStatus}`,
    )
  }
  if (result.record.archiveManifest) {
    console.log(
      `Archive manifest: ${result.record.archiveManifest.archiveID} · inventory=${result.record.archiveManifest.inventoryCount} · overall=${result.record.archiveManifest.overallStatus}`,
    )
  }
  if (result.record.handoffPackage) {
    console.log(
      `Handoff package: ${result.record.handoffPackage.packageID} · documents=${result.record.handoffPackage.documentCount} · overall=${result.record.handoffPackage.overallStatus}`,
    )
  }
  if (result.record.portableExport) {
    console.log(
      `Portable export: ${result.record.portableExport.exportID} · files=${result.record.portableExport.fileCount} · overall=${result.record.portableExport.overallStatus}`,
    )
  }
  if (result.record.packagedArchive) {
    console.log(
      `Packaged archive: ${result.record.packagedArchive.archiveID} · entries=${result.record.packagedArchive.entryCount} · overall=${result.record.packagedArchive.overallStatus}`,
    )
  }
  if (result.record.signedArchive) {
    console.log(
      `Signed archive: ${result.record.signedArchive.signedArchiveID} · key=${result.record.signedArchive.keyID} · overall=${result.record.signedArchive.overallStatus}`,
    )
  }
  if (result.record.signedArchiveTrust) {
    console.log(
      `Signed archive trust: ${result.record.signedArchiveTrust.overallStatus} · trusted=${result.record.signedArchiveTrust.trusted} · scope=${result.record.signedArchiveTrust.resolution.scope ?? "none"}`,
    )
  }
  if (result.record.signedArchiveAttestation) {
    console.log(
      `Signed archive attestation: ${result.record.signedArchiveAttestation.overallStatus} · accepted=${result.record.signedArchiveAttestation.acceptedByPolicy} · policy=${result.record.signedArchiveAttestation.policySource}`,
    )
  }
  if (result.record.signedArchiveAttestationRecord) {
    console.log(
      `Signed archive attestation record: ${result.record.signedArchiveAttestationRecord.recordID} · overall=${result.record.signedArchiveAttestationRecord.overallStatus} · policy=${result.record.signedArchiveAttestationRecord.policySource}`,
    )
  }
  if (result.record.signedArchiveAttestationPacket) {
    console.log(
      `Signed archive attestation packet: ${result.record.signedArchiveAttestationPacket.packetID} · overall=${result.record.signedArchiveAttestationPacket.overallStatus} · policy=${result.record.signedArchiveAttestationPacket.policySource}`,
    )
  }
  if (result.record.signedArchiveGovernancePacket) {
    console.log(
      `Signed archive governance packet: ${result.record.signedArchiveGovernancePacket.packetID} · overall=${result.record.signedArchiveGovernancePacket.overallStatus} · policy=${result.record.signedArchiveGovernancePacket.policySource}`,
    )
  }
  if (result.record.signedArchiveReviewDossier) {
    console.log(
      `Signed archive review dossier: ${result.record.signedArchiveReviewDossier.dossierID} · overall=${result.record.signedArchiveReviewDossier.overallStatus} · policy=${result.record.signedArchiveReviewDossier.policySource}`,
    )
  }
  if (result.record.releasePacket) {
    console.log(
      `Release packet: ${result.record.releasePacket.packetID} · mode=${result.record.releasePacket.promotionMode} · authorized=${result.record.releasePacket.authorizedPromotion}`,
    )
  }
  if (result.record.releaseDecisionRecord) {
    console.log(
      `Release decision record: ${result.record.releaseDecisionRecord.recordID} · mode=${result.record.releaseDecisionRecord.promotionMode} · authorized=${result.record.releaseDecisionRecord.authorizedPromotion}`,
    )
  }
  if (result.record.boardDecision) {
    console.log(
      `Board decision: ${result.record.boardDecision.decisionID} · ${result.record.boardDecision.disposition} · override=${result.record.boardDecision.overrideAccepted}`,
    )
  }
  if (result.record.reviewDossier) {
    console.log(
      `Review dossier: ${result.record.reviewDossier.dossierID} · overall=${result.record.reviewDossier.overallStatus} · recommendation=${result.record.reviewDossier.recommendation}`,
    )
  }
  if (result.record.submissionBundle) {
    console.log(
      `Submission bundle: ${result.record.submissionBundle.submissionID} · overall=${result.record.submissionBundle.overallStatus} · decision=${result.record.submissionBundle.eligibilityDecision}`,
    )
  }
  if (result.record.approvalPacket) {
    console.log(
      `Approval packet: ${result.record.approvalPacket.packetID} · approvals=${result.record.approvalPacket.approvalCount} · reviews=${result.record.approvalPacket.adoptionReviewCount} · overall=${result.record.approvalPacket.overallStatus}`,
    )
  }
  if (result.record.adoptionReviews?.[0]) {
    console.log(
      `Adoption review: ${result.record.adoptionReviews[0].reviewer} · ${result.record.adoptionReviews[0].disposition}`,
    )
  }
  if (result.record.adoptionDissentResolution) {
    console.log(
      `Adoption dissent resolution: ${result.record.adoptionDissentResolution.overallStatus} · covered=${result.record.adoptionDissentResolution.coveredQualifiedRejectingReviews}/${result.record.adoptionDissentResolution.totalQualifiedRejectingReviews}`,
    )
  }
  if (result.record.adoptionDissentSupersession) {
    console.log(
      `Adoption dissent supersession: ${result.record.adoptionDissentSupersession.overallStatus} · covered=${result.record.adoptionDissentSupersession.coveredQualifiedRejectingReviews}/${result.record.adoptionDissentSupersession.totalQualifiedRejectingReviews}`,
    )
  }
  if (result.record.adoptionDissentHandling) {
    console.log(
      `Adoption dissent handling: ${result.record.adoptionDissentHandling.overallStatus} · covered=${result.record.adoptionDissentHandling.coveredQualifiedRejectingReviews}/${result.record.adoptionDissentHandling.totalQualifiedRejectingReviews}`,
    )
  }
  if (result.record.approvalPolicy) {
    console.log(
      `Approval policy: ${result.record.approvalPolicy.policySource} · ${result.record.approvalPolicy.overallStatus} · qualified=${result.record.approvalPolicy.qualifiedApprovals}/${result.record.approvalPolicy.requiredApprovals}`,
    )
  }
}

async function modelPromotionsMode() {
  const source = arg("--source")
  const records = await QualityModelRegistry.listPromotions(source)
  if (records.length === 0) {
    console.log("No quality model promotions recorded")
    return
  }
  for (const record of records) {
    console.log(
      `${record.promotedAt} · ${record.source} · decision=${record.decision} · benchmark=${record.benchmark.overallStatus} · eligibility=${record.eligibility?.decision ?? "n/a"} · previous=${record.previousActiveSource ?? "none"}`,
    )
  }
}

async function modelPromotionSummaryMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) {
    throw new Error("--promotion-id is required for model-promotion-summary mode")
  }
  const record = await QualityModelRegistry.getPromotion(promotionID)
  const summary = QualityModelRegistry.summarizeCanonicalPromotion(record)
  const report = QualityModelRegistry.renderCanonicalPromotionReport(summary)
  const summaryOut = path.resolve(process.cwd(), arg("--summary-out") ?? ".tmp/quality-promotion-summary.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-summary.md")

  await write(summaryOut, JSON.stringify(summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelPromotionEligibilityMode() {
  const file = arg("--bundle")
  if (!file) throw new Error("--bundle is required for model-promotion-eligibility mode")
  const bundle = await loadBenchmarkBundle(file)
  const releasePolicyResolution = await resolveReleasePolicyForCLI()
  const { eligibility } = await QualityModelRegistry.evaluatePromotionEligibility(bundle, {
    ...releasePolicyResolution.policy.stability,
    releasePolicyDigest: QualityPromotionReleasePolicyStore.provenance(releasePolicyResolution).digest,
  })
  const report = QualityPromotionEligibility.renderReport(eligibility)
  const summaryOut = path.resolve(process.cwd(), arg("--summary-out") ?? ".tmp/quality-promotion-eligibility.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-eligibility.md")

  await write(summaryOut, JSON.stringify(eligibility, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelDecisionBundleMode() {
  const file = arg("--bundle")
  if (!file) throw new Error("--bundle is required for model-decision-bundle mode")
  const bundle = await loadBenchmarkBundle(file)
  const releasePolicyResolution = await resolveReleasePolicyForCLI()
  const { decisionBundle } = await QualityModelRegistry.buildPromotionDecisionBundle(bundle, {
    ...releasePolicyResolution.policy.stability,
    releasePolicyResolution,
  })
  const report = QualityPromotionDecisionBundle.renderReport(decisionBundle)
  const bundleOut = path.resolve(process.cwd(), arg("--bundle-out") ?? ".tmp/quality-promotion-decision-bundle.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-decision-bundle.md")

  await write(bundleOut, JSON.stringify(decisionBundle, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelApprovalCreateMode() {
  const file = arg("--decision-bundle")
  const approver = arg("--approver")
  if (!file || !approver)
    throw new Error("--decision-bundle and --approver are required for model-approval-create mode")
  const approval = QualityPromotionApproval.create({
    bundle: await loadDecisionBundle(file),
    approver,
    role: arg("--role") ?? null,
    team: arg("--team") ?? null,
    reportingChain: arg("--reporting-chain") ?? null,
    disposition: (arg("--disposition") as "approved" | "rejected" | undefined) ?? undefined,
    rationale: arg("--rationale") ?? null,
  })
  await QualityPromotionApproval.append(approval)
  const report = QualityPromotionApproval.renderReport(approval)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-approval.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-approval.md")

  await write(out, JSON.stringify(approval, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelAdoptionReviewCreateMode() {
  const file = arg("--decision-bundle")
  const reviewer = arg("--reviewer")
  if (!file || !reviewer)
    throw new Error("--decision-bundle and --reviewer are required for model-adoption-review-create mode")
  const review = QualityPromotionAdoptionReview.create({
    bundle: await loadDecisionBundle(file),
    reviewer,
    role: arg("--role") ?? null,
    disposition: (arg("--disposition") as QualityPromotionAdoptionReview.Disposition | undefined) ?? undefined,
    rationale: arg("--rationale") ?? null,
  })
  await QualityPromotionAdoptionReview.append(review)
  const report = QualityPromotionAdoptionReview.renderReport(review)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-adoption-review.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-adoption-review.md")

  await write(out, JSON.stringify(review, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelAdoptionReviewsMode() {
  const records = await QualityPromotionAdoptionReview.list(arg("--source"))
  if (records.length === 0) {
    console.log("No quality model adoption reviews recorded")
    return
  }
  for (const record of records) {
    console.log(
      `${record.reviewedAt} · ${record.source} · ${record.disposition} · ${record.reviewer} · adoption=${record.suggestion.adoptionStatus}`,
    )
  }
}

async function modelAdoptionReviewConsensusMode() {
  const file = arg("--decision-bundle")
  if (!file) throw new Error("--decision-bundle is required for model-adoption-review-consensus mode")
  const bundle = await loadDecisionBundle(file)
  const reviews = await Promise.all(
    argsMany("--adoption-review").map((reviewFile) => loadAdoptionReviewArtifact(reviewFile)),
  )
  const resolvedReviews = await QualityPromotionAdoptionReview.resolveForBundle(bundle, reviews)
  const summary = QualityPromotionAdoptionReview.evaluate(bundle, resolvedReviews)
  const report = QualityPromotionAdoptionReview.renderConsensus(summary)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-adoption-review-consensus.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-adoption-review-consensus.md",
  )

  await write(summaryOut, JSON.stringify(summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelAdoptionDissentResolutionCreateMode() {
  const file = arg("--decision-bundle")
  const resolver = arg("--resolver")
  if (!file || !resolver) {
    throw new Error("--decision-bundle and --resolver are required for model-adoption-dissent-resolution-create mode")
  }
  const bundle = await loadDecisionBundle(file)
  const explicitTargetReviews = await Promise.all(
    argsMany("--adoption-review").map((reviewFile) => loadAdoptionReviewArtifact(reviewFile)),
  )
  const targetReviews =
    explicitTargetReviews.length > 0
      ? explicitTargetReviews
      : (await QualityPromotionAdoptionReview.resolveForBundle(bundle)).filter(
          (review) => review.disposition === "rejected",
        )
  if (targetReviews.length === 0) {
    throw new Error(`No rejected adoption reviews available for decision bundle ${bundle.source}`)
  }
  const resolution = QualityPromotionAdoptionDissentResolution.create({
    bundle,
    targetReviews,
    resolver,
    role: arg("--role") ?? null,
    rationale: arg("--rationale") ?? "",
  })
  await QualityPromotionAdoptionDissentResolution.append(resolution)
  const report = QualityPromotionAdoptionDissentResolution.renderReport(resolution)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-adoption-dissent-resolution.json")
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-adoption-dissent-resolution.md",
  )

  await write(out, JSON.stringify(resolution, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelAdoptionDissentResolutionsMode() {
  const records = await QualityPromotionAdoptionDissentResolution.list(arg("--source"))
  if (records.length === 0) {
    console.log("No quality model adoption dissent resolutions recorded")
    return
  }
  for (const record of records) {
    console.log(
      `${record.resolvedAt} · ${record.source} · ${record.resolver} · targets=${record.targetReviews.length} · adoption=${record.suggestion.adoptionStatus}`,
    )
  }
}

async function modelAdoptionDissentSupersessionCreateMode() {
  const file = arg("--decision-bundle")
  const superseder = arg("--superseder")
  const disposition = arg("--disposition") as QualityPromotionAdoptionDissentSupersession.Disposition | undefined
  if (!file || !superseder || !disposition) {
    throw new Error(
      "--decision-bundle, --superseder, and --disposition are required for model-adoption-dissent-supersession-create mode",
    )
  }
  const bundle = await loadDecisionBundle(file)
  const explicitTargetReviews = await Promise.all(
    argsMany("--adoption-review").map((reviewFile) => loadAdoptionReviewArtifact(reviewFile)),
  )
  const targetReviews =
    explicitTargetReviews.length > 0
      ? explicitTargetReviews
      : (await QualityPromotionAdoptionReview.resolveForBundle(bundle)).filter(
          (review) => review.disposition === "rejected",
        )
  if (targetReviews.length === 0) {
    throw new Error(`No rejected adoption reviews available for decision bundle ${bundle.source}`)
  }
  const supersession = QualityPromotionAdoptionDissentSupersession.create({
    bundle,
    targetReviews,
    superseder,
    role: arg("--role") ?? null,
    disposition,
    rationale: arg("--rationale") ?? "",
  })
  await QualityPromotionAdoptionDissentSupersession.append(supersession)
  const report = QualityPromotionAdoptionDissentSupersession.renderReport(supersession)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-adoption-dissent-supersession.json")
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-adoption-dissent-supersession.md",
  )

  await write(out, JSON.stringify(supersession, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelAdoptionDissentSupersessionsMode() {
  const records = await QualityPromotionAdoptionDissentSupersession.list(arg("--source"))
  if (records.length === 0) {
    console.log("No quality model adoption dissent supersessions recorded")
    return
  }
  for (const record of records) {
    console.log(
      `${record.supersededAt} · ${record.source} · ${record.superseder} · ${record.disposition} · targets=${record.targetReviews.length} · adoption=${record.suggestion.adoptionStatus}`,
    )
  }
}

async function modelAdoptionDissentHandlingCreateMode() {
  const file = arg("--decision-bundle")
  if (!file) {
    throw new Error("--decision-bundle is required for model-adoption-dissent-handling-create mode")
  }
  const bundle = await loadDecisionBundle(file)
  const reviews = await QualityPromotionAdoptionReview.resolveForBundle(
    bundle,
    await Promise.all(argsMany("--adoption-review").map((reviewFile) => loadAdoptionReviewArtifact(reviewFile))),
  )
  const resolutions = await QualityPromotionAdoptionDissentResolution.resolveForBundle(
    bundle,
    await Promise.all(
      argsMany("--dissent-resolution").map((resolutionFile) => loadAdoptionDissentResolutionArtifact(resolutionFile)),
    ),
  )
  const supersessions = await QualityPromotionAdoptionDissentSupersession.resolveForBundle(
    bundle,
    await Promise.all(
      argsMany("--dissent-supersession").map((supersessionFile) =>
        loadAdoptionDissentSupersessionArtifact(supersessionFile),
      ),
    ),
  )
  const handling = QualityPromotionAdoptionDissentHandling.create({
    bundle,
    reviews,
    resolutions,
    supersessions,
  })
  await QualityPromotionAdoptionDissentHandling.append(handling)
  const report = QualityPromotionAdoptionDissentHandling.renderReport(handling)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-adoption-dissent-handling.json")
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-adoption-dissent-handling.md",
  )

  await write(out, JSON.stringify(handling, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelAdoptionDissentHandlingsMode() {
  const records = await QualityPromotionAdoptionDissentHandling.list(arg("--source"))
  if (records.length === 0) {
    console.log("No quality model adoption dissent handling bundles recorded")
    return
  }
  for (const record of records) {
    console.log(
      `${record.handledAt} · ${record.source} · handling=${record.handlingID} · qualified_rejecting=${record.qualifiedRejectingReviews.length} · resolutions=${record.resolutions.length} · supersessions=${record.supersessions.length} · overall=${record.summary.overallStatus}`,
    )
  }
}

async function modelAdoptionDissentHandlingStatusMode() {
  const file = arg("--decision-bundle")
  if (!file) {
    throw new Error("--decision-bundle is required for model-adoption-dissent-handling-status mode")
  }
  const bundle = await loadDecisionBundle(file)
  const reviews = await QualityPromotionAdoptionReview.resolveForBundle(
    bundle,
    await Promise.all(argsMany("--adoption-review").map((reviewFile) => loadAdoptionReviewArtifact(reviewFile))),
  )
  const explicitHandlings = await Promise.all(
    argsMany("--dissent-handling").map((handlingFile) => loadAdoptionDissentHandlingArtifact(handlingFile)),
  )
  const resolvedHandlings = await QualityPromotionAdoptionDissentHandling.resolveForBundle(
    bundle,
    reviews,
    explicitHandlings,
  )
  const handling =
    resolvedHandlings.at(-1) ??
    QualityPromotionAdoptionDissentHandling.create({
      bundle,
      reviews,
      resolutions: await QualityPromotionAdoptionDissentResolution.resolveForBundle(
        bundle,
        await Promise.all(
          argsMany("--dissent-resolution").map((resolutionFile) =>
            loadAdoptionDissentResolutionArtifact(resolutionFile),
          ),
        ),
      ),
      supersessions: await QualityPromotionAdoptionDissentSupersession.resolveForBundle(
        bundle,
        await Promise.all(
          argsMany("--dissent-supersession").map((supersessionFile) =>
            loadAdoptionDissentSupersessionArtifact(supersessionFile),
          ),
        ),
      ),
    })
  const report = QualityPromotionAdoptionDissentHandling.renderReport(handling)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-adoption-dissent-handling-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-adoption-dissent-handling-summary.md",
  )

  await write(summaryOut, JSON.stringify(handling.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelAdoptionDissentSupersessionStatusMode() {
  const file = arg("--decision-bundle")
  if (!file) {
    throw new Error("--decision-bundle is required for model-adoption-dissent-supersession-status mode")
  }
  const bundle = await loadDecisionBundle(file)
  const reviews = await Promise.all(
    argsMany("--adoption-review").map((reviewFile) => loadAdoptionReviewArtifact(reviewFile)),
  )
  const supersessions = await Promise.all(
    argsMany("--dissent-supersession").map((supersessionFile) =>
      loadAdoptionDissentSupersessionArtifact(supersessionFile),
    ),
  )
  const resolvedReviews = await QualityPromotionAdoptionReview.resolveForBundle(bundle, reviews)
  const resolvedSupersessions = await QualityPromotionAdoptionDissentSupersession.resolveForBundle(
    bundle,
    supersessions,
  )
  const summary = QualityPromotionAdoptionDissentSupersession.evaluate(bundle, resolvedReviews, resolvedSupersessions)
  const report = QualityPromotionAdoptionDissentSupersession.renderSummary(summary)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-adoption-dissent-supersession-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-adoption-dissent-supersession-summary.md",
  )

  await write(summaryOut, JSON.stringify(summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelAdoptionDissentResolutionStatusMode() {
  const file = arg("--decision-bundle")
  if (!file) {
    throw new Error("--decision-bundle is required for model-adoption-dissent-resolution-status mode")
  }
  const bundle = await loadDecisionBundle(file)
  const reviews = await Promise.all(
    argsMany("--adoption-review").map((reviewFile) => loadAdoptionReviewArtifact(reviewFile)),
  )
  const resolutions = await Promise.all(
    argsMany("--dissent-resolution").map((resolutionFile) => loadAdoptionDissentResolutionArtifact(resolutionFile)),
  )
  const resolvedReviews = await QualityPromotionAdoptionReview.resolveForBundle(bundle, reviews)
  const resolvedResolutions = await QualityPromotionAdoptionDissentResolution.resolveForBundle(bundle, resolutions)
  const summary = QualityPromotionAdoptionDissentResolution.evaluate(bundle, resolvedReviews, resolvedResolutions)
  const report = QualityPromotionAdoptionDissentResolution.renderSummary(summary)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-adoption-dissent-resolution-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-adoption-dissent-resolution-summary.md",
  )

  await write(summaryOut, JSON.stringify(summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelApprovalsMode() {
  const records = await QualityPromotionApproval.list(arg("--source"))
  if (records.length === 0) {
    console.log("No quality model approvals recorded")
    return
  }
  for (const record of records) {
    console.log(
      `${record.approvedAt} · ${record.source} · ${record.disposition} · ${record.approver} · team=${record.team ?? "n/a"} · chain=${record.reportingChain ?? "n/a"} · decision=${record.decisionBundle.decision}`,
    )
  }
}

async function modelApprovalPacketCreateMode() {
  const file = arg("--decision-bundle")
  if (!file) throw new Error("--decision-bundle is required for model-approval-packet-create mode")
  const bundle = await loadDecisionBundle(file)
  const approvals = await QualityPromotionApprovalPacket.resolveApprovalsForBundle(
    bundle,
    await Promise.all(argsMany("--approval").map((approvalFile) => loadApprovalArtifact(approvalFile))),
  )
  const adoptionReviews = await QualityPromotionAdoptionReview.resolveForBundle(
    bundle,
    await Promise.all(argsMany("--adoption-review").map((reviewFile) => loadAdoptionReviewArtifact(reviewFile))),
  )
  const explicitHandling = await Promise.all(
    argsMany("--dissent-handling").map((handlingFile) => loadAdoptionDissentHandlingArtifact(handlingFile)),
  )
  const dissentHandling =
    explicitHandling.length > 0
      ? (await QualityPromotionAdoptionDissentHandling.resolveForBundle(bundle, adoptionReviews, explicitHandling)).at(
          -1,
        )
      : undefined
  const packet = QualityPromotionApprovalPacket.create({
    bundle,
    approvals,
    adoptionReviews,
    dissentHandling,
  })
  await QualityPromotionApprovalPacket.append(packet)
  const report = QualityPromotionApprovalPacket.renderReport(packet)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-approval-packet.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-approval-packet.md")

  await write(out, JSON.stringify(packet, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelApprovalPacketsMode() {
  const records = await QualityPromotionApprovalPacket.list(arg("--source"))
  if (records.length === 0) {
    console.log("No quality model approval packets recorded")
    return
  }
  for (const record of records) {
    console.log(
      `${record.createdAt} · ${record.source} · packet=${record.packetID} · approvals=${record.approvals.length} · reviews=${record.adoptionReviews.length} · overall=${record.readiness.overallStatus}`,
    )
  }
}

async function modelApprovalPacketStatusMode() {
  const file = arg("--decision-bundle")
  if (!file) throw new Error("--decision-bundle is required for model-approval-packet-status mode")
  const bundle = await loadDecisionBundle(file)
  const explicitPackets = await Promise.all(
    argsMany("--approval-packet").map((packetFile) => loadApprovalPacketArtifact(packetFile)),
  )
  const resolvedPackets = await QualityPromotionApprovalPacket.resolveForBundle(bundle, explicitPackets)
  const packet =
    resolvedPackets.at(-1) ??
    QualityPromotionApprovalPacket.create({
      bundle,
      approvals: await QualityPromotionApprovalPacket.resolveApprovalsForBundle(
        bundle,
        await Promise.all(argsMany("--approval").map((approvalFile) => loadApprovalArtifact(approvalFile))),
      ),
      adoptionReviews: await QualityPromotionAdoptionReview.resolveForBundle(
        bundle,
        await Promise.all(argsMany("--adoption-review").map((reviewFile) => loadAdoptionReviewArtifact(reviewFile))),
      ),
      dissentHandling: (
        await QualityPromotionAdoptionDissentHandling.resolveForBundle(
          bundle,
          await QualityPromotionAdoptionReview.resolveForBundle(
            bundle,
            await Promise.all(
              argsMany("--adoption-review").map((reviewFile) => loadAdoptionReviewArtifact(reviewFile)),
            ),
          ),
          await Promise.all(
            argsMany("--dissent-handling").map((handlingFile) => loadAdoptionDissentHandlingArtifact(handlingFile)),
          ),
        )
      ).at(-1),
    })
  const report = QualityPromotionApprovalPacket.renderReport(packet)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-approval-packet-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-approval-packet-summary.md",
  )

  await write(summaryOut, JSON.stringify(packet.readiness, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSubmissionBundleCreateMode() {
  const decisionBundleFile = arg("--decision-bundle")
  if (!decisionBundleFile) throw new Error("--decision-bundle is required for model-submission-bundle-create mode")
  const decisionBundle = await loadDecisionBundle(decisionBundleFile)
  const submissionBundle = QualityPromotionSubmissionBundle.create({
    decisionBundle,
    approvalPacket: await resolveApprovalPacketForDecisionBundle(decisionBundle),
  })
  await QualityPromotionSubmissionBundle.append(submissionBundle)
  const report = QualityPromotionSubmissionBundle.renderReport(submissionBundle)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-submission-bundle.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-submission-bundle.md")

  await write(out, JSON.stringify(submissionBundle, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSubmissionBundlesMode() {
  const records = await QualityPromotionSubmissionBundle.list(arg("--source"))
  if (records.length === 0) {
    console.log("No quality model submission bundles recorded")
    return
  }
  for (const record of records) {
    console.log(
      `${record.createdAt} · ${record.source} · submission=${record.submissionID} · packet=${record.approvalPacket.packetID} · overall=${record.summary.overallStatus}`,
    )
  }
}

async function modelSubmissionBundleStatusMode() {
  const decisionBundleFile = arg("--decision-bundle")
  if (!decisionBundleFile) throw new Error("--decision-bundle is required for model-submission-bundle-status mode")
  const decisionBundle = await loadDecisionBundle(decisionBundleFile)
  const explicitSubmissions = await Promise.all(
    argsMany("--submission-bundle").map((submissionFile) => loadSubmissionBundleArtifact(submissionFile)),
  )
  const submission = await resolveSubmissionBundleForDecisionBundle(decisionBundle, explicitSubmissions)
  const report = QualityPromotionSubmissionBundle.renderReport(submission)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-submission-bundle-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-submission-bundle-summary.md",
  )

  await write(summaryOut, JSON.stringify(submission.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelReviewDossierCreateMode() {
  const decisionBundleFile = arg("--decision-bundle")
  if (!decisionBundleFile) throw new Error("--decision-bundle is required for model-review-dossier-create mode")
  const decisionBundle = await loadDecisionBundle(decisionBundleFile)
  const dossier = QualityPromotionReviewDossier.create({
    submissionBundle: await resolveSubmissionBundleForDecisionBundle(decisionBundle),
  })
  await QualityPromotionReviewDossier.append(dossier)
  const report = QualityPromotionReviewDossier.renderReport(dossier)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-review-dossier.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-review-dossier.md")

  await write(out, JSON.stringify(dossier, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelReviewDossiersMode() {
  const records = await QualityPromotionReviewDossier.list(arg("--source"))
  if (records.length === 0) {
    console.log("No quality model review dossiers recorded")
    return
  }
  for (const record of records) {
    console.log(
      `${record.createdAt} · ${record.source} · dossier=${record.dossierID} · submission=${record.submissionBundle.submissionID} · recommendation=${record.summary.recommendation} · overall=${record.summary.overallStatus}`,
    )
  }
}

async function modelReviewDossierStatusMode() {
  const decisionBundleFile = arg("--decision-bundle")
  if (!decisionBundleFile) throw new Error("--decision-bundle is required for model-review-dossier-status mode")
  const decisionBundle = await loadDecisionBundle(decisionBundleFile)
  const explicitDossiers = await Promise.all(
    argsMany("--review-dossier").map((dossierFile) => loadReviewDossierArtifact(dossierFile)),
  )
  const dossier = await resolveReviewDossierForDecisionBundle(decisionBundle, explicitDossiers)
  const report = QualityPromotionReviewDossier.renderReport(dossier)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-review-dossier-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-review-dossier-summary.md",
  )

  await write(summaryOut, JSON.stringify(dossier.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelBoardDecisionCreateMode() {
  const decisionBundleFile = arg("--decision-bundle")
  if (!decisionBundleFile) throw new Error("--decision-bundle is required for model-board-decision-create mode")
  const decisionBundle = await loadDecisionBundle(decisionBundleFile)
  const boardDecision = createBoardDecisionFromDossier(await resolveReviewDossierForDecisionBundle(decisionBundle))
  await QualityPromotionBoardDecision.append(boardDecision)
  const report = QualityPromotionBoardDecision.renderReport(boardDecision)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-board-decision.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-board-decision.md")

  await write(out, JSON.stringify(boardDecision, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelBoardDecisionsMode() {
  const records = await QualityPromotionBoardDecision.list(arg("--source"))
  if (records.length === 0) {
    console.log("No quality model board decisions recorded")
    return
  }
  for (const record of records) {
    console.log(
      `${record.decidedAt} · ${record.source} · board-decision=${record.decisionID} · ${record.disposition} · override=${record.overrideAccepted} · decider=${record.decider}`,
    )
  }
}

async function modelBoardDecisionStatusMode() {
  const decisionBundleFile = arg("--decision-bundle")
  if (!decisionBundleFile) throw new Error("--decision-bundle is required for model-board-decision-status mode")
  const decisionBundle = await loadDecisionBundle(decisionBundleFile)
  const explicitDecisions = await Promise.all(
    argsMany("--board-decision").map((decisionFile) => loadBoardDecisionArtifact(decisionFile)),
  )
  const boardDecision =
    (await QualityPromotionBoardDecision.resolveForBundle(decisionBundle, explicitDecisions)).at(-1) ??
    createBoardDecisionFromDossier(await resolveReviewDossierForDecisionBundle(decisionBundle))
  const report = QualityPromotionBoardDecision.renderReport(boardDecision)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-board-decision-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-board-decision-summary.md",
  )

  await write(summaryOut, JSON.stringify(boardDecision.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelReleaseDecisionRecordCreateMode() {
  const decisionBundleFile = arg("--decision-bundle")
  if (!decisionBundleFile)
    throw new Error("--decision-bundle is required for model-release-decision-record-create mode")
  const decisionBundle = await loadDecisionBundle(decisionBundleFile)
  const record = QualityPromotionReleaseDecisionRecord.create({
    boardDecision: await resolveBoardDecisionForDecisionBundle(decisionBundle),
  })
  await QualityPromotionReleaseDecisionRecord.append(record)
  const report = QualityPromotionReleaseDecisionRecord.renderReport(record)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-release-decision-record.json")
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-release-decision-record.md",
  )

  await write(out, JSON.stringify(record, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelReleaseDecisionRecordsMode() {
  const records = await QualityPromotionReleaseDecisionRecord.list(arg("--source"))
  if (records.length === 0) {
    console.log("No quality model release decision records recorded")
    return
  }
  for (const record of records) {
    console.log(
      `${record.recordedAt} · ${record.source} · release-decision-record=${record.recordID} · mode=${record.summary.promotionMode} · authorized=${record.summary.authorizedPromotion} · disposition=${record.summary.disposition}`,
    )
  }
}

async function modelReleaseDecisionRecordStatusMode() {
  const decisionBundleFile = arg("--decision-bundle")
  if (!decisionBundleFile)
    throw new Error("--decision-bundle is required for model-release-decision-record-status mode")
  const decisionBundle = await loadDecisionBundle(decisionBundleFile)
  const explicitRecords = await Promise.all(
    argsMany("--release-decision-record").map((recordFile) => loadReleaseDecisionRecordArtifact(recordFile)),
  )
  const record = await resolveReleaseDecisionRecordForDecisionBundle(decisionBundle, explicitRecords)
  const report = QualityPromotionReleaseDecisionRecord.renderReport(record)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-release-decision-record-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-release-decision-record-summary.md",
  )

  await write(summaryOut, JSON.stringify(record.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelReleasePacketCreateMode() {
  const decisionBundleFile = arg("--decision-bundle")
  if (!decisionBundleFile) throw new Error("--decision-bundle is required for model-release-packet-create mode")
  const decisionBundle = await loadDecisionBundle(decisionBundleFile)
  const packet = QualityPromotionReleasePacket.create({
    releaseDecisionRecord: await resolveReleaseDecisionRecordForDecisionBundle(decisionBundle),
  })
  await QualityPromotionReleasePacket.append(packet)
  const report = QualityPromotionReleasePacket.renderReport(packet)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-release-packet.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-release-packet.md")

  await write(out, JSON.stringify(packet, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelReleasePacketsMode() {
  const packets = await QualityPromotionReleasePacket.list(arg("--source"))
  if (packets.length === 0) {
    console.log("No quality model release packets recorded")
    return
  }
  for (const packet of packets) {
    console.log(
      `${packet.createdAt} · ${packet.source} · release-packet=${packet.packetID} · mode=${packet.summary.promotionMode} · authorized=${packet.summary.authorizedPromotion}`,
    )
  }
}

async function modelReleasePacketStatusMode() {
  const decisionBundleFile = arg("--decision-bundle")
  if (!decisionBundleFile) throw new Error("--decision-bundle is required for model-release-packet-status mode")
  const decisionBundle = await loadDecisionBundle(decisionBundleFile)
  const explicitPackets = await Promise.all(
    argsMany("--release-packet").map((packetFile) => loadReleasePacketArtifact(packetFile)),
  )
  const packet = await resolveReleasePacketForDecisionBundle(decisionBundle, explicitPackets)
  const report = QualityPromotionReleasePacket.renderReport(packet)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-release-packet-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-release-packet-summary.md",
  )

  await write(summaryOut, JSON.stringify(packet.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelAuditManifestCreateMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-audit-manifest-create mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const manifest = QualityPromotionAuditManifest.create({
    releasePacket: await resolveReleasePacketForPromotion(promotion),
    promotion: QualityPromotionAuditManifest.PromotionSnapshot.parse({
      promotionID: promotion.promotionID,
      source: promotion.source,
      promotedAt: promotion.promotedAt,
      previousActiveSource: promotion.previousActiveSource,
      decision: promotion.decision,
      decisionBundleCreatedAt: promotion.decisionBundleCreatedAt ?? null,
      boardDecision: promotion.boardDecision,
      releaseDecisionRecord: promotion.releaseDecisionRecord,
      releasePacket: promotion.releasePacket,
      reviewDossier: promotion.reviewDossier,
      submissionBundle: promotion.submissionBundle,
      approvalPacket: promotion.approvalPacket,
    }),
  })
  await QualityPromotionAuditManifest.append(manifest)
  const report = QualityPromotionAuditManifest.renderReport(manifest)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-audit-manifest.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-audit-manifest.md")

  await write(out, JSON.stringify(manifest, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelAuditManifestsMode() {
  const manifests = await QualityPromotionAuditManifest.list(arg("--source"))
  if (manifests.length === 0) {
    console.log("No quality model audit manifests recorded")
    return
  }
  for (const manifest of manifests) {
    console.log(
      `${manifest.createdAt} · ${manifest.source} · audit-manifest=${manifest.manifestID} · promotion=${manifest.promotion.promotionID} · mode=${manifest.summary.promotionMode} · overall=${manifest.summary.overallStatus}`,
    )
  }
}

async function modelAuditManifestStatusMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-audit-manifest-status mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitManifests = await Promise.all(
    argsMany("--audit-manifest").map((manifestFile) => loadAuditManifestArtifact(manifestFile)),
  )
  const manifest = await resolveAuditManifestForPromotion(promotion, explicitManifests)
  const report = QualityPromotionAuditManifest.renderReport(manifest)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-audit-manifest-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-audit-manifest-summary.md",
  )

  await write(summaryOut, JSON.stringify(manifest.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelExportBundleCreateMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-export-bundle-create mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const bundle = QualityPromotionExportBundle.create({
    auditManifest: await resolveAuditManifestForPromotion(promotion),
  })
  await QualityPromotionExportBundle.append(bundle)
  const report = QualityPromotionExportBundle.renderReport(bundle)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-export-bundle.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-export-bundle.md")

  await write(out, JSON.stringify(bundle, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelExportBundlesMode() {
  const bundles = await QualityPromotionExportBundle.list(arg("--source"))
  if (bundles.length === 0) {
    console.log("No quality model export bundles recorded")
    return
  }
  for (const bundle of bundles) {
    console.log(
      `${bundle.createdAt} · ${bundle.source} · export-bundle=${bundle.bundleID} · promotion=${bundle.auditManifest.promotion.promotionID} · mode=${bundle.summary.promotionMode} · overall=${bundle.summary.overallStatus}`,
    )
  }
}

async function modelExportBundleStatusMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-export-bundle-status mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitBundles = await Promise.all(
    argsMany("--export-bundle").map((bundleFile) => loadExportBundleArtifact(bundleFile)),
  )
  const bundle = await resolveExportBundleForPromotion(promotion, explicitBundles)
  const report = QualityPromotionExportBundle.renderReport(bundle)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-export-bundle-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-export-bundle-summary.md",
  )

  await write(summaryOut, JSON.stringify(bundle.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelArchiveManifestCreateMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-archive-manifest-create mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const archive = QualityPromotionArchiveManifest.create({
    exportBundle: await resolveExportBundleForPromotion(promotion),
  })
  await QualityPromotionArchiveManifest.append(archive)
  const report = QualityPromotionArchiveManifest.renderReport(archive)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-archive-manifest.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-archive-manifest.md")

  await write(out, JSON.stringify(archive, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelArchiveManifestsMode() {
  const archives = await QualityPromotionArchiveManifest.list(arg("--source"))
  if (archives.length === 0) {
    console.log("No quality model archive manifests recorded")
    return
  }
  for (const archive of archives) {
    console.log(
      `${archive.createdAt} · ${archive.source} · archive-manifest=${archive.archiveID} · promotion=${archive.exportBundle.auditManifest.promotion.promotionID} · inventory=${archive.summary.inventoryCount} · overall=${archive.summary.overallStatus}`,
    )
  }
}

async function modelArchiveManifestStatusMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-archive-manifest-status mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitArchives = await Promise.all(
    argsMany("--archive-manifest").map((archiveFile) => loadArchiveManifestArtifact(archiveFile)),
  )
  const archive = await resolveArchiveManifestForPromotion(promotion, explicitArchives)
  const report = QualityPromotionArchiveManifest.renderReport(archive)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-archive-manifest-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-archive-manifest-summary.md",
  )

  await write(summaryOut, JSON.stringify(archive.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelHandoffPackageCreateMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-handoff-package-create mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const packet = QualityPromotionHandoffPackage.create({
    archiveManifest: await resolveArchiveManifestForPromotion(promotion),
  })
  await QualityPromotionHandoffPackage.append(packet)
  const report = QualityPromotionHandoffPackage.renderReport(packet)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-handoff-package.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-handoff-package.md")

  await write(out, JSON.stringify(packet, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelHandoffPackagesMode() {
  const packets = await QualityPromotionHandoffPackage.list(arg("--source"))
  if (packets.length === 0) {
    console.log("No quality model handoff packages recorded")
    return
  }
  for (const packet of packets) {
    console.log(
      `${packet.createdAt} · ${packet.source} · handoff-package=${packet.packageID} · promotion=${packet.archiveManifest.exportBundle.auditManifest.promotion.promotionID} · documents=${packet.summary.documentCount} · overall=${packet.summary.overallStatus}`,
    )
  }
}

async function modelHandoffPackageStatusMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-handoff-package-status mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitPackets = await Promise.all(
    argsMany("--handoff-package").map((packetFile) => loadHandoffPackageArtifact(packetFile)),
  )
  const packet = await resolveHandoffPackageForPromotion(promotion, explicitPackets)
  const report = QualityPromotionHandoffPackage.renderReport(packet)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-handoff-package-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-handoff-package-summary.md",
  )

  await write(summaryOut, JSON.stringify(packet.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelPortableExportCreateMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-portable-export-create mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const exportArtifact = QualityPromotionPortableExport.create({
    handoffPackage: await resolveHandoffPackageForPromotion(promotion),
  })
  await QualityPromotionPortableExport.append(exportArtifact)
  const report = QualityPromotionPortableExport.renderReport(exportArtifact)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-portable-export.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-portable-export.md")

  await write(out, JSON.stringify(exportArtifact, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelPortableExportsMode() {
  const exports = await QualityPromotionPortableExport.list(arg("--source"))
  if (exports.length === 0) {
    console.log("No quality model portable exports recorded")
    return
  }
  for (const exportArtifact of exports) {
    console.log(
      `${exportArtifact.createdAt} · ${exportArtifact.source} · portable-export=${exportArtifact.exportID} · promotion=${exportArtifact.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID} · files=${exportArtifact.summary.fileCount} · overall=${exportArtifact.summary.overallStatus}`,
    )
  }
}

async function modelPortableExportStatusMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-portable-export-status mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitExports = await Promise.all(
    argsMany("--portable-export").map((file) => loadPortableExportArtifact(file)),
  )
  const exportArtifact = await resolvePortableExportForPromotion(promotion, explicitExports)
  const report = QualityPromotionPortableExport.renderReport(exportArtifact)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-portable-export-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-portable-export-summary.md",
  )

  await write(summaryOut, JSON.stringify(exportArtifact.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelPortableExportWriteMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-portable-export-write mode")
  const outDir = arg("--out-dir")
  if (!outDir) throw new Error("--out-dir is required for model-portable-export-write mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitExports = await Promise.all(
    argsMany("--portable-export").map((file) => loadPortableExportArtifact(file)),
  )
  const exportArtifact = await resolvePortableExportForPromotion(promotion, explicitExports)
  const result = await QualityPromotionPortableExport.materialize(exportArtifact, path.resolve(process.cwd(), outDir))
  console.log(`Wrote portable export ${exportArtifact.exportID} to ${result.directory} (${result.fileCount} files)`)
}

async function modelPackagedArchiveCreateMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-packaged-archive-create mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const archive = QualityPromotionPackagedArchive.create({
    portableExport: await resolvePortableExportForPromotion(promotion),
  })
  await QualityPromotionPackagedArchive.append(archive)
  const report = QualityPromotionPackagedArchive.renderReport(archive)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-packaged-archive.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-packaged-archive.md")

  await write(out, JSON.stringify(archive, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelPackagedArchivesMode() {
  const archives = await QualityPromotionPackagedArchive.list(arg("--source"))
  if (archives.length === 0) {
    console.log("No quality model packaged archives recorded")
    return
  }
  for (const archive of archives) {
    console.log(
      `${archive.createdAt} · ${archive.source} · packaged-archive=${archive.archiveID} · promotion=${archive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID} · entries=${archive.summary.entryCount} · overall=${archive.summary.overallStatus}`,
    )
  }
}

async function modelPackagedArchiveStatusMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-packaged-archive-status mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitArchives = await Promise.all(
    argsMany("--packaged-archive").map((file) => loadPackagedArchiveArtifact(file)),
  )
  const archive = await resolvePackagedArchiveForPromotion(promotion, explicitArchives)
  const report = QualityPromotionPackagedArchive.renderReport(archive)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-packaged-archive-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-packaged-archive-summary.md",
  )

  await write(summaryOut, JSON.stringify(archive.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelPackagedArchiveWriteMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-packaged-archive-write mode")
  const outFile = arg("--out-file")
  if (!outFile) throw new Error("--out-file is required for model-packaged-archive-write mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitArchives = await Promise.all(
    argsMany("--packaged-archive").map((file) => loadPackagedArchiveArtifact(file)),
  )
  const archive = await resolvePackagedArchiveForPromotion(promotion, explicitArchives)
  const result = await QualityPromotionPackagedArchive.materialize(archive, path.resolve(process.cwd(), outFile))
  console.log(`Wrote packaged archive ${archive.archiveID} to ${result.filePath} (${result.byteLength} bytes)`)
}

async function modelPackagedArchiveExtractMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-packaged-archive-extract mode")
  const outDir = arg("--out-dir")
  if (!outDir) throw new Error("--out-dir is required for model-packaged-archive-extract mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitArchives = await Promise.all(
    argsMany("--packaged-archive").map((file) => loadPackagedArchiveArtifact(file)),
  )
  const archive = await resolvePackagedArchiveForPromotion(promotion, explicitArchives)
  const result = await QualityPromotionPackagedArchive.extract(archive, path.resolve(process.cwd(), outDir))
  console.log(`Extracted packaged archive ${archive.archiveID} to ${result.directory} (${result.entryCount} entries)`)
}

async function modelSignedArchiveCreateMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-signed-archive-create mode")
  const signing = await resolveArchiveSigningInputForCLI()
  if (!signing) throw new Error("Archive signing inputs are required for model-signed-archive-create mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const archive = QualityPromotionSignedArchive.create({
    packagedArchive: await resolvePackagedArchiveForPromotion(promotion),
    signing,
  })
  await QualityPromotionSignedArchive.append(archive)
  const report = QualityPromotionSignedArchive.renderReport(archive, ["__signature_ok__"])
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-signed-archive.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-signed-archive.md")

  await write(out, JSON.stringify(archive, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchivesMode() {
  const archives = await QualityPromotionSignedArchive.list(arg("--source"))
  if (archives.length === 0) {
    console.log("No quality model signed archives recorded")
    return
  }
  for (const archive of archives) {
    console.log(
      `${archive.createdAt} · ${archive.source} · signed-archive=${archive.signedArchiveID} · promotion=${archive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID} · key=${archive.attestation.keyID} · overall=${archive.summary.overallStatus}`,
    )
  }
}

async function modelSignedArchiveStatusMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-signed-archive-status mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitArchives = await Promise.all(
    argsMany("--signed-archive").map((file) => loadSignedArchiveArtifact(file)),
  )
  const archive = await resolveSignedArchiveForPromotion(promotion, explicitArchives)
  if (!archive) throw new Error(`No signed archive available for promotion ${promotionID}`)
  const report = QualityPromotionSignedArchive.renderReport(archive)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-signed-archive-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-signed-archive-summary.md",
  )

  await write(summaryOut, JSON.stringify(archive.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchiveVerifyMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-signed-archive-verify mode")
  const signing = await resolveArchiveSigningInputForCLI()
  if (!signing) throw new Error("Archive signing inputs are required for model-signed-archive-verify mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitArchives = await Promise.all(
    argsMany("--signed-archive").map((file) => loadSignedArchiveArtifact(file)),
  )
  const archive = await resolveSignedArchiveForPromotion(promotion, explicitArchives)
  if (!archive) throw new Error(`No signed archive available for promotion ${promotionID}`)
  const structuralReasons = QualityPromotionSignedArchive.verify(archive)
  const signatureReasons =
    structuralReasons.length > 0
      ? structuralReasons
      : QualityPromotionSignedArchive.verifySignature(archive, signing.keyMaterial)
  const report = QualityPromotionSignedArchive.renderReport(
    archive,
    signatureReasons.length === 0 ? ["__signature_ok__"] : signatureReasons,
  )
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-signed-archive-verification.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-signed-archive-verification.md",
  )

  await write(
    summaryOut,
    JSON.stringify(
      {
        valid: signatureReasons.length === 0,
        structuralReasons,
        signatureReasons,
        keyID: archive.attestation.keyID,
        keyLocator: archive.attestation.keyLocator,
      },
      null,
      2,
    ),
  )
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchiveWriteMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-signed-archive-write mode")
  const outFile = arg("--out-file")
  if (!outFile) throw new Error("--out-file is required for model-signed-archive-write mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitArchives = await Promise.all(
    argsMany("--signed-archive").map((file) => loadSignedArchiveArtifact(file)),
  )
  const archive = await resolveSignedArchiveForPromotion(promotion, explicitArchives)
  if (!archive) throw new Error(`No signed archive available for promotion ${promotionID}`)
  const result = await QualityPromotionSignedArchive.materialize(archive, path.resolve(process.cwd(), outFile))
  console.log(`Wrote signed archive ${archive.signedArchiveID} to ${result.filePath} (${result.byteLength} bytes)`)
}

async function modelSignedArchiveTrustCreateMode() {
  const signing = await resolveArchiveSigningInputForCLI()
  if (!signing) throw new Error("Archive signing inputs are required for model-signed-archive-trust-create mode")
  const rawScope = arg("--scope") ?? "global"
  const scope = QualityPromotionSignedArchiveTrust.Scope.parse(rawScope)
  const projectID =
    scope === "project"
      ? (arg("--project-id") ??
        (() => {
          throw new Error("--project-id is required for project-scoped signed archive trust entries")
        })())
      : undefined
  const lifecycle = (arg("--lifecycle") as QualityPromotionSignedArchiveTrust.Lifecycle | undefined) ?? undefined
  const trust = QualityPromotionSignedArchiveTrust.create({
    scope,
    projectID,
    signing,
    lifecycle,
    effectiveFrom: arg("--effective-from") ?? undefined,
    retiredAt: arg("--retired-at") ?? undefined,
    revokedAt: arg("--revoked-at") ?? undefined,
    rationale: arg("--rationale") ?? undefined,
  })
  await QualityPromotionSignedArchiveTrust.append(trust)
  const report = QualityPromotionSignedArchiveTrust.renderTrust(trust)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-signed-archive-trust.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-signed-archive-trust.md")

  await write(out, JSON.stringify(trust, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchiveTrustsMode() {
  const rawScope = arg("--scope")
  const scope = rawScope ? QualityPromotionSignedArchiveTrust.Scope.parse(rawScope) : undefined
  const projectID =
    scope === "project"
      ? (arg("--project-id") ??
        (() => {
          throw new Error("--project-id is required when --scope=project")
        })())
      : undefined
  const trusts = await QualityPromotionSignedArchiveTrust.list(scope ? { scope, projectID } : undefined)
  if (trusts.length === 0) {
    console.log("No quality model signed archive trust entries recorded")
    return
  }
  for (const trust of trusts) {
    console.log(
      `${trust.registeredAt} · ${trust.scope}${trust.projectID ? `/${trust.projectID}` : ""} · trust=${trust.trustID} · ${trust.attestedBy}/${trust.keyID} · lifecycle=${trust.lifecycle}`,
    )
  }
}

async function modelSignedArchiveTrustStatusMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-signed-archive-trust-status mode")
  const signing = await resolveArchiveSigningInputForCLI()
  if (!signing) throw new Error("Archive signing inputs are required for model-signed-archive-trust-status mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitArchives = await Promise.all(
    argsMany("--signed-archive").map((file) => loadSignedArchiveArtifact(file)),
  )
  const explicitTrusts = await Promise.all(
    argsMany("--signed-archive-trust").map((file) => loadSignedArchiveTrustArtifact(file)),
  )
  const archive = await resolveSignedArchiveForPromotion(promotion, explicitArchives)
  if (!archive) throw new Error(`No signed archive available for promotion ${promotionID}`)
  const summary = await QualityPromotionSignedArchiveTrust.evaluate({
    archive,
    keyMaterial: signing.keyMaterial,
    projectID:
      (await effectiveProjectIDForCLI({
        projectID: QualityRolloutProjectScope.fromPromotionRecord(promotion),
      })) ?? undefined,
    trusts: explicitTrusts,
  })
  const report = QualityPromotionSignedArchiveTrust.renderReport(summary)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-signed-archive-trust-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-signed-archive-trust-summary.md",
  )

  await write(summaryOut, JSON.stringify(summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchiveAttestationStatusMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) throw new Error("--promotion-id is required for model-signed-archive-attestation-status mode")
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitArchives = await Promise.all(
    argsMany("--signed-archive").map((file) => loadSignedArchiveArtifact(file)),
  )
  const explicitTrusts = await Promise.all(
    argsMany("--signed-archive-trust").map((file) => loadSignedArchiveTrustArtifact(file)),
  )
  const evaluation = await evaluateSignedArchiveAttestationForPromotion({
    promotion,
    explicitArchives,
    explicitTrusts,
  })
  const summary = evaluation.attestation
  const report = QualityPromotionSignedArchiveAttestationPolicy.renderReport(summary)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-signed-archive-attestation-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-signed-archive-attestation-summary.md",
  )

  await write(summaryOut, JSON.stringify(summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchiveAttestationRecordCreateMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) {
    throw new Error("--promotion-id is required for model-signed-archive-attestation-record-create mode")
  }
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitArchives = await Promise.all(
    argsMany("--signed-archive").map((file) => loadSignedArchiveArtifact(file)),
  )
  const explicitTrusts = await Promise.all(
    argsMany("--signed-archive-trust").map((file) => loadSignedArchiveTrustArtifact(file)),
  )
  const evaluation = await evaluateSignedArchiveAttestationForPromotion({
    promotion,
    explicitArchives,
    explicitTrusts,
  })
  const record = QualityPromotionSignedArchiveAttestationRecord.create({
    signedArchive: evaluation.archive,
    trust: evaluation.trust,
    attestation: evaluation.attestation,
  })
  await QualityPromotionSignedArchiveAttestationRecord.append(record)
  const report = QualityPromotionSignedArchiveAttestationRecord.renderReport(record)
  const out = path.resolve(
    process.cwd(),
    arg("--out") ?? ".tmp/quality-promotion-signed-archive-attestation-record.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-signed-archive-attestation-record.md",
  )

  await write(out, JSON.stringify(record, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchiveAttestationRecordsMode() {
  const records = await QualityPromotionSignedArchiveAttestationRecord.list(arg("--source"))
  if (records.length === 0) {
    console.log("No quality model signed archive attestation records recorded")
    return
  }
  for (const record of records) {
    console.log(
      `${record.createdAt} · ${record.source} · attestation-record=${record.recordID} · promotion=${record.promotionID} · signed-archive=${record.signedArchive.signedArchiveID} · overall=${record.summary.overallStatus}`,
    )
  }
}

async function modelSignedArchiveAttestationRecordStatusMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) {
    throw new Error("--promotion-id is required for model-signed-archive-attestation-record-status mode")
  }
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitRecords = await Promise.all(
    argsMany("--signed-archive-attestation-record").map((file) => loadSignedArchiveAttestationRecordArtifact(file)),
  )
  let record: QualityPromotionSignedArchiveAttestationRecord.RecordArtifact
  try {
    record = await resolveSignedArchiveAttestationRecordForPromotion(promotion, explicitRecords)
  } catch (err) {
    if (explicitRecords.length > 0 || promotion.signedArchiveAttestationRecord) throw err
    const explicitArchives = await Promise.all(
      argsMany("--signed-archive").map((file) => loadSignedArchiveArtifact(file)),
    )
    const explicitTrusts = await Promise.all(
      argsMany("--signed-archive-trust").map((file) => loadSignedArchiveTrustArtifact(file)),
    )
    const evaluation = await evaluateSignedArchiveAttestationForPromotion({
      promotion,
      explicitArchives,
      explicitTrusts,
    })
    record = QualityPromotionSignedArchiveAttestationRecord.create({
      signedArchive: evaluation.archive,
      trust: evaluation.trust,
      attestation: evaluation.attestation,
    })
  }
  const report = QualityPromotionSignedArchiveAttestationRecord.renderReport(record)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-signed-archive-attestation-record-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-signed-archive-attestation-record-summary.md",
  )

  await write(summaryOut, JSON.stringify(record.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchiveAttestationPacketCreateMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) {
    throw new Error("--promotion-id is required for model-signed-archive-attestation-packet-create mode")
  }
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitRecords = await Promise.all(
    argsMany("--signed-archive-attestation-record").map((file) => loadSignedArchiveAttestationRecordArtifact(file)),
  )
  const attestationRecord = await resolveSignedArchiveAttestationRecordForPromotion(promotion, explicitRecords)
  const packet = QualityPromotionSignedArchiveAttestationPacket.create({
    promotion: signedArchiveAttestationPacketPromotionReference({
      promotion,
      attestationRecord,
    }),
    attestationRecord,
  })
  await QualityPromotionSignedArchiveAttestationPacket.append(packet)
  const report = QualityPromotionSignedArchiveAttestationPacket.renderReport(packet)
  const out = path.resolve(
    process.cwd(),
    arg("--out") ?? ".tmp/quality-promotion-signed-archive-attestation-packet.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-signed-archive-attestation-packet.md",
  )

  await write(out, JSON.stringify(packet, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchiveAttestationPacketsMode() {
  const packets = await QualityPromotionSignedArchiveAttestationPacket.list(arg("--source"))
  if (packets.length === 0) {
    console.log("No quality model signed archive attestation packets recorded")
    return
  }
  for (const packet of packets) {
    console.log(
      `${packet.createdAt} · ${packet.source} · attestation-packet=${packet.packetID} · promotion=${packet.promotion.promotionID} · signed-archive=${packet.summary.signedArchiveID} · overall=${packet.summary.overallStatus}`,
    )
  }
}

async function modelSignedArchiveAttestationPacketStatusMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) {
    throw new Error("--promotion-id is required for model-signed-archive-attestation-packet-status mode")
  }
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitPackets = await Promise.all(
    argsMany("--signed-archive-attestation-packet").map((file) => loadSignedArchiveAttestationPacketArtifact(file)),
  )
  const explicitRecords = await Promise.all(
    argsMany("--signed-archive-attestation-record").map((file) => loadSignedArchiveAttestationRecordArtifact(file)),
  )
  const packet = await resolveSignedArchiveAttestationPacketForPromotion(promotion, explicitPackets, explicitRecords)
  const report = QualityPromotionSignedArchiveAttestationPacket.renderReport(packet)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-signed-archive-attestation-packet-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-signed-archive-attestation-packet-summary.md",
  )

  await write(summaryOut, JSON.stringify(packet.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchiveGovernancePacketCreateMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) {
    throw new Error("--promotion-id is required for model-signed-archive-governance-packet-create mode")
  }
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitGovernancePackets = await Promise.all(
    argsMany("--signed-archive-governance-packet").map((file) => loadSignedArchiveGovernancePacketArtifact(file)),
  )
  if (explicitGovernancePackets.length > 0) {
    throw new Error(
      "--signed-archive-governance-packet is not supported for model-signed-archive-governance-packet-create mode",
    )
  }
  const explicitReleasePackets = await Promise.all(
    argsMany("--release-packet").map((file) => loadReleasePacketArtifact(file)),
  )
  const explicitAttestationPackets = await Promise.all(
    argsMany("--signed-archive-attestation-packet").map((file) => loadSignedArchiveAttestationPacketArtifact(file)),
  )
  const explicitAttestationRecords = await Promise.all(
    argsMany("--signed-archive-attestation-record").map((file) => loadSignedArchiveAttestationRecordArtifact(file)),
  )
  const packet = await resolveSignedArchiveGovernancePacketForPromotion(
    promotion,
    undefined,
    explicitAttestationPackets,
    explicitAttestationRecords,
    explicitReleasePackets,
  )
  await QualityPromotionSignedArchiveGovernancePacket.append(packet)
  const report = QualityPromotionSignedArchiveGovernancePacket.renderReport(packet)
  const out = path.resolve(
    process.cwd(),
    arg("--out") ?? ".tmp/quality-promotion-signed-archive-governance-packet.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-signed-archive-governance-packet.md",
  )

  await write(out, JSON.stringify(packet, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchiveGovernancePacketsMode() {
  const packets = await QualityPromotionSignedArchiveGovernancePacket.list(arg("--source"))
  if (packets.length === 0) {
    console.log("No quality model signed archive governance packets recorded")
    return
  }
  for (const packet of packets) {
    console.log(
      `${packet.createdAt} · ${packet.source} · governance-packet=${packet.packetID} · promotion=${packet.promotion.promotionID} · signed-archive=${packet.summary.signedArchiveID} · overall=${packet.summary.overallStatus}`,
    )
  }
}

async function modelSignedArchiveGovernancePacketStatusMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) {
    throw new Error("--promotion-id is required for model-signed-archive-governance-packet-status mode")
  }
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitGovernancePackets = await Promise.all(
    argsMany("--signed-archive-governance-packet").map((file) => loadSignedArchiveGovernancePacketArtifact(file)),
  )
  const explicitReleasePackets = await Promise.all(
    argsMany("--release-packet").map((file) => loadReleasePacketArtifact(file)),
  )
  const explicitAttestationPackets = await Promise.all(
    argsMany("--signed-archive-attestation-packet").map((file) => loadSignedArchiveAttestationPacketArtifact(file)),
  )
  const explicitAttestationRecords = await Promise.all(
    argsMany("--signed-archive-attestation-record").map((file) => loadSignedArchiveAttestationRecordArtifact(file)),
  )
  const packet = await resolveSignedArchiveGovernancePacketForPromotion(
    promotion,
    explicitGovernancePackets,
    explicitAttestationPackets,
    explicitAttestationRecords,
    explicitReleasePackets,
  )
  const report = QualityPromotionSignedArchiveGovernancePacket.renderReport(packet)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-signed-archive-governance-packet-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-signed-archive-governance-packet-summary.md",
  )

  await write(summaryOut, JSON.stringify(packet.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchiveReviewDossierCreateMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) {
    throw new Error("--promotion-id is required for model-signed-archive-review-dossier-create mode")
  }
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitDossiers = await Promise.all(
    argsMany("--signed-archive-review-dossier").map((file) => loadSignedArchiveReviewDossierArtifact(file)),
  )
  if (explicitDossiers.length > 0) {
    throw new Error(
      "--signed-archive-review-dossier is not supported for model-signed-archive-review-dossier-create mode",
    )
  }
  const explicitGovernancePackets = await Promise.all(
    argsMany("--signed-archive-governance-packet").map((file) => loadSignedArchiveGovernancePacketArtifact(file)),
  )
  const explicitAttestationPackets = await Promise.all(
    argsMany("--signed-archive-attestation-packet").map((file) => loadSignedArchiveAttestationPacketArtifact(file)),
  )
  const explicitAttestationRecords = await Promise.all(
    argsMany("--signed-archive-attestation-record").map((file) => loadSignedArchiveAttestationRecordArtifact(file)),
  )
  const explicitReleasePackets = await Promise.all(
    argsMany("--release-packet").map((file) => loadReleasePacketArtifact(file)),
  )
  const explicitHandoffPackages = await Promise.all(
    argsMany("--handoff-package").map((file) => loadHandoffPackageArtifact(file)),
  )
  const dossier = await resolveSignedArchiveReviewDossierForPromotion(
    promotion,
    undefined,
    explicitGovernancePackets,
    explicitAttestationPackets,
    explicitAttestationRecords,
    explicitReleasePackets,
    explicitHandoffPackages,
  )
  await QualityPromotionSignedArchiveReviewDossier.append(dossier)
  const report = QualityPromotionSignedArchiveReviewDossier.renderReport(dossier)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-promotion-signed-archive-review-dossier.json")
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-signed-archive-review-dossier.md",
  )

  await write(out, JSON.stringify(dossier, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchiveReviewDossiersMode() {
  const dossiers = await QualityPromotionSignedArchiveReviewDossier.list(arg("--source"))
  if (dossiers.length === 0) {
    console.log("No quality model signed archive review dossiers recorded")
    return
  }
  for (const dossier of dossiers) {
    console.log(
      `${dossier.createdAt} · ${dossier.source} · review-dossier=${dossier.dossierID} · promotion=${dossier.governancePacket.promotion.promotionID} · signed-archive=${dossier.summary.signedArchiveID} · overall=${dossier.summary.overallStatus}`,
    )
  }
}

async function modelSignedArchiveReviewDossierStatusMode() {
  const promotionID = arg("--promotion-id")
  if (!promotionID) {
    throw new Error("--promotion-id is required for model-signed-archive-review-dossier-status mode")
  }
  const promotion = await QualityModelRegistry.getPromotion(promotionID)
  const explicitDossiers = await Promise.all(
    argsMany("--signed-archive-review-dossier").map((file) => loadSignedArchiveReviewDossierArtifact(file)),
  )
  const explicitGovernancePackets = await Promise.all(
    argsMany("--signed-archive-governance-packet").map((file) => loadSignedArchiveGovernancePacketArtifact(file)),
  )
  const explicitAttestationPackets = await Promise.all(
    argsMany("--signed-archive-attestation-packet").map((file) => loadSignedArchiveAttestationPacketArtifact(file)),
  )
  const explicitAttestationRecords = await Promise.all(
    argsMany("--signed-archive-attestation-record").map((file) => loadSignedArchiveAttestationRecordArtifact(file)),
  )
  const explicitReleasePackets = await Promise.all(
    argsMany("--release-packet").map((file) => loadReleasePacketArtifact(file)),
  )
  const explicitHandoffPackages = await Promise.all(
    argsMany("--handoff-package").map((file) => loadHandoffPackageArtifact(file)),
  )
  const dossier = await resolveSignedArchiveReviewDossierForPromotion(
    promotion,
    explicitDossiers,
    explicitGovernancePackets,
    explicitAttestationPackets,
    explicitAttestationRecords,
    explicitReleasePackets,
    explicitHandoffPackages,
  )
  const report = QualityPromotionSignedArchiveReviewDossier.renderReport(dossier)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-signed-archive-review-dossier-summary.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-signed-archive-review-dossier-summary.md",
  )

  await write(summaryOut, JSON.stringify(dossier.summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchiveAttestationPolicyShowMode() {
  const scope = policyScope()
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-signed-archive-attestation-policy-resolution.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-signed-archive-attestation-policy-resolution.md",
  )

  if (scope === "resolved") {
    const resolution = await resolveSignedArchiveAttestationPolicyForCLI()
    const report = QualityPromotionSignedArchiveAttestationPolicyStore.renderResolutionReport(resolution)
    await write(summaryOut, JSON.stringify(resolution, null, 2))
    await write(reportOut, report)
    console.log(report)
    return
  }

  const projectID = scope === "project" ? await currentProjectID({ required: true }) : null
  const record =
    scope === "project"
      ? await QualityPromotionSignedArchiveAttestationPolicyStore.getProject(projectID!)
      : await QualityPromotionSignedArchiveAttestationPolicyStore.getGlobal()
  if (!record) {
    console.log(
      scope === "project"
        ? `No project signed archive attestation policy stored for ${projectID}`
        : "No global signed archive attestation policy stored",
    )
    return
  }
  const report = QualityPromotionSignedArchiveAttestationPolicyStore.renderStoredPolicy(record)
  await write(summaryOut, JSON.stringify(record, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchiveAttestationPolicySetMode() {
  const scope = policyScope("project")
  if (scope === "resolved")
    throw new Error("--scope resolved is not supported for model-signed-archive-attestation-policy-set mode")
  if (!hasSignedArchiveAttestationPolicyOverrideArgs()) {
    throw new Error(
      "At least one attestation policy override flag is required for model-signed-archive-attestation-policy-set mode",
    )
  }
  const projectID = scope === "project" ? await currentProjectID({ required: true }) : null
  const existing =
    scope === "project"
      ? await QualityPromotionSignedArchiveAttestationPolicyStore.getProject(projectID!)
      : await QualityPromotionSignedArchiveAttestationPolicyStore.getGlobal()
  const nextPolicy = QualityPromotionSignedArchiveAttestationPolicy.merge(
    existing?.policy ?? QualityPromotionSignedArchiveAttestationPolicy.defaults(),
    signedArchiveAttestationPolicyOverrides(),
  )
  const record =
    scope === "project"
      ? await QualityPromotionSignedArchiveAttestationPolicyStore.setProject(projectID!, nextPolicy)
      : await QualityPromotionSignedArchiveAttestationPolicyStore.setGlobal(nextPolicy)
  const report = QualityPromotionSignedArchiveAttestationPolicyStore.renderStoredPolicy(record)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-signed-archive-attestation-policy-record.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-signed-archive-attestation-policy-record.md",
  )

  await write(summaryOut, JSON.stringify(record, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelSignedArchiveAttestationPolicyClearMode() {
  const scope = policyScope("project")
  if (scope === "resolved")
    throw new Error("--scope resolved is not supported for model-signed-archive-attestation-policy-clear mode")
  if (scope === "project") {
    const projectID = await currentProjectID({ required: true })
    if (!projectID) throw new Error("Unable to resolve current project id")
    await QualityPromotionSignedArchiveAttestationPolicyStore.clearProject(projectID)
    console.log(`Cleared project signed archive attestation policy for ${projectID}`)
    return
  }
  await QualityPromotionSignedArchiveAttestationPolicyStore.clearGlobal()
  console.log("Cleared global signed archive attestation policy")
}

async function modelApprovalPolicyMode() {
  const file = arg("--decision-bundle")
  const approvalFiles = argsMany("--approval")
  if (!file) throw new Error("--decision-bundle is required for model-approval-policy mode")
  const bundle = await loadDecisionBundle(file)
  const policyResolution = await resolveReleasePolicyForCLI({
    projectID: QualityRolloutProjectScope.fromDecisionBundle(bundle),
  })
  const summary = QualityPromotionApprovalPolicy.evaluate({
    bundle,
    approvals: await Promise.all(approvalFiles.map((approvalFile) => loadApprovalArtifact(approvalFile))),
    policy: policyResolution.policy.approval,
    policySource: policyResolution.source,
    policyProjectID: policyResolution.projectID,
  })
  const report = QualityPromotionApprovalPolicy.renderReport(summary)
  const summaryOut = path.resolve(process.cwd(), arg("--summary-out") ?? ".tmp/quality-promotion-approval-policy.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-approval-policy.md")

  await write(summaryOut, JSON.stringify(summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelApprovalPolicyShowMode() {
  const scope = policyScope()
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-approval-policy-resolution.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-approval-policy-resolution.md",
  )

  if (scope === "resolved") {
    const resolution = await resolveApprovalPolicyForCLI()
    const report = QualityPromotionApprovalPolicyStore.renderResolutionReport(resolution)
    await write(summaryOut, JSON.stringify(resolution, null, 2))
    await write(reportOut, report)
    console.log(report)
    return
  }

  const projectID = scope === "project" ? await currentProjectID({ required: true }) : null
  const record =
    scope === "project"
      ? await QualityPromotionApprovalPolicyStore.getProject(projectID!)
      : await QualityPromotionApprovalPolicyStore.getGlobal()
  if (!record) {
    console.log(
      scope === "project" ? `No project approval policy stored for ${projectID}` : "No global approval policy stored",
    )
    return
  }
  const report = QualityPromotionApprovalPolicyStore.renderStoredPolicy(record)
  await write(summaryOut, JSON.stringify(record, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelApprovalConcentrationRecommendMode() {
  const riskTier = arg("--reentry-approval-concentration-risk-tier") as
    | QualityPromotionApprovalPolicy.ApprovalConcentrationRiskTier
    | undefined
  const workflow = arg("--reentry-approval-concentration-workflow") as
    | QualityPromotionApprovalPolicy.ApprovalConcentrationWorkflow
    | undefined
  const samePolicyRetry = hasArg("--reentry-approval-concentration-same-policy-retry") ? true : undefined
  const forcePath = hasArg("--reentry-approval-concentration-force-path") ? true : undefined
  const priorRollbacks = arg("--reentry-approval-concentration-prior-rollbacks")
    ? Number(arg("--reentry-approval-concentration-prior-rollbacks"))
    : undefined
  const bundleFile = arg("--decision-bundle")
  const contextual = bundleFile
    ? QualityPromotionApprovalPolicy.recommendConcentrationFromContext({
        bundle: await loadDecisionBundle(bundleFile),
        workflow,
        riskTier,
        samePolicyRetry,
        forcePath,
        priorRollbacks,
      })
    : null
  const recommendation =
    contextual?.recommendation ??
    QualityPromotionApprovalPolicy.recommendConcentration({
      workflow,
      riskTier: riskTier ?? "standard",
      samePolicyRetry,
      forcePath,
      priorRollbacks,
    })
  const report = contextual
    ? QualityPromotionApprovalPolicy.renderContextualConcentrationRecommendation(contextual)
    : QualityPromotionApprovalPolicy.renderConcentrationRecommendation(recommendation)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-approval-concentration-recommendation.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-approval-concentration-recommendation.md",
  )

  await write(summaryOut, JSON.stringify(contextual ?? recommendation, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelApprovalPolicySetMode() {
  const scope = policyScope("project")
  if (scope === "resolved") throw new Error("--scope resolved is not supported for model-approval-policy-set mode")
  if (!hasApprovalPolicyOverrideArgs()) {
    throw new Error("At least one policy override flag is required for model-approval-policy-set mode")
  }

  const projectID = scope === "project" ? await currentProjectID({ required: true }) : null
  const existing =
    scope === "project"
      ? await QualityPromotionApprovalPolicyStore.getProject(projectID!)
      : await QualityPromotionApprovalPolicyStore.getGlobal()
  const nextPolicy = QualityPromotionApprovalPolicy.merge(
    existing?.policy ?? QualityPromotionApprovalPolicy.defaults(),
    await approvalPolicyOverrides(),
  )
  const record =
    scope === "project"
      ? await QualityPromotionApprovalPolicyStore.setProject(projectID!, nextPolicy)
      : await QualityPromotionApprovalPolicyStore.setGlobal(nextPolicy)
  const report = QualityPromotionApprovalPolicyStore.renderStoredPolicy(record)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-approval-policy-record.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-approval-policy-record.md",
  )

  await write(summaryOut, JSON.stringify(record, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelApprovalPolicyClearMode() {
  const scope = policyScope("project")
  if (scope === "resolved") throw new Error("--scope resolved is not supported for model-approval-policy-clear mode")
  if (scope === "project") {
    const projectID = await currentProjectID({ required: true })
    if (!projectID) throw new Error("Unable to resolve current project id")
    await QualityPromotionApprovalPolicyStore.clearProject(projectID)
    console.log(`Cleared project approval policy for ${projectID}`)
    return
  }
  await QualityPromotionApprovalPolicyStore.clearGlobal()
  console.log("Cleared global approval policy")
}

async function modelReleasePolicyShowMode() {
  const scope = policyScope()
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-release-policy-resolution.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-release-policy-resolution.md",
  )

  if (scope === "resolved") {
    const resolution = await resolveReleasePolicyForCLI()
    const report = QualityPromotionReleasePolicyStore.renderResolutionReport(resolution)
    await write(summaryOut, JSON.stringify(resolution, null, 2))
    await write(reportOut, report)
    console.log(report)
    return
  }

  const projectID = scope === "project" ? await currentProjectID({ required: true }) : null
  const record =
    scope === "project"
      ? await QualityPromotionReleasePolicyStore.getProject(projectID!)
      : await QualityPromotionReleasePolicyStore.getGlobal()
  if (!record) {
    console.log(
      scope === "project" ? `No project release policy stored for ${projectID}` : "No global release policy stored",
    )
    return
  }
  const report = QualityPromotionReleasePolicyStore.renderStoredPolicy(record)
  await write(summaryOut, JSON.stringify(record, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelReleasePolicySetMode() {
  const scope = policyScope("project")
  if (scope === "resolved") throw new Error("--scope resolved is not supported for model-release-policy-set mode")
  if (!hasReleasePolicyOverrideArgs()) {
    throw new Error("At least one release policy override flag is required for model-release-policy-set mode")
  }

  const projectID = scope === "project" ? await currentProjectID({ required: true }) : null
  const existing = await QualityPromotionReleasePolicyStore.resolve({ projectID: projectID ?? null })
  const nextPolicy = QualityPromotionReleasePolicy.merge(existing.policy, {
    stability: stabilityPolicyOverrides(),
    watch: watchPolicyOverrides(),
    approval: await approvalPolicyOverrides(),
  })
  const record =
    scope === "project"
      ? await QualityPromotionReleasePolicyStore.setProject(projectID!, nextPolicy)
      : await QualityPromotionReleasePolicyStore.setGlobal(nextPolicy)
  const report = QualityPromotionReleasePolicyStore.renderStoredPolicy(record)
  const summaryOut = path.resolve(
    process.cwd(),
    arg("--summary-out") ?? ".tmp/quality-promotion-release-policy-record.json",
  )
  const reportOut = path.resolve(
    process.cwd(),
    arg("--report-out") ?? ".tmp/quality-promotion-release-policy-record.md",
  )

  await write(summaryOut, JSON.stringify(record, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelReleasePolicyClearMode() {
  const scope = policyScope("project")
  if (scope === "resolved") throw new Error("--scope resolved is not supported for model-release-policy-clear mode")
  if (scope === "project") {
    const projectID = await currentProjectID({ required: true })
    if (!projectID) throw new Error("Unable to resolve current project id")
    await QualityPromotionReleasePolicyStore.clearProject(projectID)
    console.log(`Cleared project release policy for ${projectID}`)
    return
  }
  await QualityPromotionReleasePolicyStore.clearGlobal()
  console.log("Cleared global release policy")
}

async function modelWatchMode() {
  const source = arg("--source")
  const { summary } = await resolvePromotionWatch({
    source,
    minRecords: arg("--min-records") ? Number(arg("--min-records")) : undefined,
    maxRecords: arg("--max-records") ? Number(arg("--max-records")) : undefined,
  })
  const report = QualityPromotionWatch.renderWatchReport(summary)
  const summaryOut = path.resolve(process.cwd(), arg("--summary-out") ?? ".tmp/quality-promotion-watch-summary.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-promotion-watch-report.md")

  await write(summaryOut, JSON.stringify(summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

function parseRemediationEvidence(values: string[]) {
  return values.map((value) => {
    const [maybeKind, ...rest] = value.split(":")
    if (rest.length > 0 && QualityReentryRemediation.EvidenceKind.safeParse(maybeKind).success) {
      return QualityReentryRemediation.EvidenceItem.parse({
        kind: maybeKind,
        detail: rest.join(":").trim(),
      })
    }
    return QualityReentryRemediation.EvidenceItem.parse({
      kind: "note",
      detail: value.trim(),
    })
  })
}

async function resolveReentryContextForCLI(source: string) {
  const contextID = arg("--context-id")
  if (contextID) {
    const record = await QualityReentryContext.get({ source, contextID })
    return record.context
  }
  const latest = await QualityReentryContext.latest(source)
  if (!latest) {
    throw new Error(`No reentry context found for model source ${source}`)
  }
  return latest
}

async function modelReentryRemediationCreateMode() {
  const source = arg("--source")
  const author = arg("--author")
  const summary = arg("--summary")
  const evidence = argsMany("--evidence")
  if (!source || !author || !summary) {
    throw new Error("--source, --author, and --summary are required for model-reentry-remediation-create mode")
  }
  if (evidence.length === 0) {
    throw new Error("At least one --evidence value is required for model-reentry-remediation-create mode")
  }

  const context = await resolveReentryContextForCLI(source)
  const releasePolicyDigest =
    arg("--release-policy-digest") ??
    QualityPromotionReleasePolicyStore.provenance(await resolveReleasePolicyForCLI()).digest
  const remediation = QualityReentryRemediation.create({
    context,
    author,
    summary,
    evidence: parseRemediationEvidence(evidence),
    currentReleasePolicyDigest: releasePolicyDigest,
  })
  await QualityReentryRemediation.append(remediation)

  const report = QualityReentryRemediation.renderReport(remediation)
  const out = path.resolve(process.cwd(), arg("--out") ?? ".tmp/quality-reentry-remediation.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-reentry-remediation.md")
  await write(out, JSON.stringify(remediation, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelReentryRemediationsMode() {
  const remediations = await QualityReentryRemediation.list({
    source: arg("--source"),
    contextID: arg("--context-id"),
  })
  if (remediations.length === 0) {
    console.log("No quality model reentry remediations recorded")
    return
  }
  for (const remediation of remediations) {
    console.log(
      `${remediation.createdAt} · ${remediation.source} · context=${remediation.contextID} · author=${remediation.author} · evidence=${remediation.evidence.length}`,
    )
  }
}

async function resolvePromotionWatch(input: { source?: string; minRecords?: number; maxRecords?: number }) {
  const promotion = await QualityModelRegistry.latestPromotion(input.source)
  if (!promotion) {
    throw new Error(
      input.source
        ? `No promotion record found for model source ${input.source}`
        : "No promotion record found; promote a model before running this command",
    )
  }

  const records = await QualityShadowStore.listAll(promotion.source)
  let releasePolicy: {
    policy: QualityPromotionReleasePolicy.Policy
    provenance: ReturnType<typeof QualityPromotionReleasePolicyStore.provenance>
  }
  if (promotion.releasePolicy) {
    releasePolicy = {
      policy: promotion.releasePolicy.policy,
      provenance: {
        policySource: promotion.releasePolicy.policySource,
        policyProjectID: promotion.releasePolicy.policyProjectID,
        compatibilityApprovalSource: promotion.releasePolicy.compatibilityApprovalSource,
        resolvedAt: promotion.releasePolicy.resolvedAt,
        persistedScope: promotion.releasePolicy.persistedScope,
        persistedUpdatedAt: promotion.releasePolicy.persistedUpdatedAt,
        digest: promotion.releasePolicy.digest,
      },
    }
  } else {
    const resolution = await resolveReleasePolicyForCLI()
    releasePolicy = {
      policy: resolution.policy,
      provenance: QualityPromotionReleasePolicyStore.provenance(resolution),
    }
  }
  const summary = QualityPromotionWatch.summarize({
    records,
    source: promotion.source,
    promotedAt: promotion.promotedAt,
    minRecords: input.minRecords,
    maxRecords: input.maxRecords,
    releasePolicy,
  })
  return { promotion, summary }
}

async function modelRollbackRecommendMode() {
  const { promotion, summary } = await resolvePromotionWatch({
    source: arg("--source"),
    minRecords: arg("--min-records") ? Number(arg("--min-records")) : undefined,
    maxRecords: arg("--max-records") ? Number(arg("--max-records")) : undefined,
  })
  const active = await QualityModelRegistry.getActive()
  const recommendation = QualityRollbackAdvisor.recommend({
    promotion,
    watch: summary,
    currentActiveSource: active?.source ?? null,
  })
  const report = QualityRollbackAdvisor.renderRecommendationReport(recommendation)
  const summaryOut = path.resolve(process.cwd(), arg("--summary-out") ?? ".tmp/quality-rollback-recommendation.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-rollback-recommendation.md")

  await write(summaryOut, JSON.stringify(recommendation, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function modelRollbackMode() {
  const { promotion, summary } = await resolvePromotionWatch({
    source: arg("--source"),
    minRecords: arg("--min-records") ? Number(arg("--min-records")) : undefined,
    maxRecords: arg("--max-records") ? Number(arg("--max-records")) : undefined,
  })
  const result = await QualityModelRegistry.rollbackPromotion(promotion, summary, {
    allowWarn: hasArg("--allow-warn"),
    force: hasArg("--force"),
  })
  console.log(
    `Rolled back model ${promotion.source} with decision ${result.record.decision}; active is now ${result.active?.source ?? "none"}`,
  )
}

async function modelRollbacksMode() {
  const records = await QualityModelRegistry.listRollbacks(arg("--source"))
  if (records.length === 0) {
    console.log("No quality model rollbacks recorded")
    return
  }
  for (const record of records) {
    console.log(
      `${record.rolledBackAt} · ${record.source} · decision=${record.decision} · watch=${record.watch.overallStatus} · stability=${record.stability?.overallStatus ?? "n/a"} · active=${record.resultingActiveSource ?? "none"}`,
    )
  }
}

async function modelStabilityCheckMode() {
  const source = arg("--source")
  if (!source) throw new Error("--source is required for model-stability-check mode")
  const releasePolicyResolution = await resolveReleasePolicyForCLI()
  const summary = QualityStabilityGuard.summarize({
    source,
    rollbacks: await QualityModelRegistry.listRollbacks(source),
    ...releasePolicyResolution.policy.stability,
  })
  const report = QualityStabilityGuard.renderReport(summary)
  const summaryOut = path.resolve(process.cwd(), arg("--summary-out") ?? ".tmp/quality-model-stability-summary.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-model-stability-report.md")

  await write(summaryOut, JSON.stringify(summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function compareMode() {
  const baselineFile = arg("--baseline")
  const candidateFile = arg("--candidate")
  if (!baselineFile || !candidateFile) throw new Error("--baseline and --candidate are required for compare mode")

  const comparisonOut = path.resolve(
    process.cwd(),
    arg("--comparison-out") ?? ".tmp/quality-calibration-comparison.json",
  )
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-calibration-comparison.md")
  const baseline = ProbabilisticRollout.CalibrationSummary.parse(
    await readJson<unknown>(path.resolve(process.cwd(), baselineFile)),
  )
  const candidate = ProbabilisticRollout.CalibrationSummary.parse(
    await readJson<unknown>(path.resolve(process.cwd(), candidateFile)),
  )
  const comparison = ProbabilisticRollout.compareCalibrationSummaries(baseline, candidate)
  const report = ProbabilisticRollout.renderCalibrationComparisonReport(comparison)

  await write(comparisonOut, JSON.stringify(comparison, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function shadowMode() {
  const itemsFile = arg("--items")
  const predictionArg = arg("--predictions")
  if (!itemsFile || !predictionArg) throw new Error("--items and --predictions are required for shadow mode")

  const items = flattenReplay(await readJson<unknown>(path.resolve(process.cwd(), itemsFile)))
  const predictions = await loadPredictionFile(predictionArg)
  const shadowOut = path.resolve(process.cwd(), arg("--shadow-out") ?? ".tmp/quality-shadow.json")
  const summaryOut = path.resolve(process.cwd(), arg("--summary-out") ?? ".tmp/quality-shadow-summary.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-shadow-report.md")

  const shadow = ProbabilisticRollout.buildShadowFile(items, predictions, {
    baselineThreshold: Number(arg("--baseline-threshold") ?? "0.5"),
    candidateThreshold: Number(arg("--candidate-threshold") ?? "0.5"),
    baselineAbstainBelow:
      arg("--baseline-abstain-below") === undefined ? undefined : Number(arg("--baseline-abstain-below")),
    candidateAbstainBelow:
      arg("--candidate-abstain-below") === undefined ? undefined : Number(arg("--candidate-abstain-below")),
  })
  const summary = ProbabilisticRollout.summarizeShadowFile(shadow)
  const report = ProbabilisticRollout.renderShadowReport(summary)

  await write(shadowOut, JSON.stringify(shadow, null, 2))
  await write(summaryOut, JSON.stringify(summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function shadowExportMode() {
  const sessionIDs = argsMany("--session")
  if (sessionIDs.length === 0) throw new Error("At least one --session value is required for shadow-export mode")

  const candidateSource = arg("--candidate-source")
  const shadowOut = path.resolve(process.cwd(), arg("--shadow-out") ?? ".tmp/quality-shadow-live.json")
  const summaryOut = path.resolve(process.cwd(), arg("--summary-out") ?? ".tmp/quality-shadow-live-summary.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-shadow-live-report.md")
  const shadow = await QualityShadowStore.exportFile({ sessionIDs, candidateSource })
  const summary = ProbabilisticRollout.summarizeShadowFile(shadow)
  const report = ProbabilisticRollout.renderShadowReport(summary)

  await write(shadowOut, JSON.stringify(shadow, null, 2))
  await write(summaryOut, JSON.stringify(summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function shadowReportMode() {
  const file = arg("--file")
  if (!file) throw new Error("--file is required for shadow-report mode")

  const summaryOut = path.resolve(process.cwd(), arg("--summary-out") ?? ".tmp/quality-shadow-summary.json")
  const reportOut = path.resolve(process.cwd(), arg("--report-out") ?? ".tmp/quality-shadow-report.md")
  const shadow = ProbabilisticRollout.ShadowFile.parse(await readJson<unknown>(path.resolve(process.cwd(), file)))
  const summary = ProbabilisticRollout.summarizeShadowFile(shadow)
  const report = ProbabilisticRollout.renderShadowReport(summary)

  await write(summaryOut, JSON.stringify(summary, null, 2))
  await write(reportOut, report)
  console.log(report)
}

async function main() {
  const mode = arg("--mode") ?? "export"
  if (mode === "export") {
    await exportMode()
    return
  }
  if (mode === "replay-readiness") {
    await replayReadinessMode()
    return
  }
  if (mode === "labels-import") {
    await labelsImportMode()
    return
  }
  if (mode === "labels-export") {
    await labelsExportMode()
    return
  }
  if (mode === "report") {
    await reportMode()
    return
  }
  if (mode === "train") {
    await trainMode()
    return
  }
  if (mode === "predict") {
    await predictMode()
    return
  }
  if (mode === "benchmark") {
    await benchmarkMode()
    return
  }
  if (mode === "model-register") {
    await modelRegisterMode()
    return
  }
  if (mode === "model-list") {
    await modelListMode()
    return
  }
  if (mode === "model-activate") {
    await modelActivateMode()
    return
  }
  if (mode === "model-clear-active") {
    await modelClearActiveMode()
    return
  }
  if (mode === "model-export") {
    await modelExportMode()
    return
  }
  if (mode === "model-promote") {
    await modelPromoteMode()
    return
  }
  if (mode === "model-promotions") {
    await modelPromotionsMode()
    return
  }
  if (mode === "model-promotion-summary") {
    await modelPromotionSummaryMode()
    return
  }
  if (mode === "model-promotion-eligibility") {
    await modelPromotionEligibilityMode()
    return
  }
  if (mode === "model-decision-bundle") {
    await modelDecisionBundleMode()
    return
  }
  if (mode === "model-approval-create") {
    await modelApprovalCreateMode()
    return
  }
  if (mode === "model-approval-packet-create") {
    await modelApprovalPacketCreateMode()
    return
  }
  if (mode === "model-submission-bundle-create") {
    await modelSubmissionBundleCreateMode()
    return
  }
  if (mode === "model-review-dossier-create") {
    await modelReviewDossierCreateMode()
    return
  }
  if (mode === "model-board-decision-create") {
    await modelBoardDecisionCreateMode()
    return
  }
  if (mode === "model-release-decision-record-create") {
    await modelReleaseDecisionRecordCreateMode()
    return
  }
  if (mode === "model-release-packet-create") {
    await modelReleasePacketCreateMode()
    return
  }
  if (mode === "model-audit-manifest-create") {
    await modelAuditManifestCreateMode()
    return
  }
  if (mode === "model-export-bundle-create") {
    await modelExportBundleCreateMode()
    return
  }
  if (mode === "model-archive-manifest-create") {
    await modelArchiveManifestCreateMode()
    return
  }
  if (mode === "model-handoff-package-create") {
    await modelHandoffPackageCreateMode()
    return
  }
  if (mode === "model-portable-export-create") {
    await modelPortableExportCreateMode()
    return
  }
  if (mode === "model-packaged-archive-create") {
    await modelPackagedArchiveCreateMode()
    return
  }
  if (mode === "model-signed-archive-create") {
    await modelSignedArchiveCreateMode()
    return
  }
  if (mode === "model-signed-archive-trust-create") {
    await modelSignedArchiveTrustCreateMode()
    return
  }
  if (mode === "model-signed-archive-attestation-record-create") {
    await modelSignedArchiveAttestationRecordCreateMode()
    return
  }
  if (mode === "model-signed-archive-attestation-packet-create") {
    await modelSignedArchiveAttestationPacketCreateMode()
    return
  }
  if (mode === "model-signed-archive-governance-packet-create") {
    await modelSignedArchiveGovernancePacketCreateMode()
    return
  }
  if (mode === "model-signed-archive-review-dossier-create") {
    await modelSignedArchiveReviewDossierCreateMode()
    return
  }
  if (mode === "model-signed-archive-attestation-policy-set") {
    await modelSignedArchiveAttestationPolicySetMode()
    return
  }
  if (mode === "model-adoption-review-create") {
    await modelAdoptionReviewCreateMode()
    return
  }
  if (mode === "model-adoption-dissent-resolution-create") {
    await modelAdoptionDissentResolutionCreateMode()
    return
  }
  if (mode === "model-adoption-dissent-handling-create") {
    await modelAdoptionDissentHandlingCreateMode()
    return
  }
  if (mode === "model-adoption-dissent-supersession-create") {
    await modelAdoptionDissentSupersessionCreateMode()
    return
  }
  if (mode === "model-approvals") {
    await modelApprovalsMode()
    return
  }
  if (mode === "model-approval-packets") {
    await modelApprovalPacketsMode()
    return
  }
  if (mode === "model-submission-bundles") {
    await modelSubmissionBundlesMode()
    return
  }
  if (mode === "model-review-dossiers") {
    await modelReviewDossiersMode()
    return
  }
  if (mode === "model-board-decisions") {
    await modelBoardDecisionsMode()
    return
  }
  if (mode === "model-release-decision-records") {
    await modelReleaseDecisionRecordsMode()
    return
  }
  if (mode === "model-release-packets") {
    await modelReleasePacketsMode()
    return
  }
  if (mode === "model-audit-manifests") {
    await modelAuditManifestsMode()
    return
  }
  if (mode === "model-export-bundles") {
    await modelExportBundlesMode()
    return
  }
  if (mode === "model-archive-manifests") {
    await modelArchiveManifestsMode()
    return
  }
  if (mode === "model-handoff-packages") {
    await modelHandoffPackagesMode()
    return
  }
  if (mode === "model-portable-exports") {
    await modelPortableExportsMode()
    return
  }
  if (mode === "model-packaged-archives") {
    await modelPackagedArchivesMode()
    return
  }
  if (mode === "model-signed-archives") {
    await modelSignedArchivesMode()
    return
  }
  if (mode === "model-signed-archive-trusts") {
    await modelSignedArchiveTrustsMode()
    return
  }
  if (mode === "model-signed-archive-attestation-records") {
    await modelSignedArchiveAttestationRecordsMode()
    return
  }
  if (mode === "model-signed-archive-attestation-packets") {
    await modelSignedArchiveAttestationPacketsMode()
    return
  }
  if (mode === "model-signed-archive-governance-packets") {
    await modelSignedArchiveGovernancePacketsMode()
    return
  }
  if (mode === "model-signed-archive-review-dossiers") {
    await modelSignedArchiveReviewDossiersMode()
    return
  }
  if (mode === "model-signed-archive-attestation-policy-show") {
    await modelSignedArchiveAttestationPolicyShowMode()
    return
  }
  if (mode === "model-adoption-reviews") {
    await modelAdoptionReviewsMode()
    return
  }
  if (mode === "model-adoption-dissent-resolutions") {
    await modelAdoptionDissentResolutionsMode()
    return
  }
  if (mode === "model-adoption-dissent-handlings") {
    await modelAdoptionDissentHandlingsMode()
    return
  }
  if (mode === "model-adoption-dissent-supersessions") {
    await modelAdoptionDissentSupersessionsMode()
    return
  }
  if (mode === "model-adoption-review-consensus") {
    await modelAdoptionReviewConsensusMode()
    return
  }
  if (mode === "model-adoption-dissent-resolution-status") {
    await modelAdoptionDissentResolutionStatusMode()
    return
  }
  if (mode === "model-adoption-dissent-handling-status") {
    await modelAdoptionDissentHandlingStatusMode()
    return
  }
  if (mode === "model-adoption-dissent-supersession-status") {
    await modelAdoptionDissentSupersessionStatusMode()
    return
  }
  if (mode === "model-approval-policy") {
    await modelApprovalPolicyMode()
    return
  }
  if (mode === "model-approval-packet-status") {
    await modelApprovalPacketStatusMode()
    return
  }
  if (mode === "model-submission-bundle-status") {
    await modelSubmissionBundleStatusMode()
    return
  }
  if (mode === "model-review-dossier-status") {
    await modelReviewDossierStatusMode()
    return
  }
  if (mode === "model-board-decision-status") {
    await modelBoardDecisionStatusMode()
    return
  }
  if (mode === "model-release-decision-record-status") {
    await modelReleaseDecisionRecordStatusMode()
    return
  }
  if (mode === "model-release-packet-status") {
    await modelReleasePacketStatusMode()
    return
  }
  if (mode === "model-audit-manifest-status") {
    await modelAuditManifestStatusMode()
    return
  }
  if (mode === "model-export-bundle-status") {
    await modelExportBundleStatusMode()
    return
  }
  if (mode === "model-archive-manifest-status") {
    await modelArchiveManifestStatusMode()
    return
  }
  if (mode === "model-handoff-package-status") {
    await modelHandoffPackageStatusMode()
    return
  }
  if (mode === "model-portable-export-status") {
    await modelPortableExportStatusMode()
    return
  }
  if (mode === "model-portable-export-write") {
    await modelPortableExportWriteMode()
    return
  }
  if (mode === "model-packaged-archive-status") {
    await modelPackagedArchiveStatusMode()
    return
  }
  if (mode === "model-signed-archive-status") {
    await modelSignedArchiveStatusMode()
    return
  }
  if (mode === "model-signed-archive-trust-status") {
    await modelSignedArchiveTrustStatusMode()
    return
  }
  if (mode === "model-signed-archive-attestation-status") {
    await modelSignedArchiveAttestationStatusMode()
    return
  }
  if (mode === "model-signed-archive-attestation-record-status") {
    await modelSignedArchiveAttestationRecordStatusMode()
    return
  }
  if (mode === "model-signed-archive-attestation-packet-status") {
    await modelSignedArchiveAttestationPacketStatusMode()
    return
  }
  if (mode === "model-signed-archive-governance-packet-status") {
    await modelSignedArchiveGovernancePacketStatusMode()
    return
  }
  if (mode === "model-signed-archive-review-dossier-status") {
    await modelSignedArchiveReviewDossierStatusMode()
    return
  }
  if (mode === "model-signed-archive-verify") {
    await modelSignedArchiveVerifyMode()
    return
  }
  if (mode === "model-packaged-archive-write") {
    await modelPackagedArchiveWriteMode()
    return
  }
  if (mode === "model-signed-archive-write") {
    await modelSignedArchiveWriteMode()
    return
  }
  if (mode === "model-signed-archive-attestation-policy-clear") {
    await modelSignedArchiveAttestationPolicyClearMode()
    return
  }
  if (mode === "model-packaged-archive-extract") {
    await modelPackagedArchiveExtractMode()
    return
  }
  if (mode === "model-approval-policy-show") {
    await modelApprovalPolicyShowMode()
    return
  }
  if (mode === "model-approval-concentration-recommend") {
    await modelApprovalConcentrationRecommendMode()
    return
  }
  if (mode === "model-approval-policy-set") {
    await modelApprovalPolicySetMode()
    return
  }
  if (mode === "model-approval-policy-clear") {
    await modelApprovalPolicyClearMode()
    return
  }
  if (mode === "model-release-policy-show") {
    await modelReleasePolicyShowMode()
    return
  }
  if (mode === "model-release-policy-set") {
    await modelReleasePolicySetMode()
    return
  }
  if (mode === "model-release-policy-clear") {
    await modelReleasePolicyClearMode()
    return
  }
  if (mode === "model-watch") {
    await modelWatchMode()
    return
  }
  if (mode === "model-reentry-remediation-create") {
    await modelReentryRemediationCreateMode()
    return
  }
  if (mode === "model-reentry-remediations") {
    await modelReentryRemediationsMode()
    return
  }
  if (mode === "model-rollback-recommend") {
    await modelRollbackRecommendMode()
    return
  }
  if (mode === "model-rollback") {
    await modelRollbackMode()
    return
  }
  if (mode === "model-rollbacks") {
    await modelRollbacksMode()
    return
  }
  if (mode === "model-stability-check") {
    await modelStabilityCheckMode()
    return
  }
  if (mode === "compare") {
    await compareMode()
    return
  }
  if (mode === "shadow") {
    await shadowMode()
    return
  }
  if (mode === "shadow-export") {
    await shadowExportMode()
    return
  }
  if (mode === "shadow-report") {
    await shadowReportMode()
    return
  }
  throw new Error(`Unsupported --mode ${mode}`)
}

if (import.meta.main) {
  await main()
}
