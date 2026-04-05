import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./impact_analyze.txt"
import { Instance } from "../project/instance"
import { DebugEngine } from "../debug-engine"
import { CodeNodeID } from "../code-intelligence/id"

// Tool wrapper around DebugEngine.analyzeImpact. Read-only, no file
// writes, no cloud calls. See PRD §4.4 and ADR-008.

const MAX_DEPTH = 6
const MAX_ITEMS_IN_OUTPUT = 30

const changeSchema = z.union([
  z.object({
    kind: z.literal("symbol"),
    id: z.string().describe("CodeNodeID from findSymbol"),
  }),
  z.object({
    kind: z.literal("file"),
    path: z.string().describe("Absolute file path"),
  }),
  z.object({
    kind: z.literal("diff"),
    patch: z.string().describe("Unified diff text"),
  }),
])

export const ImpactAnalyzeTool = Tool.define("impact_analyze", {
  description: DESCRIPTION,
  parameters: z.object({
    changes: z.array(changeSchema).min(1).describe("Change seeds (symbol, file, or diff)"),
    depth: z.number().int().min(1).max(MAX_DEPTH).optional().describe(`BFS depth cap (default 3, max ${MAX_DEPTH})`),
    maxVisited: z
      .number()
      .int()
      .min(10)
      .max(10000)
      .optional()
      .describe("Hard cap on nodes visited (default 2000, max 10000)"),
  }),
  execute: async (args) => {
    const projectID = Instance.project.id

    // Narrow the zod-validated shape to the DebugEngine input type.
    // The `symbol` variant needs CodeNodeID branding; the others pass
    // through unchanged.
    const changes = args.changes.map((c) => {
      if (c.kind === "symbol") return { kind: "symbol" as const, id: CodeNodeID.make(c.id) }
      if (c.kind === "file") return { kind: "file" as const, path: c.path }
      return { kind: "diff" as const, patch: c.patch }
    })

    const report = await DebugEngine.analyzeImpact(projectID, {
      changes,
      depth: args.depth,
      maxVisited: args.maxVisited,
      scope: "worktree",
    })

    const lines: string[] = []
    lines.push(`Seeds: ${report.seeds.length}`)
    lines.push(`Affected symbols: ${report.affectedSymbols.length}`)
    lines.push(`Affected files: ${report.affectedFiles.length}`)
    lines.push(`API boundaries hit: ${report.apiBoundariesHit}`)
    lines.push(`Risk: ${report.riskLabel} (score ${report.riskScore})`)
    if (report.truncated) lines.push("Warning: BFS was truncated — risk label forced to high")
    lines.push("")

    const shown = report.affectedSymbols.slice(0, MAX_ITEMS_IN_OUTPUT)
    for (const entry of shown) {
      lines.push(
        `- [${entry.distance}] ${entry.symbol.qualifiedName} (${entry.symbol.file}:${entry.symbol.range.start.line + 1})`,
      )
    }
    if (report.affectedSymbols.length > MAX_ITEMS_IN_OUTPUT) {
      lines.push(`… and ${report.affectedSymbols.length - MAX_ITEMS_IN_OUTPUT} more (see metadata)`)
    }

    return {
      title: `impact_analyze ${report.riskLabel} risk`,
      output: lines.join("\n"),
      metadata: {
        seedCount: report.seeds.length,
        affectedSymbolCount: report.affectedSymbols.length,
        affectedFileCount: report.affectedFiles.length,
        riskScore: report.riskScore,
        riskLabel: report.riskLabel,
        truncated: report.truncated,
        report,
      },
    }
  },
})
