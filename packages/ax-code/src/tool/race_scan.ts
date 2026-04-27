import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./race_scan.txt"
import { Instance } from "../project/instance"
import { DebugEngine } from "../debug-engine"

// Tool wrapper around DebugEngine.detectRaces. Read-only scan,
// no file writes, no cloud calls. See PRD-debug-engine-enhancement §2.1.

const PATTERN_KINDS = ["toctou", "non_atomic_counter", "conflicting_mutation", "stale_listener"] as const
const MAX_FINDINGS_IN_OUTPUT = 40

export const RaceScanTool = Tool.define("race_scan", {
  description: DESCRIPTION,
  parameters: z.object({
    patterns: z.array(z.enum(PATTERN_KINDS)).optional().describe("Which detectors to run (default: all four)"),
    excludeTests: z.boolean().optional().describe("Skip test files (default true)"),
    include: z.array(z.string()).optional().describe("Glob patterns to include (default: TS/JS sources)"),
    maxFiles: z.number().int().min(1).max(5000).optional().describe("Max files to scan (default 500)"),
    maxFindingsPerFile: z.number().int().min(1).max(200).optional().describe("Max findings per file (default 20)"),
  }),
  execute: async (args) => {
    const projectID = Instance.project.id
    const report = await DebugEngine.detectRaces(projectID, {
      patterns: args.patterns,
      excludeTests: args.excludeTests,
      include: args.include,
      maxFiles: args.maxFiles,
      maxFindingsPerFile: args.maxFindingsPerFile,
      scope: "worktree",
    })

    const lines: string[] = []
    lines.push(`Scanned ${report.filesScanned} file${report.filesScanned === 1 ? "" : "s"}`)
    lines.push(`Findings: ${report.findings.length}`)
    if (report.truncated) lines.push("Warning: file cap was hit — results are partial")
    lines.push("")

    const shown = report.findings.slice(0, MAX_FINDINGS_IN_OUTPUT)
    for (const f of shown) {
      lines.push(`- [${f.severity}] ${f.pattern} at ${f.file}:${f.line}${f.endLine ? `-${f.endLine}` : ""}`)
      lines.push(`  ${f.description}`)
      lines.push(`  fix: ${f.fix}`)
    }
    if (report.findings.length > MAX_FINDINGS_IN_OUTPUT) {
      lines.push(`... and ${report.findings.length - MAX_FINDINGS_IN_OUTPUT} more (see metadata)`)
    }

    return {
      title: `race_scan ${report.findings.length} finding(s)`,
      output: lines.join("\n"),
      metadata: {
        filesScanned: report.filesScanned,
        findingCount: report.findings.length,
        truncated: report.truncated,
        report,
      },
    }
  },
})
