import z from "zod"
import { Tool } from "./tool"
import path from "path"
import { LSP } from "../lsp"
import DESCRIPTION from "./lsp.txt"
import { Instance } from "../project/instance"
import { pathToFileURL } from "url"
import { assertExternalDirectory, assertSymlinkInsideProject } from "./external-directory"
import { Filesystem } from "../util/filesystem"
import { AuditSemanticCall } from "../audit/semantic-call"
import type { LSPServer } from "../lsp/server"

// Synthesize a minimal envelope for operations that don't yet have an
// envelope-returning LSP variant. Lets us audit every tool call
// uniformly until S1 is extended to cover the remaining operations.
function syntheticEnvelope(data: unknown[]): {
  data: unknown[]
  source: "lsp"
  completeness: "full" | "empty"
  timestamp: number
  serverIDs: string[]
} {
  return {
    data,
    source: "lsp",
    completeness: data.length === 0 ? "empty" : "full",
    timestamp: Date.now(),
    serverIDs: [],
  }
}

const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "diagnosticsAggregated",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const

const semanticMethodByOperation: Record<
  Exclude<(typeof operations)[number], "workspaceSymbol" | "diagnosticsAggregated">,
  LSPServer.Method
> = {
  goToDefinition: "definition",
  findReferences: "references",
  hover: "hover",
  documentSymbol: "documentSymbol",
  goToImplementation: "implementation",
  prepareCallHierarchy: "callHierarchy",
  incomingCalls: "callHierarchy",
  outgoingCalls: "callHierarchy",
}

async function cacheableEnvelope(input: {
  operation: Exclude<(typeof operations)[number], "workspaceSymbol" | "diagnosticsAggregated">
  uri: string
  position: { file: string; line: number; character: number }
}) {
  if (input.operation === "findReferences") {
    return LSP.referencesCachedEnvelope(input.position)
  }
  if (input.operation === "documentSymbol") {
    return LSP.documentSymbolCachedEnvelope(input.uri)
  }
  return undefined
}

export const LspTool = Tool.define("lsp", {
  description: DESCRIPTION,
  parameters: z.object({
    operation: z.enum(operations).describe("The LSP operation to perform"),
    query: z.string().optional().describe("Search query for workspaceSymbol"),
    filePath: z.string().optional().describe("The absolute or relative path to the file"),
    line: z.number().int().min(1).optional().describe("The line number (1-based, as shown in editors)"),
    character: z.number().int().min(1).optional().describe("The character offset (1-based, as shown in editors)"),
  }),
  execute: async (args, ctx) => {
    if (args.filePath?.includes("\x00")) throw new Error("File path contains null byte")

    // Audit helper bound to this tool invocation. On success or
    // failure we write one row — audit is load-bearing, not opt-in.
    // In queue mode this is ~zero-cost (array push). In sync mode
    // the caller absorbs the DB write latency.
    const audit = (input: { operation: string; args: unknown; envelope: unknown; errorCode?: string }) => {
      try {
        AuditSemanticCall.record({
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          tool: "lsp",
          operation: input.operation,
          args: input.args,
          envelope: input.envelope,
          errorCode: input.errorCode,
        })
      } catch (err) {
        // Audit write failure must not break the tool call. Queue
        // mode's flush errors are logged at the writer level; this
        // try/catch only fires if sync mode's insert rejects.
        // Caller still gets the real result.
      }
    }
    if (args.operation === "workspaceSymbol") {
      if (!args.query?.trim()) {
        audit({
          operation: "workspaceSymbol",
          args,
          envelope: { data: [], source: "lsp", completeness: "empty", timestamp: Date.now(), serverIDs: [] },
          errorCode: "MissingQuery",
        })
        throw new Error("workspaceSymbol requires `query`")
      }

      await ctx.ask({
        permission: "lsp",
        patterns: ["*"],
        always: ["*"],
        metadata: {},
      })

      let envelope: Awaited<ReturnType<typeof LSP.workspaceSymbolEnvelope>>
      try {
        envelope = await LSP.workspaceSymbolEnvelope(args.query)
      } catch (err) {
        // Audit is load-bearing (PRD §S3): one row per execution,
        // success or failure. LSP-layer exceptions (server crash,
        // protocol-level error) must surface in the audit trail as
        // errored calls, not go missing.
        audit({
          operation: "workspaceSymbol",
          args,
          envelope: {
            symbols: [],
            source: "lsp",
            completeness: "empty",
            timestamp: Date.now(),
            serverIDs: [],
          },
          errorCode: err instanceof Error ? err.name : "UnknownError",
        })
        throw err
      }
      audit({ operation: "workspaceSymbol", args, envelope })

      // AI consumers read the envelope shape. We stringify the full envelope
      // (not just `symbols`) so provenance is visible in tool output.
      const output =
        envelope.symbols.length === 0
          ? `No results found for workspaceSymbol (completeness=${envelope.completeness})`
          : JSON.stringify(envelope, null, 2)

      const metadata: Record<string, unknown> = { envelope }
      return {
        title: `workspaceSymbol ${args.query}`,
        metadata,
        output,
      }
    }

    if (args.operation === "diagnosticsAggregated") {
      let file: string | undefined
      if (args.filePath) {
        file = path.isAbsolute(args.filePath) ? args.filePath : path.join(Instance.directory, args.filePath)
        await assertExternalDirectory(ctx, file)
        await assertSymlinkInsideProject(file)
        const exists = await Filesystem.exists(file)
        if (!exists) {
          audit({ operation: args.operation, args, envelope: syntheticEnvelope([]), errorCode: "FileNotFound" })
          throw new Error(`File not found: ${file}`)
        }

        const available = await LSP.hasClients(file)
        if (!available) {
          audit({ operation: args.operation, args, envelope: syntheticEnvelope([]), errorCode: "NoServerAvailable" })
          throw new Error("No LSP server available for this file type.")
        }
      }

      await ctx.ask({
        permission: "lsp",
        patterns: ["*"],
        always: ["*"],
        metadata: {},
      })

      if (file) {
        const opened = await LSP.touchFile(file, true)
        if (opened === 0) {
          audit({ operation: args.operation, args, envelope: syntheticEnvelope([]), errorCode: "ServerStartFailed" })
          throw new Error("LSP server matched this file type but could not be started or did not accept the file.")
        }
      }

      let envelope: Awaited<ReturnType<typeof LSP.diagnosticsAggregated>>
      try {
        envelope = await LSP.diagnosticsAggregated(file)
      } catch (err) {
        audit({
          operation: "diagnosticsAggregated",
          args,
          envelope: syntheticEnvelope([]),
          errorCode: err instanceof Error ? err.name : "UnknownError",
        })
        throw err
      }
      audit({ operation: "diagnosticsAggregated", args, envelope })
      const output =
        envelope.data.length === 0
          ? `No aggregated diagnostics found${file ? ` for ${path.relative(Instance.worktree, file)}` : ""}`
          : JSON.stringify(envelope, null, 2)
      return {
        title: file ? `diagnosticsAggregated ${path.relative(Instance.worktree, file)}` : "diagnosticsAggregated",
        metadata: { envelope },
        output,
      }
    }

    if (!args.filePath) {
      audit({
        operation: args.operation,
        args,
        envelope: syntheticEnvelope([]),
        errorCode: "MissingFilePath",
      })
      throw new Error(`${args.operation} requires \`filePath\``)
    }
    if (args.line === undefined) {
      audit({ operation: args.operation, args, envelope: syntheticEnvelope([]), errorCode: "MissingLine" })
      throw new Error(`${args.operation} requires \`line\``)
    }
    if (args.character === undefined) {
      audit({ operation: args.operation, args, envelope: syntheticEnvelope([]), errorCode: "MissingCharacter" })
      throw new Error(`${args.operation} requires \`character\``)
    }

    const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(Instance.directory, args.filePath)
    await assertExternalDirectory(ctx, file)
    await assertSymlinkInsideProject(file)

    // Validate BEFORE asking permission. Previously the user saw a
    // "Grant LSP access?" prompt for non-existent files or files with
    // no matching LSP server, approved, then immediately got a
    // "File not found" or "No LSP server available" error. Checking
    // prerequisites first means only real, actionable calls surface
    // a permission prompt.
    const exists = await Filesystem.exists(file)
    if (!exists) {
      audit({ operation: args.operation, args, envelope: syntheticEnvelope([]), errorCode: "FileNotFound" })
      throw new Error(`File not found: ${file}`)
    }

    const uri = pathToFileURL(file).href
    const position = {
      file,
      line: args.line - 1,
      character: args.character - 1,
    }

    const relPath = path.relative(Instance.worktree, file)
    const title = `${args.operation} ${relPath}:${args.line}:${args.character}`

    const method = semanticMethodByOperation[args.operation]
    // Best practice for content-addressed semantic ops: probe the cache before
    // treating "no live server available" as fatal. A valid cache hit remains
    // correct for the current file content even if the backing server is not
    // installed or is temporarily unavailable.
    let envelope: unknown
    try {
      envelope = await cacheableEnvelope({
        operation: args.operation,
        uri,
        position,
      })
    } catch {
      // Cache lookup is an optimization only. Fall back to the live LSP path
      // if the cache layer is unavailable or a cache probe throws.
      envelope = undefined
    }

    if (!envelope) {
      const available = await LSP.hasClients(file, { mode: "semantic", method })
      if (!available) {
        audit({ operation: args.operation, args, envelope: syntheticEnvelope([]), errorCode: "NoServerAvailable" })
        throw new Error("No LSP server available for this file type.")
      }
    }

    await ctx.ask({
      permission: "lsp",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    if (!envelope) {
      const opened = await LSP.touchFile(file, true, { mode: "semantic", method })
      if (opened === 0) {
        audit({ operation: args.operation, args, envelope: syntheticEnvelope([]), errorCode: "ServerStartFailed" })
        throw new Error("LSP server matched this file type but could not be started or did not accept the file.")
      }
    }

    // For operations with an envelope-returning LSP variant, use it
    // so we audit real provenance. For the rest, wrap the bare
    // result in a synthetic envelope — honest about the gap; future
    // work extends S1 to cover them.
    //
    // Audit is load-bearing (PRD §S3): LSP-layer exceptions must
    // surface in the audit trail as errored calls, not go missing.
    if (!envelope) {
      try {
        envelope = await (async () => {
          switch (args.operation) {
            case "goToDefinition":
              return LSP.definitionEnvelope(position)
            case "findReferences":
              return LSP.referencesEnvelope({ ...position, cache: true })
            case "hover":
              return LSP.hoverEnvelope(position)
            case "documentSymbol":
              return LSP.documentSymbolEnvelope(uri, { cache: true })
            case "goToImplementation":
              return LSP.implementationEnvelope(position)
            case "prepareCallHierarchy":
              return LSP.prepareCallHierarchyEnvelope(position)
            case "incomingCalls":
              return LSP.incomingCallsEnvelope(position)
            case "outgoingCalls":
              return LSP.outgoingCallsEnvelope(position)
            default:
              return syntheticEnvelope([])
          }
        })()
      } catch (err) {
        audit({
          operation: args.operation,
          args,
          envelope: syntheticEnvelope([]),
          errorCode: err instanceof Error ? err.name : "UnknownError",
        })
        throw err
      }
    }

    audit({ operation: args.operation, args, envelope })

    // Unwrap the envelope's data for the tool output shape (bare
    // array). Existing AI consumers of the file-ops path still see
    // the same shape they did before S3.
    const result: unknown[] = ((envelope as { data: unknown[] }).data ?? []) as unknown[]

    const output = (() => {
      if (result.length === 0) return `No results found for ${args.operation}`
      return JSON.stringify(result, null, 2)
    })()

    const metadata: Record<string, unknown> = { result, envelope }
    return {
      title,
      metadata,
      output,
    }
  },
})
