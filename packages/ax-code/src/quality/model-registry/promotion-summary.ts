export type PromotionSummaryGate = {
  status: string
  detail?: string | null
}

export type PromotionSummary = {
  overallStatus: string
  gates: readonly PromotionSummaryGate[]
}

export function firstFailureDetail(gates: readonly PromotionSummaryGate[], fallback = "unknown failure") {
  return gates.find((gate) => gate.status === "fail")?.detail ?? fallback
}

export function assertPromotionSummaryPass(source: string, reason: string, summary: PromotionSummary) {
  if (summary.overallStatus === "pass") return
  throw new Error(`Cannot promote model ${source}: ${reason} (${firstFailureDetail(summary.gates)})`)
}
