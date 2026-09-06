import { expect, test } from "vitest"
import { createServer } from "node:http"
import { once } from "node:events"
import { execFileSync } from "node:child_process"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { MCP } from "../../src/mcp"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// Opt-in only: this launches an isolated browser and may download the pinned
// bridge through npx. No existing browser session or user config is touched.
const executablePath = process.env.AX_TEST_WEBMCP_CHROME
test.skipIf(!executablePath)(
  "published WebMCP bridge discovers and invokes a real local page tool",
  { timeout: 90_000, retry: 0 },
  async () => {
    let deniedRequests = 0
    await using denied = createServer((_request, response) => {
      deniedRequests++
      response.end("This origin is not permitted")
    })
    denied.listen(0, "127.0.0.1")
    await once(denied, "listening")
    const deniedAddress = denied.address()
    if (!deniedAddress || typeof deniedAddress === "string") throw new Error("Missing denied fixture address")
    const deniedOrigin = `http://127.0.0.1:${deniedAddress.port}`
    await using server = createServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: `${deniedOrigin}/redirect-target` })
        response.end()
        return
      }
      response.setHeader("Content-Type", "text/html; charset=utf-8")
      response.end(`<!doctype html><title>AX Code WebMCP fixture</title>
      <script>
        const context = document.modelContext ?? navigator.modelContext;
        if (context) context.registerTool({
          name: "fixture_echo",
          description: "Return a fixed local test marker with the supplied value",
          inputSchema: {type: "object", properties: {value: {type: "string"}}, required: ["value"]},
          execute: async ({value}) => {
            const network = await fetch("${deniedOrigin}/probe", {mode: "no-cors"}).then(() => "UNEXPECTED_ALLOWED", () => "BLOCKED");
            return {content: [{type: "text", text: "AX_WEBMCP_OK:" + value + ":NETWORK_" + network}]};
          }
        });
      </script>`)
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture address")
    const origin = `http://127.0.0.1:${address.port}`
    await using tmp = await tmpdir({ git: true })
    try {
      console.info(
        `WebMCP qualification: ${WebMcpProfile.PACKAGE}; ${execFileSync(executablePath!, ["--version"], { encoding: "utf8" }).trim()}`,
      )
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          try {
            const result = await MCP.add("live", {
              ...WebMcpProfile.config({ allowedOrigins: [origin], headless: true, executablePath }, true),
              timeout: 60_000,
            })
            expect(result.status.live).toMatchObject({ status: "connected" })
            const tools = await MCP.tools()
            expect(Object.keys(tools).sort()).toEqual(WebMcpProfile.TOOLS.map((name) => `live_${name}`).sort())
            const call = async (name: string, args: Record<string, unknown>) => {
              const result = await tools[`live_${name}`].execute!(args, { toolCallId: `live_${name}`, messages: [] })
              const text = JSON.stringify(result)
              expect(result, text).not.toHaveProperty("isError", true)
              return CallToolResultSchema.parse(result)
                .content.flatMap((item) => (item.type === "text" ? [item.text] : []))
                .join("\n")
            }
            await call("new_page", { url: `${origin}/fixture` })
            const pages = await call("list_pages", {})
            const pageLine = pages.split("\n").find((line) => line.includes(`${origin}/fixture`))
            const pageId = Number(/^(\d+):/.exec(pageLine ?? "")?.[1])
            expect(Number.isSafeInteger(pageId), pages).toBe(true)
            await expect
              .poll(async () => call("list_webmcp_tools", { pageId }), { timeout: 10_000 })
              .toContain("fixture_echo")
            const response = await call("execute_webmcp_tool", {
              pageId,
              toolName: "fixture_echo",
              input: '{"value":"qualified"}',
            })
            expect(response).toContain("Completed")
            expect(response).toContain("AX_WEBMCP_OK:qualified")
            expect(response).toContain("NETWORK_BLOCKED")
            expect(deniedRequests).toBe(0)
            await expect(call("new_page", { url: "https://not-allowed.invalid/" })).rejects.toThrow(
              "origin is not allowed",
            )
            await expect(call("new_page", { url: `${origin}/redirect` })).rejects.toThrow(
              "WebMCP bridge operation failed",
            )
            expect(deniedRequests).toBe(0)
            await call("close_page", { pageId })
          } finally {
            await Instance.dispose()
          }
        },
      })
    } finally {
      server.closeAllConnections()
      denied.closeAllConnections()
    }
  },
)
