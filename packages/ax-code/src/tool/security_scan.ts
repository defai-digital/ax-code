import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./security_scan.txt"
import { Instance } from "../project/instance"
import { DebugEngine } from "../debug-engine"
import { buildScanToolResult, scanToolCommonDetectInput, SCAN_TOOL_COMMON_PARAMETERS } from "./scan-coverage"

// Tool wrapper around DebugEngine.detectSecurity. Read-only scan,
// no file writes, no cloud calls. See PRD-debug-engine-enhancement §2.4.

const PATTERN_KINDS = ["path_traversal", "command_injection", "ssrf", "missing_validation", "env_leak"] as const

export const SecurityScanTool = Tool.define("security_scan", {
  description: DESCRIPTION,
  parameters: z.object({
    patterns: z.array(z.enum(PATTERN_KINDS)).optional().describe("Which detectors to run (default: all five)"),
    ...SCAN_TOOL_COMMON_PARAMETERS,
  }),
  execute: async (args) => {
    const projectID = Instance.project.id
    const report = await DebugEngine.detectSecurity(projectID, {
      patterns: args.patterns,
      ...scanToolCommonDetectInput(args),
    })

    return buildScanToolResult({
      toolName: "security_scan",
      report,
      include: args.include,
      renderFinding: (finding) => [
        `- [${finding.severity}] ${finding.pattern} at ${finding.file}:${finding.line}${finding.userControlled ? " (user-controlled)" : ""}`,
        `  ${finding.description}`,
      ],
    })
  },
})
