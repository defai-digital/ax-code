import { describe, expect, test, vi } from "vitest"
import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { convertMcpTool } from "../../src/mcp/tool-conversion"

const ORIGIN = "https://app.test"
const PAGE = `${ORIGIN}/orders`

type GrantState = { read: Set<string>; interact: Map<string, number> }

function policy(toolName: string, profile: WebMcpProfile.Configuration, grants: GrantState): WebMcpProfile.Policy {
  return {
    server: "bridge",
    toolName,
    profile,
    readGrants: () => grants.read,
    interactGrants: () => grants.interact,
    consumeInteractBudget: (origin) => {
      const remaining = grants.interact.get(origin)
      if (remaining === undefined || remaining <= 0) return false
      grants.interact.set(origin, remaining - 1)
      return true
    },
  }
}

/** A fake bridge whose click never answers within the request timeout. */
function bridge() {
  const client = {
    callTool: vi.fn(async (request: { name: string }): Promise<Record<string, unknown>> => {
      if (request.name === "list_pages") {
        return { content: [], structuredContent: { pages: [{ id: 1, url: PAGE, selected: true }] } }
      }
      if (request.name === "take_snapshot") {
        return {
          content: [
            { type: "text", text: '## Latest page snapshot\nuid=1_0 RootWebArea "App"\n  uid=1_1 button "Next"' },
          ],
          structuredContent: {
            snapshot: {
              id: "1_0",
              role: "RootWebArea",
              name: "App",
              children: [{ id: "1_1", role: "button", name: "Next" }],
            },
          },
        }
      }
      if (request.name === "click") throw new SdkError(SdkErrorCode.RequestTimeout, "Request timed out")
      return { content: [] }
    }),
  }
  return client
}

const options = (id: string) => ({ toolCallId: id, messages: [] }) as never

describe("WebMCP timeout on a page-changing action (ADR-277)", () => {
  test("a timed-out click reports an uncertain outcome and drops the uid map it was bound to", async () => {
    const profile = WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp
    const grants: GrantState = { read: new Set([ORIGIN]), interact: new Map([[ORIGIN, 20]]) }
    const client = bridge()
    const snapshot = await convertMcpTool(
      { name: "take_snapshot", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      policy("take_snapshot", profile, grants),
    )
    await snapshot.execute!({ pageId: 1 }, options("snap"))
    expect(WebMcpProfile.targetSummaryFor(profile, 1, "1_1")?.name).toBe("Next")

    const click = await convertMcpTool(
      { name: "click", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      policy("click", profile, grants),
    )
    const error = await click.execute!({ pageId: 1, uid: "1_1" }, options("click")).then(
      () => undefined,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("click timed out")
    expect((error as Error).message).toContain("may or may not have taken effect")
    expect((error as Error).cause).toBeInstanceOf(SdkError)
    // The page may have changed under the timed-out click: the old uid map must
    // not bind the next action (ADR-174 rule 8), so a fresh snapshot is needed.
    expect(WebMcpProfile.targetSummaryFor(profile, 1, "1_1")).toBeUndefined()
    expect(client.callTool).toHaveBeenCalledWith(expect.objectContaining({ name: "click" }), expect.anything())
  })

  test("the pre-dispatch budget error says the call never started", async () => {
    const profile = WebMcpProfile.config({ allowedOrigins: [] }).webmcp
    const client = { callTool: vi.fn(async () => ({ content: [] })) }
    const tool = await convertMcpTool(
      { name: "list_pages", inputSchema: { type: "object" } } as never,
      client as never,
      0,
      policy("list_pages", profile, { read: new Set(), interact: new Map() }),
    )
    await expect(tool.execute!({}, options("budget"))).rejects.toThrow("before the call started")
    expect(client.callTool).not.toHaveBeenCalled()
  })
})
