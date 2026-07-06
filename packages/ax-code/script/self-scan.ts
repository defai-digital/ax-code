import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import type { DebugEngine as DebugEngineTypes } from "../src/debug-engine"
import "./register-node"

const { Instance } = await import("../src/project/instance")
const { DebugEngine } = await import("../src/debug-engine")

type ScannerName = "race_scan" | "lifecycle_scan" | "security_scan" | "hardcode_scan"
type Severity = "high" | "medium" | "low"

type BaselineEntry = {
  fingerprint: string
  file: string
  line: number
  endLine?: number
  severity: Severity
  kind: string
  summary: string
}

type BaselineScanner = {
  count: number
  findings: BaselineEntry[]
}

type BaselineFile = {
  version: 1
  scope: string
  scanners: Partial<Record<ScannerName, BaselineScanner>>
}

type NormalizedFinding = BaselineEntry & {
  scanner: ScannerName
}

type ScanResult = {
  scanner: ScannerName
  filesScanned: number
  truncated: boolean
  findings: NormalizedFinding[]
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(packageDir, "../..")
const defaultBaselinePath = path.join(scriptDir, "self-scan-baseline.json")
const sourceScope = "packages/ax-code/src"
const sourceGlobs = ["src/**/*.ts", "src/**/*.tsx", "src/**/*.js", "src/**/*.jsx", "src/**/*.mjs", "src/**/*.cjs"]

const scannerOrder: ScannerName[] = ["race_scan", "lifecycle_scan", "security_scan", "hardcode_scan"]

const severityRank: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

function usage() {
  return [
    "Usage: pnpm run check:self-scan -- [options]",
    "",
    "Options:",
    "  --baseline <path>       Baseline JSON path, relative to repo root by default",
    "  --report <path>         Write a markdown report, relative to repo root by default",
    "  --update-baseline       Replace the baseline with current findings",
    "  --help                  Show this help",
  ].join("\n")
}

function readOption(args: string[], name: string): string | undefined {
  const prefix = `${name}=`
  const inline = args.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)

  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

function resolveRepoPath(input: string | undefined, fallback: string) {
  if (!input) return fallback
  return path.isAbsolute(input) ? input : path.resolve(repoRoot, input)
}

function hasFlag(args: string[], name: string) {
  return args.includes(name)
}

function normalizeFile(file: string) {
  const absolute = path.isAbsolute(file) ? file : path.resolve(packageDir, file)
  return path.relative(packageDir, absolute).replace(/\\/g, "/")
}

function fingerprint(parts: string[]) {
  const hash = createHash("sha256")
  for (const part of parts) {
    hash.update(part)
    hash.update("\0")
  }
  return hash.digest("hex")
}

function normalizeWhitespace(value: string | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim()
}

function normalizeRaceFinding(finding: DebugEngineTypes.RaceFinding): NormalizedFinding {
  const file = normalizeFile(finding.file)
  const kind = finding.pattern
  return {
    scanner: "race_scan",
    fingerprint: fingerprint([
      "race_scan",
      file,
      String(finding.line),
      String(finding.endLine ?? ""),
      finding.severity,
      finding.pattern,
      normalizeWhitespace(finding.code),
    ]),
    file,
    line: finding.line,
    endLine: finding.endLine,
    severity: finding.severity,
    kind,
    summary: kind,
  }
}

function normalizeLifecycleFinding(finding: DebugEngineTypes.LifecycleFinding): NormalizedFinding {
  const file = normalizeFile(finding.file)
  const kind = `${finding.resourceType}:${finding.pattern}`
  return {
    scanner: "lifecycle_scan",
    fingerprint: fingerprint([
      "lifecycle_scan",
      file,
      String(finding.line),
      finding.severity,
      finding.resourceType,
      finding.pattern,
      normalizeWhitespace(finding.cleanupLocation ?? ""),
    ]),
    file,
    line: finding.line,
    severity: finding.severity,
    kind,
    summary: kind,
  }
}

function normalizeSecurityFinding(finding: DebugEngineTypes.SecurityFinding): NormalizedFinding {
  const file = normalizeFile(finding.file)
  const kind = finding.pattern
  return {
    scanner: "security_scan",
    fingerprint: fingerprint([
      "security_scan",
      file,
      String(finding.line),
      finding.severity,
      finding.pattern,
      finding.userControlled ? "user-controlled" : "not-user-controlled",
    ]),
    file,
    line: finding.line,
    severity: finding.severity,
    kind,
    summary: `${kind}${finding.userControlled ? " user-controlled" : ""}`,
  }
}

function normalizeHardcodeFinding(finding: DebugEngineTypes.HardcodeFinding): NormalizedFinding {
  const file = normalizeFile(finding.file)
  const kind = finding.kind
  return {
    scanner: "hardcode_scan",
    fingerprint: fingerprint([
      "hardcode_scan",
      file,
      String(finding.line),
      String(finding.column),
      finding.severity,
      finding.kind,
      finding.value,
    ]),
    file,
    line: finding.line,
    severity: finding.severity,
    kind,
    summary: kind,
  }
}

function sortFindings<T extends BaselineEntry | NormalizedFinding>(findings: T[]) {
  return findings.sort((a, b) => {
    if (severityRank[a.severity] !== severityRank[b.severity])
      return severityRank[a.severity] - severityRank[b.severity]
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    if (a.line !== b.line) return a.line - b.line
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
    return a.fingerprint.localeCompare(b.fingerprint)
  })
}

function baselineFromResults(results: ScanResult[]): BaselineFile {
  const scanners: Partial<Record<ScannerName, BaselineScanner>> = {}
  for (const result of results) {
    const findings = sortFindings(
      result.findings.map(({ scanner: _scanner, ...finding }) => ({
        ...finding,
      })),
    )
    scanners[result.scanner] = {
      count: findings.length,
      findings,
    }
  }
  return {
    version: 1,
    scope: sourceScope,
    scanners,
  }
}

async function readBaseline(file: string): Promise<BaselineFile> {
  const text = await fs.readFile(file, "utf8")
  const parsed = JSON.parse(text) as BaselineFile
  if (parsed.version !== 1 || typeof parsed.scanners !== "object" || parsed.scanners === null) {
    throw new Error(`Unsupported self-scan baseline format: ${file}`)
  }
  return parsed
}

async function writeBaseline(file: string, baseline: BaselineFile) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(baseline, null, 2)}\n`)
}

function baselineFingerprints(baseline: BaselineFile) {
  const out = new Map<ScannerName, Set<string>>()
  for (const scanner of scannerOrder) {
    out.set(scanner, new Set((baseline.scanners[scanner]?.findings ?? []).map((finding) => finding.fingerprint)))
  }
  return out
}

function currentFingerprints(results: ScanResult[]) {
  const out = new Map<ScannerName, Set<string>>()
  for (const result of results) {
    out.set(result.scanner, new Set(result.findings.map((finding) => finding.fingerprint)))
  }
  return out
}

function findNewFindings(results: ScanResult[], baseline: BaselineFile) {
  const baselineByScanner = baselineFingerprints(baseline)
  return results.flatMap((result) => {
    const accepted = baselineByScanner.get(result.scanner) ?? new Set<string>()
    return result.findings.filter((finding) => !accepted.has(finding.fingerprint))
  })
}

function findStaleBaselineEntries(results: ScanResult[], baseline: BaselineFile) {
  const currentByScanner = currentFingerprints(results)
  const stale: NormalizedFinding[] = []
  for (const scanner of scannerOrder) {
    const current = currentByScanner.get(scanner) ?? new Set<string>()
    for (const finding of baseline.scanners[scanner]?.findings ?? []) {
      if (!current.has(finding.fingerprint)) stale.push({ scanner, ...finding })
    }
  }
  return sortFindings(stale)
}

function findingLocation(finding: BaselineEntry) {
  return `${finding.file}:${finding.line}${finding.endLine ? `-${finding.endLine}` : ""}`
}

function renderFinding(finding: NormalizedFinding) {
  return `- [${finding.severity}] ${finding.scanner} ${finding.kind} at ${findingLocation(finding)} (${finding.fingerprint.slice(0, 12)})`
}

function renderReport(input: {
  results: ScanResult[]
  baselinePath: string
  newFindings: NormalizedFinding[]
  staleFindings: NormalizedFinding[]
  truncated: ScanResult[]
  status: "pass" | "fail" | "updated"
}) {
  const lines: string[] = []
  lines.push("# AX Code Self-Scan Report")
  lines.push("")
  lines.push(`- status: ${input.status}`)
  lines.push(`- generated: ${new Date().toISOString()}`)
  lines.push(`- scope: ${sourceScope}`)
  lines.push(`- baseline: ${path.relative(repoRoot, input.baselinePath).replace(/\\/g, "/")}`)
  lines.push("")
  lines.push("| Scanner | Files | Findings | New | Truncated |")
  lines.push("| --- | ---: | ---: | ---: | --- |")
  for (const result of input.results) {
    const newCount = input.newFindings.filter((finding) => finding.scanner === result.scanner).length
    lines.push(
      `| ${result.scanner} | ${result.filesScanned} | ${result.findings.length} | ${newCount} | ${result.truncated ? "yes" : "no"} |`,
    )
  }

  if (input.truncated.length > 0) {
    lines.push("")
    lines.push("## Truncated Scans")
    lines.push("")
    for (const result of input.truncated) lines.push(`- ${result.scanner} hit its file cap`)
  }

  if (input.newFindings.length > 0) {
    lines.push("")
    lines.push("## New Findings")
    lines.push("")
    for (const finding of sortFindings([...input.newFindings]).slice(0, 100)) lines.push(renderFinding(finding))
    if (input.newFindings.length > 100) lines.push(`- ... and ${input.newFindings.length - 100} more`)
  }

  if (input.staleFindings.length > 0) {
    lines.push("")
    lines.push("## Stale Baseline Entries")
    lines.push("")
    lines.push("These accepted findings were not seen in the current scan. Run with `--update-baseline` after review.")
    lines.push("")
    for (const finding of input.staleFindings.slice(0, 50)) lines.push(renderFinding(finding))
    if (input.staleFindings.length > 50) lines.push(`- ... and ${input.staleFindings.length - 50} more`)
  }

  lines.push("")
  return lines.join("\n")
}

async function writeReport(file: string | undefined, content: string) {
  if (!file) return
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

async function runScans(): Promise<ScanResult[]> {
  const commonInput = {
    include: sourceGlobs,
    excludeTests: true,
    maxFiles: 5000,
    maxFindingsPerFile: 50,
    scope: "worktree" as const,
  }

  return Instance.provide({
    directory: packageDir,
    fn: async () => {
      const projectID = Instance.project.id
      const results: ScanResult[] = []

      const race = await DebugEngine.detectRaces(projectID, commonInput)
      results.push({
        scanner: "race_scan",
        filesScanned: race.filesScanned,
        truncated: race.truncated,
        findings: sortFindings(race.findings.map(normalizeRaceFinding)),
      })

      const lifecycle = await DebugEngine.detectLifecycle(projectID, commonInput)
      results.push({
        scanner: "lifecycle_scan",
        filesScanned: lifecycle.filesScanned,
        truncated: lifecycle.truncated,
        findings: sortFindings(lifecycle.findings.map(normalizeLifecycleFinding)),
      })

      const security = await DebugEngine.detectSecurity(projectID, commonInput)
      results.push({
        scanner: "security_scan",
        filesScanned: security.filesScanned,
        truncated: security.truncated,
        findings: sortFindings(security.findings.map(normalizeSecurityFinding)),
      })

      const hardcodes = await DebugEngine.detectHardcodes(projectID, {
        ...commonInput,
        patterns: ["inline_url", "inline_path", "inline_secret_shape"],
      })
      results.push({
        scanner: "hardcode_scan",
        filesScanned: hardcodes.filesScanned,
        truncated: hardcodes.truncated,
        findings: sortFindings(hardcodes.findings.map(normalizeHardcodeFinding)),
      })

      return results
    },
  })
}

async function main() {
  const args = process.argv.slice(2)
  if (hasFlag(args, "--help")) {
    console.log(usage())
    return
  }

  const baselinePath = resolveRepoPath(readOption(args, "--baseline"), defaultBaselinePath)
  const reportPath = readOption(args, "--report")
  const resolvedReportPath = reportPath ? resolveRepoPath(reportPath, reportPath) : undefined
  const updateBaseline = hasFlag(args, "--update-baseline")

  const results = await runScans()
  const truncated = results.filter((result) => result.truncated)
  if (truncated.length > 0) {
    const report = renderReport({
      results,
      baselinePath,
      newFindings: [],
      staleFindings: [],
      truncated,
      status: "fail",
    })
    await writeReport(resolvedReportPath, report)
    console.error(report)
    process.exit(1)
  }

  if (updateBaseline) {
    await writeBaseline(baselinePath, baselineFromResults(results))
    const report = renderReport({
      results,
      baselinePath,
      newFindings: [],
      staleFindings: [],
      truncated: [],
      status: "updated",
    })
    await writeReport(resolvedReportPath, report)
    console.log(report)
    return
  }

  let baseline: BaselineFile
  try {
    baseline = await readBaseline(baselinePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Unable to read self-scan baseline: ${message}`)
    console.error("Run `pnpm run check:self-scan -- --update-baseline` after reviewing current findings.")
    process.exit(1)
  }

  const newFindings = sortFindings(findNewFindings(results, baseline))
  const staleFindings = findStaleBaselineEntries(results, baseline)
  const report = renderReport({
    results,
    baselinePath,
    newFindings,
    staleFindings,
    truncated: [],
    status: newFindings.length > 0 ? "fail" : "pass",
  })
  await writeReport(resolvedReportPath, report)

  if (newFindings.length > 0) {
    console.error(report)
    console.error("New self-scan findings must be fixed or explicitly accepted with `--update-baseline`.")
    process.exit(1)
  }

  console.log(report)
}

await main()
