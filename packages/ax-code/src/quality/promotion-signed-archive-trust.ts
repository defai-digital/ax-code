import { createHash } from "crypto"
import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionSignedArchive } from "./promotion-signed-archive"

export namespace QualityPromotionSignedArchiveTrust {
  export const Scope = z.enum(["global", "project"])
  export type Scope = z.output<typeof Scope>

  export const Lifecycle = z.enum(["active", "retired", "revoked"])
  export type Lifecycle = z.output<typeof Lifecycle>

  export const FingerprintAlgorithm = z.literal("sha256")
  export type FingerprintAlgorithm = z.output<typeof FingerprintAlgorithm>

  export const TrustArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-trust"),
    trustID: z.string(),
    scope: Scope,
    projectID: z.string().nullable(),
    registeredAt: z.string(),
    attestedBy: z.string(),
    keyID: z.string(),
    algorithm: z.lazy(() => QualityPromotionSignedArchive.SignatureAlgorithm),
    keySource: z.lazy(() => QualityPromotionSignedArchive.KeySource),
    keyLocator: z.string(),
    keyFingerprintAlgorithm: FingerprintAlgorithm,
    keyFingerprint: z.string(),
    lifecycle: Lifecycle,
    effectiveFrom: z.string(),
    retiredAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    rationale: z.string().nullable(),
  })
  export type TrustArtifact = z.output<typeof TrustArtifact>

  export const TrustRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-trust-record"),
    trust: TrustArtifact,
  })
  export type TrustRecord = z.output<typeof TrustRecord>

  export const Gate = z.object({
    name: z.string(),
    status: z.enum(["pass", "warn", "fail"]),
    detail: z.string(),
  })
  export type Gate = z.output<typeof Gate>

  export const Resolution = z.object({
    matched: z.boolean(),
    scope: Scope.nullable(),
    projectID: z.string().nullable(),
    trustID: z.string().nullable(),
    lifecycle: Lifecycle.nullable(),
    registeredAt: z.string().nullable(),
    effectiveFrom: z.string().nullable(),
    retiredAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
  })
  export type Resolution = z.output<typeof Resolution>

  export const TrustSummary = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-trust-summary"),
    source: z.string(),
    signedArchiveID: z.string(),
    promotionID: z.string(),
    evaluatedAt: z.string(),
    attestedBy: z.string(),
    keyID: z.string(),
    overallStatus: z.enum(["pass", "warn", "fail"]),
    structuralStatus: z.enum(["pass", "fail"]),
    signatureStatus: z.enum(["pass", "fail"]),
    registryStatus: z.enum(["pass", "fail"]),
    lifecycleStatus: z.enum(["pass", "warn", "fail"]),
    trusted: z.boolean(),
    resolution: Resolution,
    gates: z.array(Gate),
  })
  export type TrustSummary = z.output<typeof TrustSummary>

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function scopeKey(scope: Scope, projectID: string | null) {
    return scope === "global" ? "__global__" : encode(projectID!)
  }

  function key(scope: Scope, projectID: string | null, trustID: string) {
    return ["quality_model_signed_archive_trust", scope, scopeKey(scope, projectID), trustID]
  }

  function sortTrusts(trusts: TrustArtifact[]) {
    return [...trusts].sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === "project" ? -1 : 1
      const byRegisteredAt = a.registeredAt.localeCompare(b.registeredAt)
      if (byRegisteredAt !== 0) return byRegisteredAt
      return a.trustID.localeCompare(b.trustID)
    })
  }

  export function fingerprintKeyMaterial(keyMaterial: string) {
    return createHash("sha256").update(keyMaterial).digest("hex")
  }

  function matchesArchive(archive: QualityPromotionSignedArchive.ArchiveArtifact, trust: TrustArtifact) {
    return trust.attestedBy === archive.attestation.attestedBy
      && trust.keyID === archive.attestation.keyID
      && trust.algorithm === archive.attestation.algorithm
      && trust.keySource === archive.attestation.keySource
      && trust.keyLocator === archive.attestation.keyLocator
  }

  function pickBestMatch(matches: TrustArtifact[]) {
    return [...matches].sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === "project" ? -1 : 1
      const byRegisteredAt = b.registeredAt.localeCompare(a.registeredAt)
      if (byRegisteredAt !== 0) return byRegisteredAt
      return b.trustID.localeCompare(a.trustID)
    })[0] ?? null
  }

  function severity(status: Gate["status"]) {
    return status === "fail" ? 2 : status === "warn" ? 1 : 0
  }

  function summarizeOverall(gates: Gate[]) {
    const highest = gates.reduce((max, gate) => Math.max(max, severity(gate.status)), 0)
    return highest === 2 ? "fail" : highest === 1 ? "warn" : "pass"
  }

  export function create(input: {
    scope: Scope
    projectID?: string | null
    signing: QualityPromotionSignedArchive.SigningInput
    lifecycle?: Lifecycle
    effectiveFrom?: string
    retiredAt?: string | null
    revokedAt?: string | null
    rationale?: string | null
  }) {
    if (input.scope === "project" && !input.projectID) {
      throw new Error("projectID is required for project-scoped signed archive trust entries")
    }
    if (input.scope === "global" && input.projectID) {
      throw new Error("projectID is not allowed for global signed archive trust entries")
    }
    const lifecycle = input.lifecycle ?? "active"
    if (lifecycle === "retired" && !input.retiredAt) {
      throw new Error("retiredAt is required when lifecycle=retired")
    }
    if (lifecycle === "revoked" && !input.revokedAt) {
      throw new Error("revokedAt is required when lifecycle=revoked")
    }
    const registeredAt = new Date().toISOString()
    const trustID = `${Date.now()}-${input.scope}-${encode(input.projectID ?? "__global__")}-${encode(input.signing.keyID)}`
    return TrustArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-trust",
      trustID,
      scope: input.scope,
      projectID: input.scope === "project" ? input.projectID! : null,
      registeredAt,
      attestedBy: input.signing.attestedBy,
      keyID: input.signing.keyID,
      algorithm: "hmac-sha256",
      keySource: input.signing.keySource,
      keyLocator: input.signing.keyLocator,
      keyFingerprintAlgorithm: "sha256",
      keyFingerprint: fingerprintKeyMaterial(input.signing.keyMaterial),
      lifecycle,
      effectiveFrom: input.effectiveFrom ?? registeredAt,
      retiredAt: lifecycle === "retired" || input.retiredAt ? input.retiredAt ?? null : null,
      revokedAt: lifecycle === "revoked" || input.revokedAt ? input.revokedAt ?? null : null,
      rationale: input.rationale ?? null,
    })
  }

  export async function get(input: { scope: Scope; projectID?: string | null; trustID: string }) {
    const record = await Storage.read<unknown>(key(input.scope, input.scope === "project" ? input.projectID ?? null : null, input.trustID))
    return TrustRecord.parse(record)
  }

  export async function append(trust: TrustArtifact) {
    const next = TrustRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-trust-record",
      trust,
    })
    try {
      const existing = await get({ scope: trust.scope, projectID: trust.projectID, trustID: trust.trustID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(`Signed archive trust entry ${trust.trustID} already exists with different content`)
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(trust.scope, trust.projectID, trust.trustID), next)
      return next
    }
  }

  export async function list(input?: { scope?: Scope; projectID?: string }) {
    const prefixes = input?.scope
      ? [[
        "quality_model_signed_archive_trust",
        input.scope,
        input.scope === "global" ? "__global__" : encode(input.projectID ?? (() => {
          throw new Error("projectID is required to list project-scoped signed archive trust entries")
        })()),
      ]]
      : [["quality_model_signed_archive_trust"]]
    const trusts: TrustArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const scope = parts[parts.length - 3]
        const encodedProject = parts[parts.length - 2]
        const trustID = parts[parts.length - 1]
        if (!scope || !encodedProject || !trustID) continue
        const record = await get({
          scope: Scope.parse(scope),
          projectID: scope === "project" ? decode(encodedProject) : null,
          trustID,
        })
        trusts.push(record.trust)
      }
    }

    return sortTrusts(trusts)
  }

  export async function resolve(
    archive: QualityPromotionSignedArchive.ArchiveArtifact,
    options?: {
      projectID?: string
      trusts?: TrustArtifact[]
    },
  ) {
    const persisted = [
      ...(options?.projectID ? await list({ scope: "project", projectID: options.projectID }) : []),
      ...await list({ scope: "global" }),
    ]
    const deduped = new Map<string, TrustArtifact>()
    for (const trust of [...persisted, ...(options?.trusts ?? [])]) {
      if (!matchesArchive(archive, trust)) continue
      deduped.set(trust.trustID, trust)
    }
    const matches = sortTrusts([...deduped.values()])
    const selected = pickBestMatch(matches)
    return {
      selected,
      matches,
    }
  }

  export async function evaluate(input: {
    archive: QualityPromotionSignedArchive.ArchiveArtifact
    keyMaterial: string
    projectID?: string
    trusts?: TrustArtifact[]
  }) {
    const evaluatedAt = new Date().toISOString()
    const structuralReasons = QualityPromotionSignedArchive.verify(input.archive)
    const signatureReasons = structuralReasons.length > 0
      ? structuralReasons
      : QualityPromotionSignedArchive.verifySignature(input.archive, input.keyMaterial)
    const { selected } = await resolve(input.archive, {
      projectID: input.projectID,
      trusts: input.trusts,
    })
    const signedAt = input.archive.attestation.signedAt
    const fingerprint = fingerprintKeyMaterial(input.keyMaterial)
    const fingerprintMatches = selected ? selected.keyFingerprint === fingerprint : false

    const gates: Gate[] = [
      {
        name: "signed-archive-verification",
        status: structuralReasons.length === 0 ? "pass" : "fail",
        detail: structuralReasons[0] ?? `signed archive ${input.archive.signedArchiveID} is structurally valid`,
      },
      {
        name: "signature-verification",
        status: signatureReasons.length === 0 ? "pass" : "fail",
        detail: signatureReasons[0] ?? `signature verified for key ${input.archive.attestation.keyID}`,
      },
      {
        name: "trust-registry-match",
        status: selected ? "pass" : "fail",
        detail: selected
          ? `matched ${selected.scope} trust entry ${selected.trustID}`
          : `no trust entry found for ${input.archive.attestation.attestedBy}/${input.archive.attestation.keyID}`,
      },
      {
        name: "trust-key-fingerprint",
        status: selected ? (fingerprintMatches ? "pass" : "fail") : "fail",
        detail: selected
          ? (fingerprintMatches
            ? `provided key matches registered fingerprint for ${selected.keyID}`
            : `provided key fingerprint does not match trust entry ${selected.trustID}`)
          : "cannot compare key fingerprint without a matched trust entry",
      },
    ]

    let lifecycleStatus: Gate["status"] = selected ? "pass" : "fail"
    let lifecycleDetail = selected
      ? `key ${selected.keyID} is active`
      : "no trust entry available to evaluate lifecycle"

    if (selected) {
      if (signedAt < selected.effectiveFrom) {
        lifecycleStatus = "fail"
        lifecycleDetail = `signed archive predates trust effectiveFrom ${selected.effectiveFrom}`
      } else if (selected.lifecycle === "active") {
        lifecycleStatus = "pass"
        lifecycleDetail = `key ${selected.keyID} is active`
      } else if (selected.lifecycle === "retired") {
        if (selected.retiredAt && signedAt > selected.retiredAt) {
          lifecycleStatus = "fail"
          lifecycleDetail = `signed archive was attested after key retirement at ${selected.retiredAt}`
        } else {
          lifecycleStatus = "warn"
          lifecycleDetail = `key ${selected.keyID} is retired${selected.retiredAt ? ` since ${selected.retiredAt}` : ""}`
        }
      } else if (selected.lifecycle === "revoked") {
        if (selected.revokedAt && signedAt > selected.revokedAt) {
          lifecycleStatus = "fail"
          lifecycleDetail = `signed archive was attested after key revocation at ${selected.revokedAt}`
        } else {
          lifecycleStatus = "warn"
          lifecycleDetail = `key ${selected.keyID} is revoked${selected.revokedAt ? ` since ${selected.revokedAt}` : ""}`
        }
      }
    }

    gates.push({
      name: "trust-lifecycle",
      status: lifecycleStatus,
      detail: lifecycleDetail,
    })

    const overallStatus = summarizeOverall(gates)
    return TrustSummary.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-trust-summary",
      source: input.archive.source,
      signedArchiveID: input.archive.signedArchiveID,
      promotionID: input.archive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID,
      evaluatedAt,
      attestedBy: input.archive.attestation.attestedBy,
      keyID: input.archive.attestation.keyID,
      overallStatus,
      structuralStatus: structuralReasons.length === 0 ? "pass" : "fail",
      signatureStatus: signatureReasons.length === 0 ? "pass" : "fail",
      registryStatus: selected && fingerprintMatches ? "pass" : "fail",
      lifecycleStatus,
      trusted: overallStatus === "pass",
      resolution: {
        matched: !!selected,
        scope: selected?.scope ?? null,
        projectID: selected?.projectID ?? null,
        trustID: selected?.trustID ?? null,
        lifecycle: selected?.lifecycle ?? null,
        registeredAt: selected?.registeredAt ?? null,
        effectiveFrom: selected?.effectiveFrom ?? null,
        retiredAt: selected?.retiredAt ?? null,
        revokedAt: selected?.revokedAt ?? null,
      },
      gates,
    })
  }

  export function renderReport(summary: TrustSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion signed archive trust")
    lines.push("")
    lines.push(`- source: ${summary.source}`)
    lines.push(`- signed archive id: ${summary.signedArchiveID}`)
    lines.push(`- promotion id: ${summary.promotionID}`)
    lines.push(`- evaluated at: ${summary.evaluatedAt}`)
    lines.push(`- attested by: ${summary.attestedBy}`)
    lines.push(`- key id: ${summary.keyID}`)
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- structural status: ${summary.structuralStatus}`)
    lines.push(`- signature status: ${summary.signatureStatus}`)
    lines.push(`- registry status: ${summary.registryStatus}`)
    lines.push(`- lifecycle status: ${summary.lifecycleStatus}`)
    lines.push(`- trusted: ${summary.trusted}`)
    lines.push(`- trust scope: ${summary.resolution.scope ?? "unresolved"}`)
    lines.push(`- trust id: ${summary.resolution.trustID ?? "n/a"}`)
    lines.push("")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  export function renderTrust(trust: TrustArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion signed archive trust entry")
    lines.push("")
    lines.push(`- trust id: ${trust.trustID}`)
    lines.push(`- scope: ${trust.scope}`)
    lines.push(`- project id: ${trust.projectID ?? "n/a"}`)
    lines.push(`- registered at: ${trust.registeredAt}`)
    lines.push(`- attested by: ${trust.attestedBy}`)
    lines.push(`- key id: ${trust.keyID}`)
    lines.push(`- key source: ${trust.keySource}`)
    lines.push(`- key locator: ${trust.keyLocator}`)
    lines.push(`- lifecycle: ${trust.lifecycle}`)
    lines.push(`- effective from: ${trust.effectiveFrom}`)
    lines.push(`- retired at: ${trust.retiredAt ?? "n/a"}`)
    lines.push(`- revoked at: ${trust.revokedAt ?? "n/a"}`)
    lines.push(`- fingerprint: ${trust.keyFingerprint}`)
    lines.push(`- rationale: ${trust.rationale ?? "n/a"}`)
    lines.push("")
    return lines.join("\n")
  }
}
