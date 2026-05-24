import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./lifecycle_scan.txt"
import { Instance } from "../project/instance"
import { DebugEngine } from "../debug-engine"
import { buildScanToolResult, scanToolCommonDetectInput, SCAN_TOOL_COMMON_PARAMETERS } from "./scan-coverage"

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

export const LifecycleScanTool = Tool.define("lifecycle_scan", {
  description: DESCRIPTION,
  parameters: z.object({
    resourceTypes: z
      .array(z.enum(RESOURCE_TYPES))
      .optional()
      .describe("Which resource types to check (default: all six)"),
    ...SCAN_TOOL_COMMON_PARAMETERS,
  }),
  execute: async (args) => {
    const projectID = Instance.project.id
    const report = await DebugEngine.detectLifecycle(projectID, {
      resourceTypes: args.resourceTypes,
      ...scanToolCommonDetectInput(args),
    })

    return buildScanToolResult({
      toolName: "lifecycle_scan",
      report,
      include: args.include,
      renderFinding: (finding) => [
        `- [${finding.severity}] ${finding.resourceType} (${finding.pattern}) at ${finding.file}:${finding.line}`,
        `  ${finding.description}`,
        ...(finding.cleanupLocation ? [`  expected cleanup: ${finding.cleanupLocation}`] : []),
      ],
    })
  },
})
