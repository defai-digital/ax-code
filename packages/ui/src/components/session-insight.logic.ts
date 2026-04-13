import type {
  SessionCompareResult,
  SessionCompareSummary,
  SessionDreTimelineLine,
  SessionRollbackPoint,
} from "@ax-code/sdk/v2"
import type { CardProps } from "./card"

type Level = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"

function plural(value: number, one: string, other = `${one}s`) {
  return `${value} ${value === 1 ? one : other}`
}

export function sessionInsightVariant(level?: Level): CardProps["variant"] {
  if (level === "LOW") return "success"
  if (level === "MEDIUM") return "warning"
  if (level === "HIGH" || level === "CRITICAL") return "error"
  return "normal"
}

export function sessionInsightDuration(ms: number) {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  return `${min}m ${sec % 60}s`
}

export function sessionCompareLead(result: SessionCompareResult) {
  if (result.advisory.winner === "tie") return "No clear recommendation"
  const target = result.advisory.winner === "A" ? result.session1.title : result.session2.title
  return `Prefer ${target || result.advisory.winner}`
}

export function sessionCompareFacts(summary: SessionCompareSummary) {
  return [
    plural(summary.risk.signals.filesChanged, "file"),
    `${summary.risk.signals.linesChanged} lines`,
    plural(summary.events, "event"),
  ]
}

export function sessionCompareDelta(result: SessionCompareResult) {
  const out = [] as string[]
  if (result.differences.toolChainDiffers) out.push("tool chain changed")
  if (result.differences.routeDiffers) out.push("routing changed")
  if (result.differences.eventCountDelta !== 0)
    out.push(`${result.differences.eventCountDelta > 0 ? "+" : ""}${result.differences.eventCountDelta} events`)
  if (out.length > 0) return out
  return ["signals are materially similar"]
}

export function sessionRollbackLead(points: SessionRollbackPoint[]) {
  if (points.length === 0) return "No rollback points recorded"
  if (points.length === 1) return `1 rollback point at step ${points[0].step}`
  const first = points[0].step
  const last = points[points.length - 1].step
  return `${points.length} rollback points from step ${first} to ${last}`
}

export function sessionRollbackFacts(point: SessionRollbackPoint) {
  const out = [`step ${point.step}`]
  if (point.duration != null) out.push(sessionInsightDuration(point.duration))
  if (point.tokens) out.push(`${point.tokens.input}/${point.tokens.output} tokens`)
  if (point.tools.length > 0) out.push(plural(point.tools.length, "tool"))
  return out
}

export function sessionRollbackToolLead(point: SessionRollbackPoint) {
  if (point.tools.length === 0) return "No tool calls recorded"
  if (point.tools.length === 1) return point.tools[0]
  return `${point.tools[0]} +${point.tools.length - 1} more`
}

export function sessionTimelineTone(kind: SessionDreTimelineLine["kind"]) {
  if (kind === "error") return "var(--icon-critical-base)"
  if (kind === "route") return "var(--icon-info-active)"
  if (kind === "tool") return "var(--icon-warning-active)"
  if (kind === "llm") return "var(--icon-success-active)"
  if (kind === "heading") return "var(--text-primary)"
  return "var(--text-secondary)"
}
