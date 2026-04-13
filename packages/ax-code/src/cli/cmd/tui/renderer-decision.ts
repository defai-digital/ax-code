export type TuiRendererDecision =
  | {
      action: "retain-opentui"
      reason: string
    }
  | {
      action: "fix-product-layer"
      reason: string
    }
  | {
      action: "upstream-or-fork-opentui"
      reason: string
    }
  | {
      action: "propose-rust-native-core"
      reason: string
      requiresAdr: true
    }

export type TuiRendererIssueLayer = "product-layer" | "integration-layer" | "renderer-specific"

export function decideTuiRenderer(input: {
  criteriaFailures: string[]
  issueLayer?: TuiRendererIssueLayer
  rendererSpecific?: boolean
  blocksProductDirection: boolean
  installOrBuildRiskAccepted: boolean
  offlinePackagingDeterministic?: boolean
}): TuiRendererDecision {
  const rendererSpecific = input.issueLayer
    ? input.issueLayer === "renderer-specific"
    : input.rendererSpecific === true

  if (input.criteriaFailures.length === 0) {
    return {
      action: "retain-opentui",
      reason: "No reproducible performance or product-direction failure is present.",
    }
  }

  if (!rendererSpecific) {
    return {
      action: "fix-product-layer",
      reason: "The failure is not isolated to the renderer boundary.",
    }
  }

  if (!input.blocksProductDirection || !input.installOrBuildRiskAccepted || input.offlinePackagingDeterministic !== true) {
    return {
      action: "upstream-or-fork-opentui",
      reason:
        "The issue is renderer-specific, but a native core is not justified without product blockage, accepted delivery risk, and deterministic offline packaging.",
    }
  }

  return {
    action: "propose-rust-native-core",
    reason:
      "The renderer-specific failure blocks product direction, delivery risk is accepted, and offline packaging is deterministic.",
    requiresAdr: true,
  }
}
