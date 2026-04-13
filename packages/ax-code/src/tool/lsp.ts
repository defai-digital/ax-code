import z from "zod"
import { Tool } from "./tool"
import path from "path"
import { LSP } from "../lsp"
import DESCRIPTION from "./lsp.txt"
import { Instance } from "../project/instance"
import { pathToFileURL } from "url"
import { assertExternalDirectory } from "./external-directory"
import { Filesystem } from "../util/filesystem"

const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const

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
    if (args.operation === "workspaceSymbol") {
      if (!args.query?.trim()) {
        throw new Error("workspaceSymbol requires `query`")
      }

      await ctx.ask({
        permission: "lsp",
        patterns: ["*"],
        always: ["*"],
        metadata: {},
      })

      const result = await LSP.workspaceSymbol(args.query)
      const output = result.length === 0 ? `No results found for workspaceSymbol` : JSON.stringify(result, null, 2)

      return {
        title: `workspaceSymbol ${args.query}`,
        metadata: { result },
        output,
      }
    }

    if (!args.filePath) throw new Error(`${args.operation} requires \`filePath\``)
    if (args.line === undefined) throw new Error(`${args.operation} requires \`line\``)
    if (args.character === undefined) throw new Error(`${args.operation} requires \`character\``)

    const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(Instance.directory, args.filePath)
    await assertExternalDirectory(ctx, file)

    // Validate BEFORE asking permission. Previously the user saw a
    // "Grant LSP access?" prompt for non-existent files or files with
    // no matching LSP server, approved, then immediately got a
    // "File not found" or "No LSP server available" error. Checking
    // prerequisites first means only real, actionable calls surface
    // a permission prompt.
    const exists = await Filesystem.exists(file)
    if (!exists) {
      throw new Error(`File not found: ${file}`)
    }

    const available = await LSP.hasClients(file)
    if (!available) {
      throw new Error("No LSP server available for this file type.")
    }

    await ctx.ask({
      permission: "lsp",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })
    const uri = pathToFileURL(file).href
    const position = {
      file,
      line: args.line - 1,
      character: args.character - 1,
    }

    const relPath = path.relative(Instance.worktree, file)
    const title = `${args.operation} ${relPath}:${args.line}:${args.character}`

    const opened = await LSP.touchFile(file, true)
    if (opened === 0) {
      throw new Error("LSP server matched this file type but could not be started or did not accept the file.")
    }

    const result: unknown[] = await (async () => {
      switch (args.operation) {
        case "goToDefinition":
          return LSP.definition(position)
        case "findReferences":
          return LSP.references(position)
        case "hover":
          return LSP.hover(position)
        case "documentSymbol":
          return LSP.documentSymbol(uri)
        case "goToImplementation":
          return LSP.implementation(position)
        case "prepareCallHierarchy":
          return LSP.prepareCallHierarchy(position)
        case "incomingCalls":
          return LSP.incomingCalls(position)
        case "outgoingCalls":
          return LSP.outgoingCalls(position)
        default:
          return []
      }
    })()

    const output = (() => {
      if (result.length === 0) return `No results found for ${args.operation}`
      return JSON.stringify(result, null, 2)
    })()

    return {
      title,
      metadata: { result },
      output,
    }
  },
})
