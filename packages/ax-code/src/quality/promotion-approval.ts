import { createHash } from "crypto"
import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionDecisionBundle } from "./promotion-decision-bundle"

export namespace QualityPromotionApproval {
  export const ApprovalArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-approval"),
    approvalID: z.string(),
    source: z.string(),
    approvedAt: z.string(),
    approver: z.string(),
    role: z.string().nullable(),
    team: z.string().nullable().default(null),
    reportingChain: z.string().nullable().default(null),
    disposition: z.enum(["approved", "rejected"]),
    rationale: z.string().nullable(),
    decisionBundle: z.object({
      source: z.string(),
      createdAt: z.string(),
      digest: z.string(),
      decision: z.enum(["go", "review", "no_go"]),
      requiredOverride: z.enum(["none", "allow_warn", "force"]),
    }),
    releasePolicy: z.lazy(() => QualityPromotionDecisionBundle.ReleasePolicySnapshot).optional(),
    approvalPolicySuggestion: z.lazy(() => QualityPromotionDecisionBundle.ApprovalPolicySuggestionSnapshot).optional(),
    snapshot: z.object({
      currentActiveSource: z.string().nullable(),
      lastPromotionAt: z.string().nullable(),
      lastRollbackAt: z.string().nullable(),
      priorPromotions: z.number().int().nonnegative(),
      priorRollbacks: z.number().int().nonnegative(),
    }),
  })
  export type ApprovalArtifact = z.output<typeof ApprovalArtifact>

  export const ApprovalRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-approval-record"),
    approval: ApprovalArtifact,
  })
  export type ApprovalRecord = z.output<typeof ApprovalRecord>

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, approvalID: string) {
    return ["quality_model_approval", encode(source), approvalID]
  }

  function sort(artifacts: ApprovalArtifact[]) {
    return [...artifacts].sort((a, b) => {
      const byApprovedAt = a.approvedAt.localeCompare(b.approvedAt)
      if (byApprovedAt !== 0) return byApprovedAt
      return a.approvalID.localeCompare(b.approvalID)
    })
  }

  export function digest(bundle: QualityPromotionDecisionBundle.DecisionBundle) {
    return createHash("sha256").update(JSON.stringify(bundle)).digest("hex")
  }

  export function create(input: {
    bundle: QualityPromotionDecisionBundle.DecisionBundle
    approver: string
    role?: string | null
    team?: string | null
    reportingChain?: string | null
    disposition?: "approved" | "rejected"
    rationale?: string | null
  }): ApprovalArtifact {
    const approvedAt = new Date().toISOString()
    const approvalID = `${Date.now()}-${encode(input.bundle.source)}-${encode(input.approver)}`
    return ApprovalArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-approval",
      approvalID,
      source: input.bundle.source,
      approvedAt,
      approver: input.approver,
      role: input.role ?? null,
      team: input.team?.trim() || null,
      reportingChain: input.reportingChain?.trim() || null,
      disposition: input.disposition ?? "approved",
      rationale: input.rationale ?? null,
      decisionBundle: {
        source: input.bundle.source,
        createdAt: input.bundle.createdAt,
        digest: digest(input.bundle),
        decision: input.bundle.eligibility.decision,
        requiredOverride: input.bundle.eligibility.requiredOverride,
      },
      releasePolicy: input.bundle.releasePolicy,
      approvalPolicySuggestion: input.bundle.approvalPolicySuggestion
        ?? QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(input.bundle),
      snapshot: {
        currentActiveSource: input.bundle.snapshot.currentActiveSource,
        lastPromotionAt: input.bundle.snapshot.lastPromotionAt,
        lastRollbackAt: input.bundle.snapshot.lastRollbackAt,
        priorPromotions: input.bundle.snapshot.priorPromotions,
        priorRollbacks: input.bundle.snapshot.priorRollbacks,
      },
    })
  }

  export function verify(bundle: QualityPromotionDecisionBundle.DecisionBundle, approval: ApprovalArtifact) {
    const reasons: string[] = []
    if (approval.source !== bundle.source) {
      reasons.push(`approval source mismatch: ${approval.source} vs ${bundle.source}`)
    }
    if (approval.decisionBundle.source !== bundle.source) {
      reasons.push(`decision bundle source mismatch: ${approval.decisionBundle.source} vs ${bundle.source}`)
    }
    if (approval.decisionBundle.createdAt !== bundle.createdAt) {
      reasons.push(`decision bundle createdAt mismatch: ${approval.decisionBundle.createdAt} vs ${bundle.createdAt}`)
    }
    if (approval.decisionBundle.digest !== digest(bundle)) {
      reasons.push(`decision bundle digest mismatch for ${bundle.source}`)
    }
    if (approval.decisionBundle.decision !== bundle.eligibility.decision) {
      reasons.push(`eligibility decision mismatch: ${approval.decisionBundle.decision} vs ${bundle.eligibility.decision}`)
    }
    if (approval.decisionBundle.requiredOverride !== bundle.eligibility.requiredOverride) {
      reasons.push(
        `required override mismatch: ${approval.decisionBundle.requiredOverride} vs ${bundle.eligibility.requiredOverride}`,
      )
    }
    if (bundle.releasePolicy && !approval.releasePolicy) {
      reasons.push(`release policy snapshot missing for ${bundle.source}`)
    }
    if (!bundle.releasePolicy && approval.releasePolicy) {
      reasons.push(`unexpected release policy snapshot for ${bundle.source}`)
    }
    if (bundle.releasePolicy && approval.releasePolicy) {
      if (approval.releasePolicy.provenance.digest !== bundle.releasePolicy.provenance.digest) {
        reasons.push(
          `release policy digest mismatch: ${approval.releasePolicy.provenance.digest} vs ${bundle.releasePolicy.provenance.digest}`,
        )
      }
      if (approval.releasePolicy.provenance.policySource !== bundle.releasePolicy.provenance.policySource) {
        reasons.push(
          `release policy source mismatch: ${approval.releasePolicy.provenance.policySource} vs ${bundle.releasePolicy.provenance.policySource}`,
        )
      }
    }
    const expectedSuggestion = bundle.approvalPolicySuggestion
      ?? QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(bundle)
    if (bundle.approvalPolicySuggestion && !approval.approvalPolicySuggestion) {
      reasons.push(`approval policy suggestion snapshot missing for ${bundle.source}`)
    }
    if (
      approval.approvalPolicySuggestion &&
      JSON.stringify(approval.approvalPolicySuggestion) !== JSON.stringify(expectedSuggestion)
    ) {
      reasons.push(`approval policy suggestion mismatch for ${bundle.source}`)
    }
    return reasons
  }

  export async function get(input: { source: string; approvalID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.approvalID))
    return ApprovalRecord.parse(record)
  }

  export async function append(approval: ApprovalArtifact) {
    const next = ApprovalRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-approval-record",
      approval,
    })
    try {
      const existing = await get({ source: approval.source, approvalID: approval.approvalID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(`Approval ${approval.approvalID} already exists for source ${approval.source} with different content`)
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(approval.source, approval.approvalID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_approval", encode(source)]] : [["quality_model_approval"]]
    const approvals: ApprovalArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const approvalID = parts[parts.length - 1]
        if (!encodedSource || !approvalID) continue
        const record = await get({ source: decode(encodedSource), approvalID })
        approvals.push(record.approval)
      }
    }

    return sort(approvals)
  }

  export async function assertPersisted(approval: ApprovalArtifact) {
    const persisted = await get({ source: approval.source, approvalID: approval.approvalID })
    const prev = JSON.stringify(persisted.approval)
    const curr = JSON.stringify(approval)
    if (prev !== curr) {
      throw new Error(`Persisted approval ${approval.approvalID} does not match the provided artifact`)
    }
    return persisted
  }

  export function renderReport(approval: ApprovalArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion approval")
    lines.push("")
    lines.push(`- source: ${approval.source}`)
    lines.push(`- approval id: ${approval.approvalID}`)
    lines.push(`- approved at: ${approval.approvedAt}`)
    lines.push(`- approver: ${approval.approver}`)
    lines.push(`- role: ${approval.role ?? "n/a"}`)
    lines.push(`- team: ${approval.team ?? "n/a"}`)
    lines.push(`- reporting chain: ${approval.reportingChain ?? "n/a"}`)
    lines.push(`- disposition: ${approval.disposition}`)
    lines.push(`- rationale: ${approval.rationale ?? "n/a"}`)
    lines.push(`- decision bundle created at: ${approval.decisionBundle.createdAt}`)
    lines.push(`- decision bundle digest: ${approval.decisionBundle.digest}`)
    lines.push(`- eligibility decision: ${approval.decisionBundle.decision}`)
    lines.push(`- required override: ${approval.decisionBundle.requiredOverride}`)
    lines.push(`- release policy source: ${approval.releasePolicy?.provenance.policySource ?? "n/a"}`)
    lines.push(`- release policy digest: ${approval.releasePolicy?.provenance.digest ?? "n/a"}`)
    lines.push(`- suggested concentration preset: ${approval.approvalPolicySuggestion?.suggestedReentryPolicy.approvalConcentrationPreset ?? "n/a"}`)
    lines.push(`- suggested concentration budget: ${approval.approvalPolicySuggestion?.suggestedReentryPolicy.approvalConcentrationBudget ?? "n/a"}`)
    lines.push(`- suggestion aligned with effective policy: ${approval.approvalPolicySuggestion?.alignment?.overall ?? "n/a"}`)
    lines.push(`- suggestion adoption status: ${approval.approvalPolicySuggestion?.adoption.status ?? "n/a"}`)
    lines.push(`- suggestion adoption differing fields: ${approval.approvalPolicySuggestion?.adoption.differingFields ?? "n/a"}`)
    lines.push(`- current active source: ${approval.snapshot.currentActiveSource ?? "none"}`)
    lines.push(`- last promotion at: ${approval.snapshot.lastPromotionAt ?? "n/a"}`)
    lines.push(`- last rollback at: ${approval.snapshot.lastRollbackAt ?? "n/a"}`)
    lines.push("")
    return lines.join("\n")
  }
}
