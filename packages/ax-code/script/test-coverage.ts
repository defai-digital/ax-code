import fs from "fs/promises"
import path from "path"

export type CoverageMetric = {
  covered: number
  total: number
  pct?: number
  available: boolean
}

export type CoverageFileSummary = {
  path: string
  lines: CoverageMetric
  functions: CoverageMetric
  branches: CoverageMetric
}

export type CoverageMetricDelta = {
  currentPct: number
  baselinePct: number
  deltaPct: number
}

export type CoverageFileDelta = {
  path: string
  currentPct: number
  baselinePct: number
  deltaPct: number
}

export type CoverageTrend = {
  baselineFile: string
  notes: string[]
  metrics: {
    lines?: CoverageMetricDelta
    functions?: CoverageMetricDelta
    branches?: CoverageMetricDelta
  }
  files: {
    lineRegressions: CoverageFileDelta[]
    lineImprovements: CoverageFileDelta[]
    branchRegressions: CoverageFileDelta[]
    branchImprovements: CoverageFileDelta[]
  }
}

export type CoverageSummary = {
  schemaVersion: 1
  kind: "ax-code-coverage-summary"
  group: string
  fileCount: number
  metrics: {
    lines: CoverageMetric
    functions: CoverageMetric
    branches: CoverageMetric
  }
  files: CoverageFileSummary[]
  artifacts: {
    lcov: string
    report: string
    summary: string
  }
  notes: string[]
  trend?: CoverageTrend
  meta: {
    createdAt: string
    runtime: {
      bun?: string
      platform: string
      arch: string
    }
    git: {
      branch?: string
      commit?: string
    }
    ci: {
      githubWorkflow?: string
      githubRunId?: string
      githubRef?: string
    }
  }
}

type LcovRecord = {
  file: string
  lines: {
    covered: number
    total: number
  }
  functions: {
    covered: number
    total: number
  }
  branches: {
    covered: number
    total: number
  }
  hasBranchCounters: boolean
}

function percent(covered: number, total: number, available = true) {
  if (!available || total <= 0) return undefined
  return (covered / total) * 100
}

function metric(covered: number, total: number, available = true): CoverageMetric {
  return {
    covered,
    total,
    pct: percent(covered, total, available),
    available,
  }
}

function coverageLine(value: number | undefined) {
  return value === undefined ? "unavailable" : `${value.toFixed(2)}%`
}

function relativeArtifact(file: string) {
  return path.relative(process.cwd(), file) || path.basename(file)
}

function parseDA(line: string) {
  const value = line.slice(3).split(",", 2)
  if (value.length < 2) return undefined
  const hits = Number.parseInt(value[1] ?? "", 10)
  if (Number.isNaN(hits)) return undefined
  return hits
}

function parseLCOVRecord(text: string): LcovRecord | undefined {
  const lines = text.split("\n").filter(Boolean)
  const file = lines.find((line) => line.startsWith("SF:"))?.slice(3)
  if (!file) return undefined

  let lineCovered = 0
  let lineTotal = 0
  let functionCovered = 0
  let functionTotal = 0
  let branchCovered = 0
  let branchTotal = 0
  let branchSummarySeen = false
  let hasBranchCounters = false

  for (const line of lines) {
    if (line.startsWith("DA:")) {
      const hits = parseDA(line)
      if (hits === undefined) continue
      lineTotal += 1
      if (hits > 0) lineCovered += 1
      continue
    }

    if (line.startsWith("FNF:")) {
      const value = Number.parseInt(line.slice(4), 10)
      if (!Number.isNaN(value)) functionTotal = value
      continue
    }

    if (line.startsWith("FNH:")) {
      const value = Number.parseInt(line.slice(4), 10)
      if (!Number.isNaN(value)) functionCovered = value
      continue
    }

    if (line.startsWith("BRF:")) {
      hasBranchCounters = true
      branchSummarySeen = true
      const value = Number.parseInt(line.slice(4), 10)
      if (!Number.isNaN(value)) branchTotal = value
      continue
    }

    if (line.startsWith("BRH:")) {
      hasBranchCounters = true
      branchSummarySeen = true
      const value = Number.parseInt(line.slice(4), 10)
      if (!Number.isNaN(value)) branchCovered = value
      continue
    }

    if (line.startsWith("BRDA:")) {
      hasBranchCounters = true
      if (branchSummarySeen) continue
      const parts = line.slice(5).split(",")
      const taken = parts[3]
      branchTotal += 1
      if (taken && taken !== "-" && Number.parseInt(taken, 10) > 0) branchCovered += 1
    }
  }

  return {
    file,
    lines: {
      covered: lineCovered,
      total: lineTotal,
    },
    functions: {
      covered: functionCovered,
      total: functionTotal,
    },
    branches: {
      covered: branchCovered,
      total: branchTotal,
    },
    hasBranchCounters,
  }
}

export function parseLCOV(text: string): CoverageFileSummary[] {
  const records = text
    .split("end_of_record")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseLCOVRecord)
    .filter((record): record is LcovRecord => Boolean(record))

  const hasBranchCounters = records.some((record) => record.hasBranchCounters)

  return records
    .map((record) => ({
      path: path.relative(process.cwd(), record.file) || record.file,
      lines: metric(record.lines.covered, record.lines.total),
      functions: metric(record.functions.covered, record.functions.total),
      branches: metric(record.branches.covered, record.branches.total, hasBranchCounters),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

export function totals(files: CoverageFileSummary[]) {
  const branchAvailable = files.some((file) => file.branches.available)
  return {
    lines: metric(
      files.reduce((sum, file) => sum + file.lines.covered, 0),
      files.reduce((sum, file) => sum + file.lines.total, 0),
    ),
    functions: metric(
      files.reduce((sum, file) => sum + file.functions.covered, 0),
      files.reduce((sum, file) => sum + file.functions.total, 0),
    ),
    branches: metric(
      files.reduce((sum, file) => sum + file.branches.covered, 0),
      files.reduce((sum, file) => sum + file.branches.total, 0),
      branchAvailable,
    ),
  }
}

function delta(current: CoverageMetric, baseline: CoverageMetric): CoverageMetricDelta | undefined {
  if (!current.available || !baseline.available) return undefined
  if (current.pct === undefined || baseline.pct === undefined) return undefined
  return {
    currentPct: current.pct,
    baselinePct: baseline.pct,
    deltaPct: current.pct - baseline.pct,
  }
}

function fileDeltas(
  current: CoverageFileSummary[],
  baseline: CoverageFileSummary[],
  pick: (file: CoverageFileSummary) => CoverageMetric,
) {
  const baselineMap = new Map(baseline.map((file) => [file.path, file]))
  const deltas: CoverageFileDelta[] = []

  for (const file of current) {
    const prev = baselineMap.get(file.path)
    if (!prev) continue
    const nextMetric = pick(file)
    const prevMetric = pick(prev)
    if (!nextMetric.available || !prevMetric.available) continue
    if (nextMetric.pct === undefined || prevMetric.pct === undefined) continue
    deltas.push({
      path: file.path,
      currentPct: nextMetric.pct,
      baselinePct: prevMetric.pct,
      deltaPct: nextMetric.pct - prevMetric.pct,
    })
  }

  return deltas
}

export function compareCoverage(
  current: CoverageSummary,
  baseline: CoverageSummary,
  baselineFile: string,
): CoverageTrend {
  const lineDeltas = fileDeltas(current.files, baseline.files, (file) => file.lines)
  const branchDeltas = fileDeltas(current.files, baseline.files, (file) => file.branches)
  const notes = [
    `- baseline file: ${relativeArtifact(baselineFile)}`,
    `- baseline created at: ${baseline.meta.createdAt}`,
  ]

  if (baseline.meta.git.branch) notes.push(`- baseline git branch: ${baseline.meta.git.branch}`)
  if (baseline.meta.git.commit) notes.push(`- baseline git commit: ${baseline.meta.git.commit}`)
  if (!current.metrics.branches.available || !baseline.metrics.branches.available) {
    notes.push("- branch coverage: unavailable in the current LCOV reporter output")
  }

  return {
    baselineFile: relativeArtifact(baselineFile),
    notes,
    metrics: {
      lines: delta(current.metrics.lines, baseline.metrics.lines),
      functions: delta(current.metrics.functions, baseline.metrics.functions),
      branches: delta(current.metrics.branches, baseline.metrics.branches),
    },
    files: {
      lineRegressions: lineDeltas
        .filter((item) => item.deltaPct < 0)
        .sort((a, b) => a.deltaPct - b.deltaPct)
        .slice(0, 10),
      lineImprovements: lineDeltas
        .filter((item) => item.deltaPct > 0)
        .sort((a, b) => b.deltaPct - a.deltaPct)
        .slice(0, 10),
      branchRegressions: branchDeltas
        .filter((item) => item.deltaPct < 0)
        .sort((a, b) => a.deltaPct - b.deltaPct)
        .slice(0, 10),
      branchImprovements: branchDeltas
        .filter((item) => item.deltaPct > 0)
        .sort((a, b) => b.deltaPct - a.deltaPct)
        .slice(0, 10),
    },
  }
}

function topLowest(files: CoverageFileSummary[], pick: (file: CoverageFileSummary) => CoverageMetric, limit = 10) {
  return [...files]
    .filter((file) => pick(file).pct !== undefined)
    .sort((a, b) => (pick(a).pct ?? 101) - (pick(b).pct ?? 101) || a.path.localeCompare(b.path))
    .slice(0, limit)
}

function renderDelta(label: string, item: CoverageMetricDelta | undefined) {
  if (!item) return `- ${label}: unavailable`
  const deltaPct = `${item.deltaPct >= 0 ? "+" : ""}${item.deltaPct.toFixed(2)}pp`
  return `- ${label}: ${item.currentPct.toFixed(2)}% vs ${item.baselinePct.toFixed(2)}% (${deltaPct})`
}

function renderFileDelta(item: CoverageFileDelta) {
  const deltaPct = `${item.deltaPct >= 0 ? "+" : ""}${item.deltaPct.toFixed(2)}pp`
  return `- ${item.path}: ${item.currentPct.toFixed(2)}% vs ${item.baselinePct.toFixed(2)}% (${deltaPct})`
}

export function renderCoverageReport(summary: CoverageSummary) {
  const out: string[] = []
  out.push(`## ax-code ${summary.group} coverage`)
  out.push("")
  out.push("Overall:")
  out.push(`- files: ${summary.fileCount}`)
  out.push(
    `- lines: ${coverageLine(summary.metrics.lines.pct)} (${summary.metrics.lines.covered}/${summary.metrics.lines.total})`,
  )
  out.push(
    `- functions: ${coverageLine(summary.metrics.functions.pct)} (${summary.metrics.functions.covered}/${summary.metrics.functions.total})`,
  )
  out.push(
    summary.metrics.branches.available
      ? `- branches: ${coverageLine(summary.metrics.branches.pct)} (${summary.metrics.branches.covered}/${summary.metrics.branches.total})`
      : "- branches: unavailable in Bun LCOV output",
  )
  out.push("")
  out.push("Artifacts:")
  out.push(`- lcov: ${summary.artifacts.lcov}`)
  out.push(`- summary: ${summary.artifacts.summary}`)
  out.push(`- report: ${summary.artifacts.report}`)
  out.push("")
  out.push("Provenance:")
  out.push(`- created at: ${summary.meta.createdAt}`)
  out.push(
    `- runtime: bun ${summary.meta.runtime.bun ?? "unknown"} on ${summary.meta.runtime.platform}/${summary.meta.runtime.arch}`,
  )
  if (summary.meta.git.branch) out.push(`- git branch: ${summary.meta.git.branch}`)
  if (summary.meta.git.commit) out.push(`- git commit: ${summary.meta.git.commit}`)
  if (summary.meta.ci.githubWorkflow) out.push(`- github workflow: ${summary.meta.ci.githubWorkflow}`)
  if (summary.meta.ci.githubRunId) out.push(`- github run: ${summary.meta.ci.githubRunId}`)
  if (summary.meta.ci.githubRef) out.push(`- github ref: ${summary.meta.ci.githubRef}`)
  out.push("")

  if (summary.notes.length > 0) {
    out.push("Notes:")
    out.push(...summary.notes.map((item) => `- ${item}`))
    out.push("")
  }

  if (summary.trend) {
    out.push("Trend:")
    out.push(...summary.trend.notes)
    out.push(renderDelta("lines", summary.trend.metrics.lines))
    out.push(renderDelta("functions", summary.trend.metrics.functions))
    out.push(renderDelta("branches", summary.trend.metrics.branches))
    out.push("")
    if (summary.trend.files.lineRegressions.length > 0) {
      out.push("Top line regressions:")
      out.push(...summary.trend.files.lineRegressions.map(renderFileDelta))
      out.push("")
    }
    if (summary.trend.files.lineImprovements.length > 0) {
      out.push("Top line improvements:")
      out.push(...summary.trend.files.lineImprovements.map(renderFileDelta))
      out.push("")
    }
    if (summary.trend.files.branchRegressions.length > 0) {
      out.push("Top branch regressions:")
      out.push(...summary.trend.files.branchRegressions.map(renderFileDelta))
      out.push("")
    }
    if (summary.trend.files.branchImprovements.length > 0) {
      out.push("Top branch improvements:")
      out.push(...summary.trend.files.branchImprovements.map(renderFileDelta))
      out.push("")
    }
  }

  const lowestLine = topLowest(summary.files, (file) => file.lines)
  if (lowestLine.length > 0) {
    out.push("Lowest line coverage:")
    out.push(
      ...lowestLine.map(
        (file) => `- ${file.path}: ${coverageLine(file.lines.pct)} (${file.lines.covered}/${file.lines.total})`,
      ),
    )
    out.push("")
  }

  if (summary.metrics.branches.available) {
    const lowestBranch = topLowest(summary.files, (file) => file.branches).filter((file) => file.branches.total > 0)
    if (lowestBranch.length > 0) {
      out.push("Lowest branch coverage:")
      out.push(
        ...lowestBranch.map(
          (file) =>
            `- ${file.path}: ${coverageLine(file.branches.pct)} (${file.branches.covered}/${file.branches.total})`,
        ),
      )
      out.push("")
    }
  }

  return out.join("\n")
}

async function git(args: string[]) {
  const proc = Bun.spawn(["git", ...args], {
    cwd: process.cwd(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  })
  const text = await new Response(proc.stdout).text().catch(() => "")
  const code = await proc.exited
  if (code !== 0) return undefined
  return text.trim() || undefined
}

export async function createCoverageSummary(input: {
  group: string
  lcovFile: string
  summaryFile: string
  reportFile: string
  baselineFile?: string
}) {
  const text = await Bun.file(input.lcovFile).text()
  const repoRoot = path.resolve(
    process.env["GITHUB_WORKSPACE"] ?? (await git(["rev-parse", "--show-toplevel"])) ?? process.cwd(),
  )
  const parsedFiles = parseLCOV(text)
  const files = parsedFiles.filter((file) => {
    const resolved = path.resolve(process.cwd(), file.path)
    return resolved === repoRoot || resolved.startsWith(repoRoot + path.sep)
  })
  const notes: string[] = []
  if (files.length !== parsedFiles.length) {
    notes.push(`excluded ${parsedFiles.length - files.length} coverage entries outside the repository root`)
  }
  if (!files.some((file) => file.branches.available)) {
    notes.push("branch coverage is unavailable because the current Bun LCOV reporter did not emit branch counters")
  }

  const summary: CoverageSummary = {
    schemaVersion: 1,
    kind: "ax-code-coverage-summary",
    group: input.group,
    fileCount: files.length,
    metrics: totals(files),
    files,
    artifacts: {
      lcov: relativeArtifact(input.lcovFile),
      summary: relativeArtifact(input.summaryFile),
      report: relativeArtifact(input.reportFile),
    },
    notes,
    meta: {
      createdAt: new Date().toISOString(),
      runtime: {
        bun: Bun.version,
        platform: process.platform,
        arch: process.arch,
      },
      git: {
        branch: process.env["GITHUB_REF_NAME"] ?? (await git(["rev-parse", "--abbrev-ref", "HEAD"])),
        commit: process.env["GITHUB_SHA"] ?? (await git(["rev-parse", "HEAD"])),
      },
      ci: {
        githubWorkflow: process.env["GITHUB_WORKFLOW"],
        githubRunId: process.env["GITHUB_RUN_ID"],
        githubRef: process.env["GITHUB_REF"],
      },
    },
  }

  if (input.baselineFile) {
    const baselineText = await Bun.file(input.baselineFile)
      .text()
      .catch(() => "")
    if (baselineText) {
      const baseline = JSON.parse(baselineText) as CoverageSummary
      if (baseline.kind === "ax-code-coverage-summary" && baseline.group === input.group) {
        summary.trend = compareCoverage(summary, baseline, input.baselineFile)
      } else {
        summary.notes.push(
          `baseline summary at ${relativeArtifact(input.baselineFile)} did not match group ${input.group}`,
        )
      }
    }
  }

  return summary
}

export async function writeCoverageArtifacts(input: {
  group: string
  lcovFile: string
  summaryFile: string
  reportFile: string
  baselineFile?: string
}) {
  const summary = await createCoverageSummary(input)
  const report = renderCoverageReport(summary)
  await fs.mkdir(path.dirname(input.summaryFile), { recursive: true })
  await fs.mkdir(path.dirname(input.reportFile), { recursive: true })
  await Bun.write(input.summaryFile, JSON.stringify(summary, null, 2) + "\n")
  await Bun.write(input.reportFile, report + "\n")
  console.log(report)
  const stepSummary = process.env["GITHUB_STEP_SUMMARY"]
  if (stepSummary) {
    const previous = await Bun.file(stepSummary)
      .text()
      .catch(() => "")
    await Bun.write(stepSummary, `${previous}${report}\n`)
  }
  return summary
}

function arg(name: string) {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return
  const next = process.argv[idx + 1]
  if (!next || next.startsWith("--")) throw new Error(`Missing value for ${name}`)
  return next
}

async function main() {
  const group = arg("--group") ?? "deterministic"
  const lcovFile = arg("--lcov")
  const summaryFile = arg("--summary")
  const reportFile = arg("--report")
  if (!lcovFile || !summaryFile || !reportFile) {
    throw new Error("Provide --lcov <file>, --summary <file>, and --report <file>")
  }
  await writeCoverageArtifacts({
    group,
    lcovFile: path.resolve(process.cwd(), lcovFile),
    summaryFile: path.resolve(process.cwd(), summaryFile),
    reportFile: path.resolve(process.cwd(), reportFile),
    baselineFile: arg("--baseline") ? path.resolve(process.cwd(), arg("--baseline")!) : undefined,
  })
}

if (import.meta.main) {
  await main()
}
