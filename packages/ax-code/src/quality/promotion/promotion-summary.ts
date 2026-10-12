export type PassFailGateStatus = "pass" | "warn" | "fail"

export type GateLike = {
  status: PassFailGateStatus
}

export function overallStatusFromGates(gates: readonly GateLike[]): "pass" | "fail" {
  return gates.every((gate) => gate.status === "pass") ? "pass" : "fail"
}

export type GateLine = {
  status: string
  name: string
  detail: string
}

/**
 * Append the markdown bullet list for a set of gates. Every promotion and
 * readiness report renders gates in this one format, so a format change lands
 * in every report instead of only the copy that was edited.
 */
export function pushGateLines(lines: string[], gates: readonly GateLine[]): void {
  for (const gate of gates) lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
}
