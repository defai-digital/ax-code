import { dynamicTool, type Tool, type ToolCallOptions, jsonSchema, type JSONSchema7 } from "ai"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { CallToolResultSchema, type Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"

const log = Log.create({ service: "mcp" })
const MAX_TOOL_DESCRIPTION = 4_000
const MAX_TOOL_SCHEMA_BYTES = 64 * 1024

export type ConvertedMcpTool = Tool

export function sanitizeMcpName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_")
}

export function mcpItemKey(clientName: string, itemName: string): string {
  return `${sanitizeMcpName(clientName)}:${sanitizeMcpName(itemName)}`
}

export function mcpToolPermissionKey(server: string, tool: string): string {
  return `${sanitizeMcpName(server)}_${sanitizeMcpName(tool)}`
}

export function mcpSchemaByteLength(schema: JSONSchema7): number {
  try {
    return Buffer.byteLength(JSON.stringify(schema), "utf8")
  } catch (error) {
    throw new Error(`MCP tool schema is not JSON-serializable: ${toErrorMessage(error)}`)
  }
}

export async function convertMcpTool(mcpTool: MCPToolDef, client: Client, timeout?: number): Promise<ConvertedMcpTool> {
  const inputSchema = mcpTool.inputSchema

  // Spread first, then override type to ensure it is always "object".
  const schema: JSONSchema7 = {
    ...(inputSchema as JSONSchema7),
    type: "object",
    properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
    additionalProperties: (inputSchema as JSONSchema7).additionalProperties ?? false,
  }
  const schemaBytes = mcpSchemaByteLength(schema)
  if (schemaBytes > MAX_TOOL_SCHEMA_BYTES) {
    throw new Error(`MCP tool schema too large: ${mcpTool.name}`)
  }
  const description =
    (mcpTool.description ?? "").length > MAX_TOOL_DESCRIPTION
      ? `${(mcpTool.description ?? "").slice(0, MAX_TOOL_DESCRIPTION)}...`
      : (mcpTool.description ?? "")

  return dynamicTool({
    description,
    inputSchema: jsonSchema(schema),
    execute: async (args: unknown, opts: ToolCallOptions) => {
      try {
        return await client.callTool(
          {
            name: mcpTool.name,
            arguments: (args || {}) as Record<string, unknown>,
          },
          CallToolResultSchema,
          {
            resetTimeoutOnProgress: true,
            signal: opts.abortSignal,
            timeout,
          },
        )
      } catch (e) {
        log.error("MCP tool call failed", { tool: mcpTool.name, error: toErrorMessage(e) })
        throw e
      }
    },
  })
}
