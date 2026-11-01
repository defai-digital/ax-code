import { expect, test, vi } from "vitest"
import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client"
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

test.each([{}, "{}"])("a healthy dispatch serializes input %j and keeps one shared deadline", async (input) => {
  const current = profile()
  const timeouts: (number | undefined)[] = []
  const client = {
    // v2 callTool takes (params, options); the result schema argument is gone.
    callTool: vi.fn(async (request: { name: string }, options: { timeout?: number }) => {
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
  await execute.execute!({ pageId: 1, toolName: "a", input }, { toolCallId: "call_exec", messages: [] } as never)
  expect(client.callTool).toHaveBeenCalledWith(
    { name: "execute_webmcp_tool", arguments: { pageId: 1, toolName: "a", input: "{}" } },
    expect.any(Object),
  )
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

test("a new_page dispatch marks the created page and close_page forgets it (ADR-277)", async () => {
  const current = profile()
  const blank = { id: 1, url: "about:blank", selected: true }
  const listed = { content: [], structuredContent: { pages: [blank] } }
  const opened = {
    content: [],
    structuredContent: {
      pages: [
        { ...blank, selected: false },
        { id: 2, url: "https://example.test/", selected: true },
      ],
    },
  }
  let pages: unknown = listed
  const client = {
    // list_pages serves the page list taken before new_page and the
    // close-target lookup; the pinned bridge returns the authoritative page
    // list for new_page and close_page alike.
    callTool: vi.fn(async (request: { name: string }) => {
      if (request.name === "new_page") pages = opened
      return pages
    }),
  }
  const open = await convertMcpTool(
    { name: "new_page", inputSchema: { type: "object" } } as never,
    client as never,
    5000,
    { server: "bridge", toolName: "new_page", profile: current },
  )
  await open.execute!({ url: "https://example.test/" }, { toolCallId: "call_new", messages: [] } as never)
  // The selected page was not listed before the call, so new_page created it.
  expect(WebMcpProfile.isAgentPage(current, 2)).toBe(true)
  expect(WebMcpProfile.isAgentPage(current, 1)).toBe(false)
  const close = await convertMcpTool(
    { name: "close_page", inputSchema: { type: "object" } } as never,
    client as never,
    5000,
    { server: "bridge", toolName: "close_page", profile: current },
  )
  await close.execute!({ pageId: 2 }, { toolCallId: "call_close", messages: [] } as never)
  // forgetPage drops the agent mark along with the rest of the page state.
  expect(WebMcpProfile.isAgentPage(current, 2)).toBe(false)
})

test("a new_page whose selected page was already listed is not marked as agent-opened (ADR-277)", async () => {
  const current = profile()
  // A page on an allowed origin that the user opened by hand.
  const user = { id: 1, url: "https://example.test/mine", selected: true }
  const listed = { content: [], structuredContent: { pages: [user] } }
  // The pinned bridge selects the first listed page when the tab it created
  // has already closed, and says so only in prose: the structured list then
  // points at a page the user may have opened or signed in to by hand.
  const fallback = {
    content: [{ type: "text", text: "Note: the previously selected page was closed. Page 1 is now selected." }],
    structuredContent: { pages: [user] },
  }
  const client = {
    callTool: vi.fn(async (request: { name: string }) => (request.name === "new_page" ? fallback : listed)),
  }
  const open = await convertMcpTool(
    { name: "new_page", inputSchema: { type: "object" } } as never,
    client as never,
    5000,
    { server: "bridge", toolName: "new_page", profile: current },
  )
  await open.execute!({ url: "https://example.test/" }, { toolCallId: "call_new", messages: [] } as never)
  expect(WebMcpProfile.isAgentPage(current, 1)).toBe(false)
})

test("a new_page without a usable page list before it stays unmarked and still succeeds (ADR-277)", async () => {
  const current = profile()
  const opened = {
    content: [],
    structuredContent: { pages: [{ id: 1, url: "https://example.test/", selected: true }] },
  }
  const client = {
    callTool: vi.fn(async (request: { name: string }) => {
      if (request.name === "list_pages") throw new Error("bridge busy")
      return opened
    }),
  }
  const open = await convertMcpTool(
    { name: "new_page", inputSchema: { type: "object" } } as never,
    client as never,
    5000,
    { server: "bridge", toolName: "new_page", profile: current },
  )
  const result = (await open.execute!({ url: "https://example.test/" }, {
    toolCallId: "call_new",
    messages: [],
  } as never)) as { structuredContent: unknown }
  expect(result.structuredContent).toBe(opened.structuredContent)
  // Fail closed: without proof of creation the page keeps its close prompt.
  expect(WebMcpProfile.isAgentPage(current, 1)).toBe(false)
  expect(client.callTool).toHaveBeenCalledWith(expect.objectContaining({ name: "new_page" }), expect.anything())
})

// ADR-277: a bridge timeout must name the phase and the ambiguity instead of
// surfacing the SDK's generic "MCP error -32001: Request timed out".
test("a timed-out new_page reports that the action may or may not have taken effect", async () => {
  const timeout = new SdkError(SdkErrorCode.RequestTimeout, "Request timed out")
  const client = {
    callTool: vi.fn(async () => {
      throw timeout
    }),
  }
  const tool = await convertMcpTool(
    { name: "new_page", inputSchema: { type: "object" } } as never,
    client as never,
    5000,
    { server: "bridge", toolName: "new_page", profile: profile() },
  )
  const error = await tool.execute!({ url: "https://example.test/" }, {
    toolCallId: "call_new_page",
    messages: [],
  } as never).then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain("may or may not have taken effect")
  // The original SDK error stays reachable for logging and inspection.
  expect((error as Error).cause).toBe(timeout)
})

test("a timed-out list_pages reports that nothing was changed", async () => {
  const client = {
    callTool: vi.fn(async () => {
      throw new SdkError(SdkErrorCode.RequestTimeout, "Request timed out")
    }),
  }
  const tool = await convertMcpTool(
    { name: "list_pages", inputSchema: { type: "object" } } as never,
    client as never,
    5000,
    { server: "bridge", toolName: "list_pages", profile: profile() },
  )
  const error = await tool.execute!({}, { toolCallId: "call_list_pages", messages: [] } as never).then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain("Nothing was changed")
})

test("a timed-out non-WebMCP tool keeps the original SDK error", async () => {
  const timeout = new SdkError(SdkErrorCode.RequestTimeout, "Request timed out")
  const client = {
    callTool: vi.fn(async () => {
      throw timeout
    }),
  }
  const tool = await convertMcpTool(
    { name: "some_other_tool", inputSchema: { type: "object" } } as never,
    client as never,
    5000,
  )
  const error = await tool.execute!({}, { toolCallId: "call_other", messages: [] } as never).then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBe(timeout)
  expect((error as Error).message).toBe("Request timed out")
})
