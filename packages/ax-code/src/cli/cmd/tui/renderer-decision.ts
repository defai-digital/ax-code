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

export function decideTuiRenderer(input: {
  criteriaFailures: string[]
  rendererSpecific: boolean
  blocksProductDirection: boolean
  installOrBuildRiskAccepted: boolean
}): TuiRendererDecision {
  if (input.criteriaFailures.length === 0) {
    return {
      action: "retain-opentui",
      reason: "No reproducible performance or product-direction failure is present.",
    }
  }

  if (!input.rendererSpecific) {
    return {
      action: "fix-product-layer",
      reason: "The failure is not isolated to the renderer boundary.",
    }
  }

  if (!input.blocksProductDirection || !input.installOrBuildRiskAccepted) {
    return {
      action: "upstream-or-fork-opentui",
      reason: "The issue is renderer-specific, but a native core is not justified without product blockage and accepted delivery risk.",
    }
  }

  return {
    action: "propose-rust-native-core",
    reason: "The renderer-specific failure blocks product direction and the delivery risk is explicitly accepted.",
    requiresAdr: true,
  }
}
