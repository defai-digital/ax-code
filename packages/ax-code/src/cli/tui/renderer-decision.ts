export type TuiRendererDecision =
  | {
      action: "retain-ax-tui"
      reason: string
    }
  | {
      action: "fix-product-layer"
      reason: string
    }
  | {
      action: "improve-ax-tui"
      reason: string
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
  const rendererSpecific = input.issueLayer ? input.issueLayer === "renderer-specific" : input.rendererSpecific === true

  if (input.criteriaFailures.length === 0) {
    return {
      action: "retain-ax-tui",
      reason: "No reproducible performance or product-direction failure is present.",
    }
  }

  if (!rendererSpecific) {
    return {
      action: "fix-product-layer",
      reason: "The failure is not isolated to the renderer boundary.",
    }
  }

  return {
    action: "improve-ax-tui",
    reason: input.blocksProductDirection
      ? "The renderer-specific failure blocks product direction and belongs in AX Code TUI."
      : "The renderer-specific failure belongs in AX Code TUI without changing renderer ownership.",
  }
}
