import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./debug_analyze.txt"
import { Instance } from "../project/instance"
import { DebugEngine } from "../debug-engine"
import { CodeNodeID } from "../code-intelligence/id"
import { Session } from "../session"
import { QualityShadow } from "../quality/shadow-runtime"
import { Log } from "../util/log"

// Tool wrapper around DebugEngine.analyzeBug. Audit trail is handled
// automatically by the tool.call / tool.result events the session
// recorder emits — no extra code needed here.
//
// Gated behind AX_CODE_EXPERIMENTAL_DEBUG_ENGINE so it only appears for
// opted-in users while DRE matures. Registration lives in tool/registry.ts.

const MAX_CHAIN_DEPTH = 8
const log = Log.create({ service: "tool.debug_analyze" })

function formatFrame(f: DebugEngine.StackFrame): string {
  const loc = `${f.file}:${f.line}`
  if (f.symbol) {
    return `  [${f.frame}] (${f.role}) ${f.symbol.qualifiedName} @ ${loc}`
  }
  return `  [${f.frame}] (${f.role}) <unresolved> @ ${loc}`
}

export const DebugAnalyzeTool = Tool.define("debug_analyze", {
  description: DESCRIPTION,
  parameters: z.object({
    error: z.string().min(1).describe("The error message or short description of the failure"),
    stackTrace: z.string().optional().describe("Raw stack trace text (V8/Node/Bun format)"),
    entrySymbol: z.string().optional().describe("Alternative seed symbol id (from findSymbol) if no stack trace is available"),
    chainDepth: z
      .number()
      .int()
      .min(1)
      .max(MAX_CHAIN_DEPTH)
      .optional()
      .describe(`How deep to walk the caller chain (default 5, max ${MAX_CHAIN_DEPTH})`),
  }),
  execute: async (args, ctx) => {
    const projectID = Instance.project.id
    const result = await DebugEngine.analyzeBug(projectID, {
      error: args.error,
      stackTrace: args.stackTrace,
      entrySymbol: args.entrySymbol ? CodeNodeID.make(args.entrySymbol) : undefined,
      chainDepth: args.chainDepth,
      scope: "worktree",
    })

    const lines: string[] = []
    lines.push(`Chain (${result.chain.length} frame${result.chain.length === 1 ? "" : "s"}):`)
    if (result.chain.length === 0) {
      lines.push("  (no frames resolved — supply a stack trace or entrySymbol)")
    } else {
      for (const frame of result.chain) lines.push(formatFrame(frame))
    }
    lines.push("")
    lines.push(`Confidence: ${result.confidence.toFixed(2)} (capped at 0.95)`)
    if (result.truncated) lines.push("Warning: caller walk was truncated at chain depth cap")
    lines.push(
      `Heuristics: ${result.explain.heuristicsApplied.join(", ") || "(none)"}`,
    )
    lines.push(`Graph queries consulted: ${result.explain.graphQueries.length}`)

    const metadata = {
      chainLength: result.chain.length,
      resolvedCount: result.chain.filter((f) => f.symbol !== null).length,
      confidence: result.confidence,
      truncated: result.truncated,
      result,
    }

    void Session.get(ctx.sessionID)
      .then((session) => QualityShadow.captureDebugAnalyze({
        session,
        callID: ctx.callID ?? "debug_analyze",
        error: args.error,
        stackTrace: args.stackTrace,
        metadata,
      }))
      .catch((err) => {
        log.warn("quality debug shadow capture failed", { sessionID: ctx.sessionID, err })
      })

    return {
      title: `debug_analyze ${args.error.slice(0, 60)}`,
      output: lines.join("\n"),
      metadata,
    }
  },
})
