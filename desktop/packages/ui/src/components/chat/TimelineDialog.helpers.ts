import type { SessionRollbackPoint } from "@ax-code/sdk/v2"

export function formatRollbackPointMeta(point: SessionRollbackPoint): string {
  const labels = point.tools.length > 0 ? point.tools : point.kinds
  const segments = [labels.length > 0 ? labels.join(", ") : "No tool calls"]
  if (point.tokens) {
    segments.push(`${formatTokenCount(point.tokens.input)} in / ${formatTokenCount(point.tokens.output)} out`)
  }
  if (typeof point.duration === "number") {
    segments.push(formatDuration(point.duration))
  }
  return segments.join(" | ")
}

function formatTokenCount(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

function formatDuration(durationMs: number): string {
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`
  return `${Math.max(0, Math.round(durationMs))}ms`
}
