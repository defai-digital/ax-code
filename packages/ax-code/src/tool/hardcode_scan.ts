import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./hardcode_scan.txt"
import { Instance } from "../project/instance"
import { DebugEngine } from "../debug-engine"
import { buildScanToolResult, scanToolCommonDetectInput, SCAN_TOOL_COMMON_PARAMETERS } from "./scan-coverage"

// Tool wrapper around DebugEngine.detectHardcodes. Read-only scan,
// no file writes, no cloud calls. See PRD §4.3.2 and ADR-002 / ADR-009.

const PATTERN_KINDS = ["magic_number", "inline_url", "inline_path", "inline_secret_shape"] as const

export const HardcodeScanTool = Tool.define("hardcode_scan", {
  description: DESCRIPTION,
  parameters: z.object({
    patterns: z.array(z.enum(PATTERN_KINDS)).optional().describe("Which detectors to run (default: all four)"),
    ...SCAN_TOOL_COMMON_PARAMETERS,
  }),
  execute: async (args) => {
    const projectID = Instance.project.id
    const report = await DebugEngine.detectHardcodes(projectID, {
      patterns: args.patterns,
      ...scanToolCommonDetectInput(args),
    })

    return buildScanToolResult({
      toolName: "hardcode_scan",
      report,
      include: args.include,
      renderFinding: (finding) => [
        `- [${finding.severity}] ${finding.kind} \`${finding.value}\` at ${finding.file}:${finding.line}:${finding.column}`,
        `  → ${finding.suggestion}`,
      ],
    })
  },
})
