import { z } from "zod"

const capabilitySchema = z.object({
  schemaVersion: z.literal(1),
  product: z.literal("ax-code"),
  version: z.string().min(1),
  compatibility: z.object({ sdkHeadless: z.object({ schemaVersion: z.literal(1) }) }),
  features: z.record(z.string(), z.boolean()),
})

/** Features an application requires the backend to explicitly advertise. */
export type HeadlessCompatibilityRequirements = {
  requiredFeatures?: readonly string[]
}

/** Capability-protocol compatibility; SDK semver and binary provenance are independent checks. */
export type HeadlessCompatibilityResult = {
  compatible: boolean
  runtimeVersion?: string
  issues: string[]
}

/** Validate a backend's protocol and required features without guessing support from its version. */
export function checkHeadlessRuntimeCompatibility(
  capabilities: unknown,
  requirements: HeadlessCompatibilityRequirements = {},
): HeadlessCompatibilityResult {
  const parsed = capabilitySchema.safeParse(capabilities)
  if (!parsed.success) {
    return {
      compatible: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "capabilities"}: ${issue.message}`),
    }
  }
  const issues = [...new Set(requirements.requiredFeatures ?? [])]
    .filter((feature) => parsed.data.features[feature] !== true)
    .map((feature) => `Runtime does not advertise required feature: ${feature}`)
  return { compatible: issues.length === 0, runtimeVersion: parsed.data.version, issues }
}
