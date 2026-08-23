import type { McpCallToolResult, McpClient, McpToolDefinition } from "../src/mcp/stdio-client"

/** 1x1 transparent PNG */
export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

/** scripted McpClient for provider mapping tests; records every call */
export class FakeMcpClient implements McpClient {
  readonly calls: { tool: string; args: Record<string, unknown> }[] = []
  closed = false

  constructor(private readonly handler: (tool: string, args: Record<string, unknown>) => McpCallToolResult) {}

  async listTools(): Promise<McpToolDefinition[]> {
    return []
  }

  async callTool(tool: string, args: Record<string, unknown>): Promise<McpCallToolResult> {
    this.calls.push({ tool, args })
    return this.handler(tool, args)
  }

  async close(): Promise<void> {
    this.closed = true
  }

  lastCall(): { tool: string; args: Record<string, unknown> } {
    const call = this.calls[this.calls.length - 1]
    if (!call) throw new Error("FakeMcpClient: no calls recorded")
    return call
  }
}
