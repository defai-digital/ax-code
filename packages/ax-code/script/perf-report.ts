import fs from "fs/promises"
import path from "path"
import type { Bench } from "../src/cli/cmd/debug/perf"
import type { Verdict } from "./perf-index"

function arg(name: string) {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return
  const next = process.argv[idx + 1]
  if (!next || next.startsWith("--")) throw new Error(`Missing value for ${name}`)
  return next
}

function top(report: Bench, size = 5) {
  return Object.entries(report.summary.phases)
    .sort((a, b) => b[1].median - a[1].median)
    .slice(0, size)
}

function list(title: string, items: string[]) {
  if (items.length === 0) return []
  return [title, ...items, ""]
}

function line(diff: { name: string; currMs: number; prevMs: number; diffMs: number; diffPct?: number }) {
  const pct = diff.diffPct === undefined ? "n/a" : `${diff.diffPct >= 0 ? "+" : ""}${diff.diffPct.toFixed(1)}%`
  const ms = `${diff.diffMs >= 0 ? "+" : ""}${diff.diffMs.toFixed(2)}ms`
  return `- ${diff.name}: ${diff.currMs.toFixed(2)}ms vs ${diff.prevMs.toFixed(2)}ms (${ms}, ${pct})`
}

export function render(verdict: Verdict, report: Bench) {
  const out: string[] = []
  out.push("## ax-code perf report")
  out.push("")
  out.push(`- status: ${verdict.ok ? "passed" : "failed"}`)
  out.push(`- directory: ${verdict.directory}`)
  out.push(`- files: ${verdict.files}`)
  out.push(`- elapsed median: ${verdict.metrics.elapsedMs.toFixed(2)}ms`)
  out.push(`- builder total median: ${verdict.metrics.totalMs.toFixed(2)}ms`)
  out.push(`- cache mode: ${verdict.requested.cacheMode}`)
  out.push(`- repeat: ${verdict.requested.repeat}`)
  out.push(`- warmup: ${verdict.requested.warmup}`)
  out.push(`- concurrency: ${verdict.requested.concurrency}`)
  out.push(`- native profile: ${verdict.requested.nativeProfile ? "on" : "off"}`)
  out.push("")
  out.push("Artifacts:")
  out.push(`- report: ${verdict.out}`)
  out.push(`- summary: ${verdict.summary}`)
  if (verdict.baseline.file) out.push(`- baseline: ${verdict.baseline.file}`)
  if (verdict.baseline.summary) out.push(`- baseline summary: ${verdict.baseline.summary}`)
  if (verdict.baseline.out) out.push(`- promoted baseline: ${verdict.baseline.out}`)
  if (verdict.baseline.outSummary) out.push(`- promoted baseline summary: ${verdict.baseline.outSummary}`)
  out.push("")
  out.push("Provenance:")
  out.push(`- created at: ${verdict.meta.createdAt}`)
  if (verdict.meta.config) out.push(`- config: ${verdict.meta.config}`)
  if (verdict.meta.git.branch) out.push(`- git branch: ${verdict.meta.git.branch}`)
  if (verdict.meta.git.commit) out.push(`- git commit: ${verdict.meta.git.commit}`)
  out.push(
    `- runtime: bun ${verdict.meta.runtime.bun ?? "unknown"} on ${verdict.meta.runtime.platform}/${verdict.meta.runtime.arch}`,
  )
  if (verdict.meta.host.hostname) out.push(`- host: ${verdict.meta.host.hostname}`)
  if (verdict.meta.ci.githubWorkflow) out.push(`- github workflow: ${verdict.meta.ci.githubWorkflow}`)
  if (verdict.meta.ci.githubRunId) out.push(`- github run: ${verdict.meta.ci.githubRunId}`)
  if (verdict.meta.ci.githubRef) out.push(`- github ref: ${verdict.meta.ci.githubRef}`)
  out.push("")
  out.push("Gate:")
  out.push(`- status: ${verdict.gate.ok ? "passed" : "failed"}`)
  out.push(...verdict.gate.notes)
  if (verdict.gate.failures.length > 0)
    out.push(
      ...list(
        "Failures:",
        verdict.gate.failures.map((item) => `- ${item}`),
      ),
    )
  out.push("")

  if (verdict.compare) {
    out.push("Baseline Comparison:")
    out.push(`- status: ${verdict.compare.ok ? "passed" : "failed"}`)
    if (verdict.baseline.compat) {
      out.push("")
      out.push("Compatibility:")
      out.push(`- status: ${verdict.baseline.compat.ok ? "passed" : "failed"}`)
      out.push(...verdict.baseline.compat.notes)
      if (verdict.baseline.compat.failures.length > 0) {
        out.push(
          ...list(
            "Compatibility Failures:",
            verdict.baseline.compat.failures.map((item) => `- ${item}`),
          ),
        )
      }
    }
    out.push("")
    out.push("Comparison:")
    out.push(...verdict.compare.notes)
    if (verdict.compare.phases) {
      out.push(`- stable phases: ${verdict.compare.phases.stable}`)
      if (verdict.compare.phases.missing.length > 0) {
        out.push(`- missing phases: ${verdict.compare.phases.missing.join(", ")}`)
      }
      if (verdict.compare.phases.regressions.length > 0) {
        out.push("")
        out.push("Top regressions:")
        out.push(...verdict.compare.phases.regressions.slice(0, 5).map(line))
      }
      if (verdict.compare.phases.improvements.length > 0) {
        out.push("")
        out.push("Top improvements:")
        out.push(...verdict.compare.phases.improvements.slice(0, 5).map(line))
      }
    }
    if (verdict.compare.failures.length > 0) {
      out.push(
        ...list(
          "Failures:",
          verdict.compare.failures.map((item) => `- ${item}`),
        ),
      )
    }
    out.push("")
  }

  out.push("Top phases:")
  for (const [name, item] of top(report)) out.push(`- ${name}: median ${item.median.toFixed(2)}ms`)
  out.push("")
  return out.join("\n")
}

async function main() {
  const cwd = process.cwd()
  const sum = path.resolve(cwd, arg("--summary") ?? ".tmp/perf-index-summary.json")
  const out = path.resolve(cwd, arg("--out") ?? ".tmp/perf-index-report.md")
  const verdict = JSON.parse(await Bun.file(sum).text()) as Verdict
  const file = path.resolve(cwd, arg("--report") ?? verdict.out)
  const report = JSON.parse(await Bun.file(file).text()) as Bench
  const text = render(verdict, report)

  await fs.mkdir(path.dirname(out), { recursive: true })
  await Bun.write(out, text + "\n")
  console.log(text)
}

if (import.meta.main) {
  await main()
}
