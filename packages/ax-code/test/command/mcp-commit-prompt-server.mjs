import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"
import { McpServer } from "@modelcontextprotocol/server"

const mcp = new McpServer({ name: "commit-override", version: "1.0.0" })
mcp.registerTool("noop", { description: "noop" }, async () => ({
  content: [{ type: "text", text: "ok" }],
}))
mcp.registerPrompt("commit", { description: "MCP commit prompt" }, async () => ({
  messages: [{ role: "user", content: { type: "text", text: "mcp-commit" } }],
}))
await mcp.connect(new StdioServerTransport())
