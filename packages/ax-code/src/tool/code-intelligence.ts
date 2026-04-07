import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./code-intelligence.txt"
import { Instance } from "../project/instance"
import { CodeIntelligence } from "../code-intelligence"
import { CodeNodeID } from "../code-intelligence/id"
import type { CodeNodeKind } from "../code-intelligence/schema.sql"

// Tool that exposes the public CodeIntelligence API to agents. Audit
// trail is handled automatically by the tool.call/tool.result events
// the session recorder emits for every tool invocation — we don't
// need to emit anything extra here.
//
// Gated behind AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE so it only
// appears for opted-in users while the graph backend matures.

const operations = [
  "findSymbol",
  "findSymbolByPrefix",
  "symbolsInFile",
  "findReferences",
  "findCallers",
  "findCallees",
] as const

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

// Cap output row counts so we don't flood the model context with a
// thousand near-identical references.
const MAX_RESULTS = 50

function formatSymbol(s: CodeIntelligence.Symbol): string {
  const loc = `${s.file}:${s.range.start.line + 1}:${s.range.start.character + 1}`
  const sig = s.signature ? ` ${s.signature}` : ""
  return `[${s.kind}] ${s.qualifiedName}${sig} (${loc})`
}

function formatReference(r: CodeIntelligence.Reference): string {
  return `${r.sourceFile}:${r.range.start.line + 1}:${r.range.start.character + 1} [${r.edgeKind}]`
}

function formatCallChainNode(n: CodeIntelligence.CallChainNode): string {
  return `${formatSymbol(n.symbol)} (depth=${n.depth})`
}

export const CodeIntelligenceTool = Tool.define("code_intelligence", {
  description: DESCRIPTION,
  parameters: z.object({
    operation: z.enum(operations).describe("Which Code Intelligence query to run"),
    name: z.string().optional().describe("Symbol name (for findSymbol) or prefix (for findSymbolByPrefix)"),
    file: z.string().optional().describe("Absolute file path (for symbolsInFile)"),
    symbolID: z.string().optional().describe("Symbol id from a previous findSymbol call (for findReferences/findCallers/findCallees)"),
    kind: z.enum(NODE_KINDS).optional().describe("Optional kind filter for findSymbol/findSymbolByPrefix"),
    limit: z.number().int().min(1).max(MAX_RESULTS).optional().describe(`Max results to return (default ${MAX_RESULTS})`),
  }),
  execute: async (args, ctx) => {
    await ctx.ask({
      permission: "code_intelligence",
      patterns: [args.operation],
      always: ["*"],
      metadata: {},
    })
    const projectID = Instance.project.id
    const limit = args.limit ?? MAX_RESULTS

    const result: { title: string; output: string; metadata: Record<string, unknown> } = await (async () => {
      // Every query runs with worktree scope so results outside the
      // current working directory are dropped before reaching the model.
      // This is the policy-aware safety boundary for Phase 2.
      const scope = "worktree" as const
      if (args.operation === "findSymbol") {
        if (!args.name) throw new Error("findSymbol requires `name`")
        const symbols = CodeIntelligence.findSymbol(projectID, args.name, { kind: args.kind, limit, scope })
        return {
          title: `findSymbol ${args.name}${args.kind ? ` (${args.kind})` : ""}`,
          output: symbols.length === 0
            ? `No symbols named "${args.name}"`
            : symbols.map(formatSymbol).join("\n"),
          metadata: { count: symbols.length, symbols },
        }
      }
      if (args.operation === "findSymbolByPrefix") {
        if (!args.name) throw new Error("findSymbolByPrefix requires `name`")
        const symbols = CodeIntelligence.findSymbolByPrefix(projectID, args.name, { kind: args.kind, limit, scope })
        return {
          title: `findSymbolByPrefix ${args.name}`,
          output: symbols.length === 0
            ? `No symbols with prefix "${args.name}"`
            : symbols.map(formatSymbol).join("\n"),
          metadata: { count: symbols.length, symbols },
        }
      }
      if (args.operation === "symbolsInFile") {
        if (!args.file) throw new Error("symbolsInFile requires `file`")
        const symbols = CodeIntelligence.symbolsInFile(projectID, args.file, { scope })
        const clipped = symbols.slice(0, limit)
        return {
          title: `symbolsInFile ${args.file}`,
          output: clipped.length === 0
            ? `No indexed symbols in ${args.file}`
            : clipped.map(formatSymbol).join("\n"),
          metadata: { count: symbols.length, truncated: symbols.length > clipped.length, symbols: clipped },
        }
      }
      if (args.operation === "findReferences") {
        if (!args.symbolID) throw new Error("findReferences requires `symbolID`")
        const refs = CodeIntelligence.findReferences(projectID, CodeNodeID.make(args.symbolID), { scope })
        const clipped = refs.slice(0, limit)
        return {
          title: `findReferences ${args.symbolID}`,
          output: clipped.length === 0
            ? `No references found`
            : clipped.map(formatReference).join("\n"),
          metadata: { count: refs.length, truncated: refs.length > clipped.length, references: clipped },
        }
      }
      if (args.operation === "findCallers") {
        if (!args.symbolID) throw new Error("findCallers requires `symbolID`")
        const callers = CodeIntelligence.findCallers(projectID, CodeNodeID.make(args.symbolID), { scope })
        const clipped = callers.slice(0, limit)
        return {
          title: `findCallers ${args.symbolID}`,
          output: clipped.length === 0
            ? `No callers found`
            : clipped.map(formatCallChainNode).join("\n"),
          metadata: { count: callers.length, truncated: callers.length > clipped.length, callers: clipped },
        }
      }
      if (args.operation === "findCallees") {
        if (!args.symbolID) throw new Error("findCallees requires `symbolID`")
        const callees = CodeIntelligence.findCallees(projectID, CodeNodeID.make(args.symbolID), { scope })
        const clipped = callees.slice(0, limit)
        return {
          title: `findCallees ${args.symbolID}`,
          output: clipped.length === 0
            ? `No callees found`
            : clipped.map(formatCallChainNode).join("\n"),
          metadata: { count: callees.length, truncated: callees.length > clipped.length, callees: clipped },
        }
      }
      throw new Error(`Unknown operation: ${args.operation}`)
    })()

    return result
  },
})
