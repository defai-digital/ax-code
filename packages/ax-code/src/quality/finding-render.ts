import type { Finding } from "./finding"
import type { Severity } from "./finding-registry"

export type RenderOptions = {
  color?: boolean
  group?: "file" | "severity" | "category" | "none"
}

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
}

const SEVERITY_GLYPH: Record<Severity, string> = {
  CRITICAL: "✗",
  HIGH: "✗",
  MEDIUM: "⚠",
  LOW: "·",
  INFO: "·",
}

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
} as const

const SEVERITY_COLOR: Record<Severity, keyof typeof ANSI | "reset"> = {
  CRITICAL: "red",
  HIGH: "red",
  MEDIUM: "yellow",
  LOW: "blue",
  INFO: "gray",
}

function paint(text: string, color: keyof typeof ANSI, enabled: boolean): string {
  if (!enabled) return text
  return `${ANSI[color]}${text}${ANSI.reset}`
}

function formatAnchor(finding: Finding): string {
  if (finding.anchor.kind === "line") {
    if (finding.anchor.endLine && finding.anchor.endLine !== finding.anchor.line) {
      return `${finding.file}:${finding.anchor.line}-${finding.anchor.endLine}`
    }
    return `${finding.file}:${finding.anchor.line}`
  }
  return `${finding.file} (${finding.anchor.symbolId})`
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (sev !== 0) return sev
    const file = a.file.localeCompare(b.file)
    if (file !== 0) return file
    const aLine = a.anchor.kind === "line" ? a.anchor.line : 0
    const bLine = b.anchor.kind === "line" ? b.anchor.line : 0
    return aLine - bLine
  })
}

function groupKey(finding: Finding, group: NonNullable<RenderOptions["group"]>): string {
  if (group === "file") return finding.file
  if (group === "severity") return finding.severity
  if (group === "category") return finding.category
  return ""
}

function renderOne(finding: Finding, color: boolean): string {
  const glyph = paint(SEVERITY_GLYPH[finding.severity], SEVERITY_COLOR[finding.severity], color)
  const sev = paint(finding.severity, SEVERITY_COLOR[finding.severity], color)
  const anchor = paint(formatAnchor(finding), "gray", color)
  const cat = paint(`[${finding.category}]`, "dim", color)
  const lines = [
    `${glyph} ${sev} ${cat} ${finding.summary}`,
    `  ${anchor}`,
    `  ${paint("why:", "dim", color)} ${finding.rationale}`,
  ]
  if (finding.evidence.length > 0) {
    lines.push(`  ${paint("evidence:", "dim", color)}`)
    for (const e of finding.evidence) lines.push(`    - ${e}`)
  }
  lines.push(`  ${paint("next:", "dim", color)} ${finding.suggestedNextAction}`)
  if (finding.confidence !== undefined) {
    lines.push(`  ${paint("confidence:", "dim", color)} ${finding.confidence.toFixed(2)}`)
  }
  if (finding.ruleId) {
    lines.push(`  ${paint("rule:", "dim", color)} ${finding.ruleId}`)
  }
  return lines.join("\n")
}

export function renderTerminal(findings: Finding[], opts: RenderOptions = {}): string {
  const color = opts.color ?? false
  const group = opts.group ?? "severity"
  if (findings.length === 0) {
    return "No findings."
  }
  const sorted = sortFindings(findings)
  if (group === "none") {
    return sorted.map((f) => renderOne(f, color)).join("\n\n")
  }
  const groups = new Map<string, Finding[]>()
  for (const finding of sorted) {
    const key = groupKey(finding, group)
    const bucket = groups.get(key)
    if (bucket) bucket.push(finding)
    else groups.set(key, [finding])
  }
  const sections: string[] = []
  for (const [key, bucket] of groups) {
    const header = paint(`── ${key} (${bucket.length}) ──`, "bold", color)
    sections.push(header)
    for (const finding of bucket) sections.push(renderOne(finding, color))
  }
  return sections.join("\n\n")
}

export function renderJson(findings: Finding[]): string {
  return JSON.stringify(findings, null, 2)
}
