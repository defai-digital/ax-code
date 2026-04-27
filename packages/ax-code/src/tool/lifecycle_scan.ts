import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./lifecycle_scan.txt"
import { Instance } from "../project/instance"
import { DebugEngine } from "../debug-engine"

// Tool wrapper around DebugEngine.detectLifecycle. Read-only scan,
// no file writes, no cloud calls. See PRD-debug-engine-enhancement §2.2.

const RESOURCE_TYPES = [
  "event_listener",
  "timer",
  "subscription",
  "abort_controller",
  "child_process",
  "map_growth",
] as const
const MAX_FINDINGS_IN_OUTPUT = 40

export const LifecycleScanTool = Tool.define("lifecycle_scan", {
  description: DESCRIPTION,
  parameters: z.object({
    resourceTypes: z
      .array(z.enum(RESOURCE_TYPES))
      .optional()
      .describe("Which resource types to check (default: all six)"),
    excludeTests: z.boolean().optional().describe("Skip test files (default true)"),
    include: z.array(z.string()).optional().describe("Glob patterns to include (default: TS/JS sources)"),
    maxFiles: z.number().int().min(1).max(5000).optional().describe("Max files to scan (default 500)"),
    maxFindingsPerFile: z.number().int().min(1).max(200).optional().describe("Max findings per file (default 20)"),
  }),
  execute: async (args) => {
    const projectID = Instance.project.id
    const report = await DebugEngine.detectLifecycle(projectID, {
      resourceTypes: args.resourceTypes,
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
      lines.push(`- [${f.severity}] ${f.resourceType} (${f.pattern}) at ${f.file}:${f.line}`)
      lines.push(`  ${f.description}`)
      if (f.cleanupLocation) lines.push(`  expected cleanup: ${f.cleanupLocation}`)
    }
    if (report.findings.length > MAX_FINDINGS_IN_OUTPUT) {
      lines.push(`... and ${report.findings.length - MAX_FINDINGS_IN_OUTPUT} more (see metadata)`)
    }

    return {
      title: `lifecycle_scan ${report.findings.length} finding(s)`,
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
