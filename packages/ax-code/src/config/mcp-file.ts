import { NamedError } from "@ax-code/util/error"
import { applyEdits, getNodeValue, modify, parseTree, type ParseError } from "jsonc-parser"
import z from "zod"
import { isRecord } from "../util/record"
import { transactConfigFile } from "./file-transaction"
import { Mcp } from "./schema"

export const McpConfigFileError = NamedError.create(
  "McpConfigFileError",
  z.object({ path: z.string(), message: z.string() }),
)

/** Parse only document structure so MCP removal can repair schema-invalid settings. */
function parseDocument(text: string, filepath: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const tree = parseTree(text, errors, { allowTrailingComma: true, allowEmptyContent: true })
  // Tree conversion preserves literal keys such as __proto__ in null-prototype maps.
  const parsed: unknown = tree ? getNodeValue(tree) : undefined
  if (errors.length > 0 || (parsed !== undefined && !isRecord(parsed))) {
    throw new McpConfigFileError({ path: filepath, message: `Invalid config file: ${filepath}` })
  }
  return parsed ?? {}
}

export function hasMcpName(text: string, name: string, filepath: string): boolean {
  const parsed = parseDocument(text, filepath)
  return isRecord(parsed.mcp) && Object.hasOwn(parsed.mcp, name)
}

export async function addMcpToConfig(name: string, config: Mcp, filepath: string): Promise<string> {
  return transactConfigFile(filepath, (before) => {
    const text = before ?? "{}"
    const parsed = parseDocument(text, filepath)
    if (parsed.mcp !== undefined && !isRecord(parsed.mcp)) {
      throw new McpConfigFileError({ path: filepath, message: `Invalid MCP config map: ${filepath}` })
    }
    if (!Mcp.safeParse(config).success) {
      throw new McpConfigFileError({ path: filepath, message: `Invalid MCP server configuration for "${name}"` })
    }
    const updated = applyEdits(
      text,
      modify(text, ["mcp", name], config, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      }),
    )
    parseDocument(updated, filepath)
    return { text: updated, value: filepath }
  })
}

export async function removeMcpFromConfig(name: string, filepath: string): Promise<string> {
  return transactConfigFile(filepath, (text) => {
    if (text === undefined) {
      throw new McpConfigFileError({ path: filepath, message: `Config file not found: ${filepath}` })
    }
    if (!hasMcpName(text, name, filepath)) {
      throw new McpConfigFileError({ path: filepath, message: `MCP server "${name}" is not configured in ${filepath}` })
    }
    const updated = applyEdits(
      text,
      modify(text, ["mcp", name], undefined, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      }),
    )
    parseDocument(updated, filepath)
    return { text: updated, value: filepath }
  })
}
