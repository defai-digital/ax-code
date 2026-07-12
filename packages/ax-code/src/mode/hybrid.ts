/**
 * Hybrid placement policy (ADR-049 D5): local vs cloud is orthogonal to
 * specialist keyword routing and complexity-tier small-model selection.
 */

export namespace Hybrid {
  export type Placement = "local" | "cloud"

  export type RecommendInput = {
    localAvailable: boolean
    complexity?: "low" | "medium" | "high" | null
    privacyRequired?: boolean
    preferLocalWhenAvailable?: boolean
    escalateOnHighComplexity?: boolean
  }

  export type RecommendResult = {
    placement: Placement
    reasons: string[]
  }

  export function recommendPlacement(input: RecommendInput): RecommendResult {
    const preferLocal = input.preferLocalWhenAvailable !== false
    const escalateHigh = input.escalateOnHighComplexity !== false
    const reasons: string[] = []

    if (input.privacyRequired) {
      if (input.localAvailable) {
        reasons.push("privacy_required_local")
        return { placement: "local", reasons }
      }
      reasons.push("privacy_required_but_local_unavailable")
      return { placement: "cloud", reasons }
    }

    if (!input.localAvailable) {
      reasons.push("local_unavailable")
      return { placement: "cloud", reasons }
    }

    if (!preferLocal) {
      reasons.push("prefer_local_disabled")
      return { placement: "cloud", reasons }
    }

    if (escalateHigh && input.complexity === "high") {
      reasons.push("high_complexity_escalate_cloud")
      return { placement: "cloud", reasons }
    }

    reasons.push("local_available_prefer_local")
    if (input.complexity === "low") reasons.push("low_complexity_local_ok")
    if (input.complexity === "medium") reasons.push("medium_complexity_local_ok")
    return { placement: "local", reasons }
  }
}
