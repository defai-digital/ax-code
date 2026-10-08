import { expect, test, vi } from "vitest"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { convertMcpTool } from "../../src/mcp/tool-conversion"

const profile = () => WebMcpProfile.config({ allowedOrigins: ["https://example.test"] }, true).webmcp

test("an exhausted dispatch budget fails before dispatching and clears the baseline", async () => {
  const current = profile()
  const state = WebMcpProfile.stateFor(current)
  expect(WebMcpProfile.recordListing(state, 1, [{ name: "a" }], "https://example.test/")).toEqual({ ok: true })
  const calls: string[] = []
  const client = {
    callTool: vi.fn(async (request: { name: string }) => {
      calls.push(request.name)
      if (request.name === "list_webmcp_tools") {
        await new Promise((resolve) => setTimeout(resolve, 120))
        return { content: [], structuredContent: { webmcpTools: [{ name: "a" }] } }
      }
      return {
        content: [],
        structuredContent: { pages: [{ id: 1, url: "https://example.test/", selected: true }] },
      }
    }),
  }
  const tool = await convertMcpTool(
    { name: "list_webmcp_tools", inputSchema: { type: "object" } } as never,
    client as never,
    50,
    { server: "bridge", toolName: "list_webmcp_tools", profile: current },
  )
  await expect(tool.execute!({ pageId: 1 }, { toolCallId: "call_slow", messages: [] } as never)).rejects.toThrow(
    "exceeded its timeout",
  )
  // The post-listing snapshot never dispatched: snapshot, slow list, then the deadline.
  expect(calls).toEqual(["list_pages", "list_webmcp_tools"])
  // The failed listing invalidated the stored baseline.
  expect(WebMcpProfile.verifyBinding(current, 1, "a", [{ name: "a" }], "https://example.test/")).toMatchObject({
    ok: false,
    error: expect.stringContaining("called first"),
  })
})

test("a healthy dispatch keeps one shared deadline across preflight and main call", async () => {
  const current = profile()
  const timeouts: (number | undefined)[] = []
  const client = {
    callTool: vi.fn(async (request: { name: string }, _schema: unknown, options: { timeout?: number }) => {
      timeouts.push(options.timeout)
      if (request.name === "list_webmcp_tools") {
        return { content: [], structuredContent: { webmcpTools: [{ name: "a" }] } }
      }
      if (request.name === "list_pages") {
        return {
          content: [],
          structuredContent: { pages: [{ id: 1, url: "https://example.test/", selected: true }] },
        }
      }
      return {
        content: [{ type: "text", text: "ok" }],
        structuredContent: { message: JSON.stringify({ status: "Completed" }) },
      }
    }),
  }
  const list = await convertMcpTool(
    { name: "list_webmcp_tools", inputSchema: { type: "object" } } as never,
    client as never,
    5000,
    { server: "bridge", toolName: "list_webmcp_tools", profile: current },
  )
  await list.execute!({ pageId: 1 }, { toolCallId: "call_list", messages: [] } as never)
  const execute = await convertMcpTool(
    { name: "execute_webmcp_tool", inputSchema: { type: "object" } } as never,
    client as never,
    5000,
    { server: "bridge", toolName: "execute_webmcp_tool", profile: current },
  )
  await execute.execute!({ pageId: 1, toolName: "a", input: "{}" }, { toolCallId: "call_exec", messages: [] } as never)
  // Three list-flow calls plus four execute-flow calls, each within its own dispatch budget.
  expect(timeouts).toHaveLength(7)
  for (const timeout of timeouts) {
    expect(timeout).toEqual(expect.any(Number))
    expect(timeout as number).toBeLessThanOrEqual(5000)
  }
  expect(timeouts.slice(0, 3)).toEqual([...timeouts.slice(0, 3)].sort((a, b) => (b as number) - (a as number)))
  expect(timeouts.slice(3)).toEqual([...timeouts.slice(3)].sort((a, b) => (b as number) - (a as number)))
})

test("bridge tool descriptions state the T0 limits", async () => {
  const tool = await convertMcpTool(
    { name: "list_pages", description: "List pages.", inputSchema: { type: "object" } } as never,
    { callTool: vi.fn() } as never,
    50,
    { server: "bridge", toolName: "list_pages", profile: profile() },
  )
  expect(tool.description).toContain("List pages.")
  expect(tool.description).toContain(WebMcpProfile.LIMITS_NOTE)
})
