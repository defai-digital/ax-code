export type PassFailGateStatus = "pass" | "warn" | "fail"

export type GateLike = {
  status: PassFailGateStatus
}

export function overallStatusFromGates(gates: readonly GateLike[]): "pass" | "fail" {
  return gates.every((gate) => gate.status === "pass") ? "pass" : "fail"
}
