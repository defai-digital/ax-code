import z from "zod"

// Signed-archive evidence summaries shared by the model-registry promotion
// record and the promotion audit manifest.
export const signedArchiveEvidenceShape = {
  signedArchive: z
    .object({
      signedArchiveID: z.string(),
      createdAt: z.string(),
      archiveID: z.string(),
      exportID: z.string(),
      promotionID: z.string(),
      keyID: z.string(),
      attestedBy: z.string(),
      algorithm: z.literal("hmac-sha256"),
      overallStatus: z.enum(["pass", "fail"]),
    })
    .optional(),
  signedArchiveTrust: z
    .object({
      overallStatus: z.enum(["pass", "warn", "fail"]),
      trusted: z.boolean(),
      signatureStatus: z.enum(["pass", "fail"]),
      registryStatus: z.enum(["pass", "fail"]),
      lifecycleStatus: z.enum(["pass", "warn", "fail"]),
      resolution: z.object({
        matched: z.boolean(),
        scope: z.enum(["global", "project"]).nullable(),
        projectID: z.string().nullable(),
        trustID: z.string().nullable(),
        lifecycle: z.enum(["active", "retired", "revoked"]).nullable(),
        registeredAt: z.string().nullable(),
        effectiveFrom: z.string().nullable(),
        retiredAt: z.string().nullable(),
        revokedAt: z.string().nullable(),
      }),
    })
    .optional(),
  signedArchiveAttestation: z
    .object({
      overallStatus: z.enum(["pass", "warn", "fail"]),
      policySource: z.enum(["explicit", "project", "global", "default"]),
      policyProjectID: z.string().nullable(),
      policyDigest: z.string(),
      acceptedByPolicy: z.boolean(),
      trustStatus: z.enum(["pass", "warn", "fail"]),
      minimumScopeStatus: z.enum(["pass", "fail"]),
      lifecyclePolicyStatus: z.enum(["pass", "warn", "fail"]),
      effectiveTrustScope: z.enum(["global", "project"]).nullable(),
      effectiveTrustLifecycle: z.enum(["active", "retired", "revoked"]).nullable(),
    })
    .optional(),
}
