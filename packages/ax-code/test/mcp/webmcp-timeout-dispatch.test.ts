import { afterEach, describe, expect, test, vi } from "vitest"
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

const requestTimeout = () => new SdkError(SdkErrorCode.RequestTimeout, "Request timed out")

const pages = { content: [], structuredContent: { pages: [{ id: 1, url: PAGE, selected: true }] } }
const snapshot = {
  content: [{ type: "text", text: '## Latest page snapshot\nuid=1_0 RootWebArea "App"\n  uid=1_1 button "Next"' }],
  structuredContent: {
    snapshot: { id: "1_0", role: "RootWebArea", name: "App", children: [{ id: "1_1", role: "button", name: "Next" }] },
  },
}

/**
 * A fake bridge: list_pages and take_snapshot answer normally unless told
 * otherwise; `onClick` decides what the click does.
 */
function bridge(options: {
  onClick: () => Promise<Record<string, unknown>>
  listPages?: (call: number) => Promise<Record<string, unknown>>
}) {
  let listCalls = 0
  return {
    callTool: vi.fn(async (request: { name: string }): Promise<Record<string, unknown>> => {
      if (request.name === "list_pages") return options.listPages ? options.listPages(++listCalls) : pages
      if (request.name === "take_snapshot") return snapshot
      if (request.name === "click") return options.onClick()
      return { content: [] }
    }),
  }
}

const options = (id: string) => ({ toolCallId: id, messages: [] }) as never

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )

async function recordedSnapshot(profile: WebMcpProfile.Configuration, client: unknown, grants: GrantState) {
  const tool = await convertMcpTool(
    { name: "take_snapshot", inputSchema: { type: "object" } } as never,
    client as never,
    5000,
    policy("take_snapshot", profile, grants),
  )
  await tool.execute!({ pageId: 1 }, options("snap"))
  expect(WebMcpProfile.targetSummaryFor(profile, 1, "1_1")?.name).toBe("Next")
}

const clickTool = (profile: WebMcpProfile.Configuration, client: unknown, grants: GrantState, timeout = 5000) =>
  convertMcpTool(
    { name: "click", inputSchema: { type: "object" } } as never,
    client as never,
    timeout,
    policy("click", profile, grants),
  )

const fullProfile = () => WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp
const fullGrants = (): GrantState => ({ read: new Set([ORIGIN]), interact: new Map([[ORIGIN, 20]]) })

afterEach(() => {
  vi.restoreAllMocks()
})

describe("WebMCP timeouts around a page-changing action (ADR-277)", () => {
  test("a timed-out click reports an uncertain outcome and drops the uid map it was bound to", async () => {
    const profile = fullProfile()
    const grants = fullGrants()
    const client = bridge({ onClick: () => Promise.reject(requestTimeout()) })
    await recordedSnapshot(profile, client, grants)

    const click = await clickTool(profile, client, grants)
    const error = await rejection(click.execute!({ pageId: 1, uid: "1_1" }, options("click")))
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("click timed out")
    expect((error as Error).message).toContain("may or may not have taken effect")
    expect((error as Error).cause).toBeInstanceOf(SdkError)
    // The page may have changed under the timed-out click: the old uid map must
    // not bind the next action (ADR-174 rule 8), so a fresh snapshot is needed.
    expect(WebMcpProfile.targetSummaryFor(profile, 1, "1_1")).toBeUndefined()
    expect(client.callTool).toHaveBeenCalledWith(expect.objectContaining({ name: "click" }), expect.anything())
  })

  test("a page lookup that times out before the call says the call was never sent", async () => {
    const profile = fullProfile()
    const grants = fullGrants()
    const client = bridge({ onClick: async () => ({ content: [] }), listPages: () => Promise.reject(requestTimeout()) })
    const click = await clickTool(profile, client, grants)
    const error = await rejection(click.execute!({ pageId: 1, uid: "1_1" }, options("click")))
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("click was not sent to the browser")
    expect((error as Error).cause).toBeInstanceOf(SdkError)
    expect(client.callTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: "click" }), expect.anything())
  })

  test("a page lookup that times out after the call says the action may have taken effect and drops the uid map", async () => {
    const profile = fullProfile()
    const grants = fullGrants()
    // list_pages: 1 = before the snapshot, 2 = after it, 3 = before the click; the
    // lookup after the click (4) hangs past the request timeout.
    const client = bridge({
      onClick: async () => ({ content: [{ type: "text", text: "Clicked" }] }),
      listPages: (call) => (call >= 4 ? Promise.reject(requestTimeout()) : Promise.resolve(pages)),
    })
    await recordedSnapshot(profile, client, grants)
    const click = await clickTool(profile, client, grants)
    const error = await rejection(click.execute!({ pageId: 1, uid: "1_1" }, options("click")))
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("click was sent to the browser")
    expect((error as Error).message).toContain("may have taken effect")
    expect((error as Error).cause).toBeInstanceOf(SdkError)
    expect(WebMcpProfile.targetSummaryFor(profile, 1, "1_1")).toBeUndefined()
  })

  test("a budget that runs out after the call was sent says so instead of claiming nothing was sent", async () => {
    let now = 10_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    const profile = fullProfile()
    const grants = fullGrants()
    const client = bridge({
      onClick: async () => {
        // The click itself answers, but only after the whole dispatch budget.
        now += 1_500
        return { content: [{ type: "text", text: "Clicked" }] }
      },
    })
    await recordedSnapshot(profile, client, grants)
    const click = await clickTool(profile, client, grants, 1_000)
    const error = await rejection(click.execute!({ pageId: 1, uid: "1_1" }, options("click")))
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("exceeded its timeout after click was sent to the browser")
    expect((error as Error).message).toContain("may have taken effect")
    // The page was not observed after the click, so the old map must not stand in.
    expect(WebMcpProfile.targetSummaryFor(profile, 1, "1_1")).toBeUndefined()
  })

  test("the pre-dispatch budget error says the call was not sent and never dispatches it", async () => {
    const profile = WebMcpProfile.config({ allowedOrigins: [] }).webmcp
    const client = { callTool: vi.fn(async () => ({ content: [] })) }
    const tool = await convertMcpTool(
      { name: "list_pages", inputSchema: { type: "object" } } as never,
      client as never,
      0,
      policy("list_pages", profile, { read: new Set(), interact: new Map() }),
    )
    const error = await rejection(tool.execute!({}, options("budget")))
    expect((error as Error).message).toContain("exceeded its timeout before list_pages was sent to the browser")
    expect((error as Error).message).toContain("changed nothing")
    expect(client.callTool).not.toHaveBeenCalled()
  })
})
