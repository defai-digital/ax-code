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
  if (value >= 999_500) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

function formatDuration(durationMs: number): string {
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  const totalMilliseconds = Math.round(safeDurationMs)
  if (totalMilliseconds < 1000) return `${totalMilliseconds}ms`

  const totalSeconds = Math.round(safeDurationMs / 1000)
  if (totalSeconds >= 60) return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`
  return `${(safeDurationMs / 1000).toFixed(safeDurationMs >= 10_000 ? 0 : 1)}s`
}
