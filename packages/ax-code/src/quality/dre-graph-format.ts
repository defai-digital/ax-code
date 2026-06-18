import type { SessionRisk } from "../session/risk"

const AGENT_DISPLAY: Record<string, string> = {
  build: "Dev",
  plan: "Planner",
  react: "Reasoner",
  general: "Assistant",
  explore: "Researcher",
  security: "Security",
  architect: "Architect",
  debug: "Debugger",
  perf: "Perf",
  devops: "DevOps",
  test: "Tester",
}

export function agentDisplay(name: string): string {
  return AGENT_DISPLAY[name] ?? name.charAt(0).toUpperCase() + name.slice(1)
}

export function esc(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function json(value: unknown) {
  const text = JSON.stringify(value) ?? "null"
  return text
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")
}

export function time(ms?: number) {
  if (ms == null) return "0s"
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  return `${min}m ${sec % 60}s`
}

export function stamp(ms?: number) {
  if (ms == null) return "unknown"
  const date = new Date(ms)
  if (!Number.isFinite(date.getTime())) return "unknown"
  return date.toISOString().replace("T", " ").slice(0, 19)
}

export function num(value?: number) {
  return (value ?? 0).toLocaleString()
}

export function tone(value?: string | null) {
  const text = (value ?? "").toLowerCase()
  if (text.includes("critical")) return "critical"
  if (text.includes("high")) return "high"
  if (text.includes("medium")) return "medium"
  return "low"
}

export function confidenceTone(value: number) {
  if (value >= 0.8) return "low"
  if (value >= 0.6) return "medium"
  return "high"
}

export function readinessTone(value: string) {
  if (value === "ready") return "low"
  if (value === "needs_validation") return "medium"
  if (value === "needs_review") return "high"
  return "critical"
}

export function readiness(value: string) {
  return value.replaceAll("_", " ")
}

export function validation(input: SessionRisk.Detail["assessment"]["signals"]) {
  if (input.validationState === "passed") return "validation passed"
  if (input.validationState === "failed") return "validation failed"
  if (input.validationState === "partial") return "partial validation"
  return "validation not recorded"
}
