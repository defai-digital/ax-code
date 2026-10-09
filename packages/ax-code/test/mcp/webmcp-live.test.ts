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
            // ADR-168 amendment: a blocked redirect surfaces as a grantable
            // origin error (the probe names the target), not an opaque failure.
            await expect(call("new_page", { url: `${origin}/redirect` })).rejects.toThrow("origin is not allowed")
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

test.skipIf(!executablePath)(
  "real browser continues a saved first read and reuses a separate close approval",
  { timeout: 90_000, retry: 0 },
  async () => {
    const { Permission } = await import("../../src/permission")
    const { WebMcpApprovals } = await import("../../src/mcp/webmcp-approvals")
    const { resolveTools } = await import("../../src/session/prompt/prompt-tools")
    await using server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8")
      response.end("<!doctype html><title>Approval continuity</title><h1>AX_APPROVAL_CONTINUITY_OK</h1>")
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture address")
    const origin = `http://127.0.0.1:${address.port}`
    const entry = {
      ...WebMcpProfile.config({ allowedOrigins: [origin], read: true, headless: true, executablePath }, true),
      timeout: 30_000,
    }
    await using tmp = await tmpdir({ git: true, config: { mcp: { live: entry } } })
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await MCP.connect("live")
          const direct = await MCP.tools()
          const options = { toolCallId: "call_live_approval", messages: [], abortSignal: new AbortController().signal }
          const open = async () => {
            await direct.live_new_page.execute!({ url: `${origin}/fixture` }, options)
            const pages = WebMcpProfile.parseStructuredPages(await direct.live_list_pages.execute!({}, options))
            const page = [...(pages ?? [])].find(([, url]) => url === `${origin}/fixture`)
            expect(page).toBeDefined()
            return page![0]
          }
          const wrapped = await resolveTools({
            agent: { name: "build", permission: [{ permission: "*", pattern: "*", action: "allow" }] },
            session: { id: "ses_live_approval_flow", permission: [] },
            model: { providerID: "test", api: { id: "test", npm: "@ai-sdk/openai-compatible" } },
            tools: {},
            bypassAgentCheck: false,
            messages: [],
            processor: { message: { id: "msg_live_approval_flow" }, partFromToolCall: () => undefined },
          } as never)
          const pending = async () => {
            await expect.poll(async () => (await Permission.list()).length).toBe(1)
            return (await Permission.list())[0]
          }
          const pageId = await open()
          const read = wrapped.live_take_snapshot.execute!({ pageId }, options)
          const readRequest = await Promise.race([
            pending(),
            read.then(() => {
              throw new Error("First read finished without requesting permission")
            }),
          ])
          expect(readRequest.webmcpAllowlist?.scope).toEqual({ capability: "read", origin })
          await Permission.saveWebMcpApproval(readRequest.id)
          await expect(read).resolves.toMatchObject({ output: expect.stringContaining("AX_APPROVAL_CONTINUITY_OK") })
          const close = wrapped.live_close_page.execute!({ pageId }, options)
          close.catch(() => {})
          const closeRequest = await pending()
          expect(closeRequest.webmcpAllowlist?.scope).toEqual({ capability: "close", origin })
          await Permission.saveWebMcpApproval(closeRequest.id)
          await close
          await wrapped.live_close_page.execute!({ pageId: await open() }, options)
          expect(await Permission.list()).toHaveLength(0)
          const records = await WebMcpApprovals.list("live")
          await WebMcpApprovals.remove("live", records.find((row) => row.scope.capability === "close")!.id)
          const denied = wrapped.live_close_page.execute!({ pageId: await open() }, options)
          const refused = expect(denied).rejects.toThrow()
          await Permission.reply({ requestID: (await pending()).id, reply: "reject" })
          await refused
        },
      })
    } finally {
      await Instance.disposeAll()
    }
  },
)
