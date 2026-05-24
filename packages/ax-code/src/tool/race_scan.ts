import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./race_scan.txt"
import { Instance } from "../project/instance"
import { DebugEngine } from "../debug-engine"
import { buildScanToolResult, scanToolCommonDetectInput, SCAN_TOOL_COMMON_PARAMETERS } from "./scan-coverage"

// Tool wrapper around DebugEngine.detectRaces. Read-only scan,
// no file writes, no cloud calls. See PRD-debug-engine-enhancement §2.1.

const PATTERN_KINDS = ["toctou", "non_atomic_counter", "conflicting_mutation", "stale_listener"] as const

export const RaceScanTool = Tool.define("race_scan", {
  description: DESCRIPTION,
  parameters: z.object({
    patterns: z.array(z.enum(PATTERN_KINDS)).optional().describe("Which detectors to run (default: all four)"),
    ...SCAN_TOOL_COMMON_PARAMETERS,
  }),
  execute: async (args) => {
    const projectID = Instance.project.id
    const report = await DebugEngine.detectRaces(projectID, {
      patterns: args.patterns,
      ...scanToolCommonDetectInput(args),
    })

    return buildScanToolResult({
      toolName: "race_scan",
      report,
      include: args.include,
      renderFinding: (finding) => [
        `- [${finding.severity}] ${finding.pattern} at ${finding.file}:${finding.line}${finding.endLine ? `-${finding.endLine}` : ""}`,
        `  ${finding.description}`,
        `  fix: ${finding.fix}`,
      ],
    })
  },
})
