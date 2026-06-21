import z from "zod"
import path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./code-intelligence.txt"
import { Instance } from "../project/instance"
import { CodeIntelligence } from "../code-intelligence"
import { GraphContext } from "../code-intelligence/graph-context"
import { CodeNodeID } from "../code-intelligence/id"
import { assertSymlinkInsideProject } from "./external-directory"
import type { CodeNodeKind } from "../code-intelligence/schema.sql"
import { resolveToolFilePath } from "./file-path"
import { ToolBoolean, ToolNumber } from "./schema"

// Semantic Trust v2 §S4: every operation returns an envelope stamped
// with graph provenance (source, timestamp, degraded). The `output`
// text string is preserved for back-compat; AI consumers that inspect
// metadata now see `envelope` alongside the existing typed fields.
// Consumers that want freshness evaluation can call
// LSP.envelopeFreshness on `metadata.envelope`.

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
  "buildContext",
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

function requiredArgError(args: {
  operation: (typeof operations)[number]
  name?: string
  file?: string
  symbolID?: string
  query?: string
}): string | undefined {
  if (args.operation === "findSymbol" && !args.name?.trim()) return "findSymbol requires `name`"
  if (args.operation === "findSymbolByPrefix" && !args.name?.trim()) return "findSymbolByPrefix requires `name`"
  if (args.operation === "symbolsInFile" && !args.file?.trim()) return "symbolsInFile requires `file`"
  if (args.operation === "findReferences" && !args.symbolID?.trim()) return "findReferences requires `symbolID`"
  if (args.operation === "findCallers" && !args.symbolID?.trim()) return "findCallers requires `symbolID`"
  if (args.operation === "findCallees" && !args.symbolID?.trim()) return "findCallees requires `symbolID`"
  if (args.operation === "buildContext" && !args.query?.trim()) return "buildContext requires `query`"
  return undefined
}

export const CodeIntelligenceTool = Tool.define("code_intelligence", {
  description: DESCRIPTION,
  parameters: z.object({
    operation: z.enum(operations).describe("Which Code Intelligence query to run"),
    name: z.string().optional().describe("Symbol name (for findSymbol) or prefix (for findSymbolByPrefix)"),
    file: z.string().optional().describe("Absolute file path (for symbolsInFile)"),
    symbolID: z
      .string()
      .optional()
      .describe("Symbol id from a previous findSymbol call (for findReferences/findCallers/findCallees)"),
    query: z.string().optional().describe("Natural-language task or symbol/topic string (for buildContext)"),
    seeds: z
      .array(
        z.object({
          kind: z.enum(["symbol", "file", "name"]),
          value: z.string(),
        }),
      )
      .optional()
      .describe("Optional graph-context seeds: symbol id, absolute file path, or symbol name"),
    kind: z.enum(NODE_KINDS).optional().describe("Optional kind filter for findSymbol/findSymbolByPrefix"),
    limit: ToolNumber(z.number().int().min(1).max(MAX_RESULTS))
      .optional()
      .describe(`Max results to return (default ${MAX_RESULTS})`),
    maxSymbols: ToolNumber(z.number().int().min(1).max(20))
      .optional()
      .describe("Max selected symbols for buildContext"),
    maxSnippets: ToolNumber(z.number().int().min(0).max(12))
      .optional()
      .describe("Max source snippets for buildContext"),
    maxDepth: ToolNumber(z.number().int().min(1).max(3))
      .optional()
      .describe("Max graph depth for buildContext impact summary"),
    includeImpact: ToolBoolean.optional().describe("Whether buildContext should include a bounded impact summary"),
    freshness: z
      .enum(["preferGraph", "requireFresh", "allowStaleWithWarning"])
      .optional()
      .describe("Freshness policy hint for buildContext"),
  }),
  execute: async (args, ctx) => {
    const preflightError = requiredArgError(args)
    if (preflightError) throw new Error(preflightError)

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
        const envelope = CodeIntelligence.graphEnvelope(projectID, symbols)
        return {
          title: `findSymbol ${args.name}${args.kind ? ` (${args.kind})` : ""}`,
          output: symbols.length === 0 ? `No symbols named "${args.name}"` : symbols.map(formatSymbol).join("\n"),
          metadata: { count: symbols.length, symbols, envelope },
        }
      }
      if (args.operation === "findSymbolByPrefix") {
        if (!args.name) throw new Error("findSymbolByPrefix requires `name`")
        const symbols = CodeIntelligence.findSymbolByPrefix(projectID, args.name, { kind: args.kind, limit, scope })
        const envelope = CodeIntelligence.graphEnvelope(projectID, symbols)
        return {
          title: `findSymbolByPrefix ${args.name}`,
          output: symbols.length === 0 ? `No symbols with prefix "${args.name}"` : symbols.map(formatSymbol).join("\n"),
          metadata: { count: symbols.length, symbols, envelope },
        }
      }
      if (args.operation === "symbolsInFile") {
        if (!args.file) throw new Error("symbolsInFile requires `file`")
        const file = resolveToolFilePath(args.file, Instance.directory)
        if (!Instance.containsPath(file)) {
          throw new Error("symbolsInFile requires a file inside the project")
        }
        await assertSymlinkInsideProject(file)
        const symbols = CodeIntelligence.symbolsInFile(projectID, file, { scope })
        const clipped = symbols.slice(0, limit)
        const envelope = CodeIntelligence.graphEnvelope(projectID, clipped)
        return {
          title: `symbolsInFile ${file}`,
          output: clipped.length === 0 ? `No indexed symbols in ${file}` : clipped.map(formatSymbol).join("\n"),
          metadata: { count: symbols.length, truncated: symbols.length > clipped.length, symbols: clipped, envelope },
        }
      }
      if (args.operation === "findReferences") {
        if (!args.symbolID) throw new Error("findReferences requires `symbolID`")
        const refs = CodeIntelligence.findReferences(projectID, CodeNodeID.make(args.symbolID), { scope })
        const clipped = refs.slice(0, limit)
        const envelope = CodeIntelligence.graphEnvelope(projectID, clipped)
        return {
          title: `findReferences ${args.symbolID}`,
          output: clipped.length === 0 ? `No references found` : clipped.map(formatReference).join("\n"),
          metadata: { count: refs.length, truncated: refs.length > clipped.length, references: clipped, envelope },
        }
      }
      if (args.operation === "findCallers") {
        if (!args.symbolID) throw new Error("findCallers requires `symbolID`")
        const callers = CodeIntelligence.findCallers(projectID, CodeNodeID.make(args.symbolID), { scope })
        const clipped = callers.slice(0, limit)
        const envelope = CodeIntelligence.graphEnvelope(projectID, clipped)
        return {
          title: `findCallers ${args.symbolID}`,
          output: clipped.length === 0 ? `No callers found` : clipped.map(formatCallChainNode).join("\n"),
          metadata: { count: callers.length, truncated: callers.length > clipped.length, callers: clipped, envelope },
        }
      }
      if (args.operation === "findCallees") {
        if (!args.symbolID) throw new Error("findCallees requires `symbolID`")
        const callees = CodeIntelligence.findCallees(projectID, CodeNodeID.make(args.symbolID), { scope })
        const clipped = callees.slice(0, limit)
        const envelope = CodeIntelligence.graphEnvelope(projectID, clipped)
        return {
          title: `findCallees ${args.symbolID}`,
          output: clipped.length === 0 ? `No callees found` : clipped.map(formatCallChainNode).join("\n"),
          metadata: { count: callees.length, truncated: callees.length > clipped.length, callees: clipped, envelope },
        }
      }
      if (args.operation === "buildContext") {
        if (!args.query) throw new Error("buildContext requires `query`")
        const seeds = args.seeds?.map((seed) => {
          if (seed.kind === "file") {
            const file = resolveToolFilePath(seed.value, Instance.directory)
            if (!Instance.containsPath(file)) {
              throw new Error("buildContext file seeds must be inside the project")
            }
            return { kind: seed.kind, value: file }
          }
          return seed
        })
        if (seeds) {
          for (const seed of seeds) {
            if (seed.kind !== "file") continue
            await assertSymlinkInsideProject(seed.value)
          }
        }
        const pack = await GraphContext.build(projectID, {
          query: args.query,
          seeds,
          maxSymbols: args.maxSymbols ?? args.limit,
          maxSnippets: args.maxSnippets,
          maxDepth: args.maxDepth,
          includeImpact: args.includeImpact,
          freshness: args.freshness,
          scope,
        })
        return {
          title: `buildContext ${args.query}`,
          output: pack.output,
          metadata: {
            count: pack.symbols.length,
            symbols: pack.symbols,
            relationships: pack.relationships,
            snippets: pack.snippets,
            frameworkBindings: pack.frameworkBindings,
            heuristicBindings: pack.heuristicBindings,
            impact: pack.impact,
            omitted: pack.omitted,
            recommendations: pack.recommendations,
            envelope: pack.envelope,
          },
        }
      }
      throw new Error(`Unknown operation: ${args.operation}`)
    })()

    return result
  },
})
