// Coercions for reading untrusted quality artifacts. The calibration model, the
// stability guard, the shadow runtime and the promotion watch each carried a
// private copy of one or more of these; the probing rollout re-exports them from
// ./probabilistic-rollout/helpers for its own consumers.

export function finiteOption(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function ratio(numerator: number, denominator: number) {
  if (denominator === 0) return null
  return Number((numerator / denominator).toFixed(4))
}

export function booleanField(input: Record<string, unknown> | undefined, key: string) {
  const value = input?.[key]
  return typeof value === "boolean" ? value : undefined
}
