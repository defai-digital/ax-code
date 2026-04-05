import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./dedup_scan.txt"
import { Instance } from "../project/instance"
import { DebugEngine } from "../debug-engine"
import type { CodeNodeKind } from "../code-intelligence/schema.sql"

// Tool wrapper around DebugEngine.detectDuplicates. Read-only, no file
// writes, no cloud calls. See PRD §4.3.1 and ADR-009.

const NODE_KINDS = [
  "function",
  "method",
  "class",
  "interface",
  "type",
  "variable",
  "constant",
  "module",
  "parameter",
  "enum",
] as const satisfies readonly CodeNodeKind[]

const MAX_CLUSTERS_IN_OUTPUT = 25

export const DedupScanTool = Tool.define("dedup_scan", {
  description: DESCRIPTION,
  parameters: z.object({
    kinds: z.array(z.enum(NODE_KINDS)).optional().describe("Node kinds to scan (default: function, method)"),
    minSignatureLength: z.number().int().min(1).optional().describe("Skip signatures shorter than this (default 20)"),
    similarityThreshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Jaccard threshold for near-match clustering (default 0.85)"),
    excludeTests: z.boolean().optional().describe("Skip test files (default true)"),
    maxCandidates: z.number().int().min(10).max(10000).optional().describe("Hard cap on candidate pool (default 2000)"),
  }),
  execute: async (args) => {
    const projectID = Instance.project.id
    const report = await DebugEngine.detectDuplicates(projectID, {
      kinds: args.kinds,
      minSignatureLength: args.minSignatureLength,
      similarityThreshold: args.similarityThreshold,
      excludeTests: args.excludeTests,
      maxCandidates: args.maxCandidates,
      scope: "worktree",
    })

    const lines: string[] = []
    lines.push(`Found ${report.clusters.length} duplicate cluster${report.clusters.length === 1 ? "" : "s"}`)
    lines.push(`Estimated duplicate lines: ${report.totalDuplicateLines}`)
    if (report.truncated) lines.push("Warning: candidate pool was truncated at cap")
    lines.push("")

    const shown = report.clusters.slice(0, MAX_CLUSTERS_IN_OUTPUT)
    for (const cluster of shown) {
      lines.push(`### ${cluster.id} — tier: ${cluster.tier}, similarity: ${cluster.similarityScore.toFixed(2)}`)
      lines.push(`Pattern: \`${cluster.pattern}\``)
      lines.push(`Suggested extraction target: \`${cluster.suggestedExtractionTarget || "(workspace root)"}\``)
      for (const m of cluster.members) {
        lines.push(`- \`${m.qualifiedName}\` (${m.file}:${m.range.start.line + 1})`)
      }
      lines.push("")
    }
    if (report.clusters.length > MAX_CLUSTERS_IN_OUTPUT) {
      lines.push(`… and ${report.clusters.length - MAX_CLUSTERS_IN_OUTPUT} more cluster(s) (see metadata)`)
    }

    return {
      title: `dedup_scan ${report.clusters.length} cluster(s)`,
      output: lines.join("\n"),
      metadata: {
        clusterCount: report.clusters.length,
        totalDuplicateLines: report.totalDuplicateLines,
        truncated: report.truncated,
        report,
      },
    }
  },
})
