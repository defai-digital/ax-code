import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Permission } from "../../src/permission"
import { MCP } from "../../src/mcp"
import { ToolRegistry } from "../../src/tool/registry"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { convertMcpTool } from "../../src/mcp/tool-conversion"
import { resolveTools } from "../../src/session/prompt/prompt-tools"

/**
 * ADR-174 session-layer wiring: which T2 calls ask, which run under the
 * interact grant, how the grant prompt is raised, and how the per-turn
 * circuit breaker behaves. The dispatch and profile layers are covered in
 * test/mcp/webmcp-interact-tier.test.ts; here the converted bridge tool runs
 * through the real prompt-tools wrapper with Permission.ask spied.
 */

const ORIGIN = "https://app.test"
const PAGE = `${ORIGIN}/orders`

type GrantState = { read: Set<string>; interact: Map<string, number> }

function snapshotNodes() {
  return WebMcpProfile.parseStructuredSnapshot({
    structuredContent: {
      snapshot: {
        id: "1_0",
        role: "RootWebArea",
        name: "App",
        children: [
          { id: "1_1", role: "button", name: "Save draft" },
          { id: "1_2", role: "link", name: "Settings" },
          { id: "1_5", role: "textbox", name: "Full name", focused: true },
        ],
      },
    },
  })!
}

function fakeClient() {
  const calls: string[] = []
  return {
    calls,
    callTool: vi.fn(async (request: { name: string }): Promise<Record<string, unknown>> => {
      calls.push(request.name)
      if (request.name === "list_pages") {
        return { content: [], structuredContent: { pages: [{ id: 1, url: PAGE, selected: true }] } }
      }
      return { content: [{ type: "text", text: "Successfully acted" }], structuredContent: {} }
    }),
  }
}

async function bridgeTools(
  profile: WebMcpProfile.Configuration,
  grants: GrantState,
  client: ReturnType<typeof fakeClient>,
) {
  const policy = (toolName: string): WebMcpProfile.Policy => ({
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
  })
  const entries = await Promise.all(
    ["click", "fill"].map(async (name) => [
      `bridge_${name}`,
      await convertMcpTool({ name, inputSchema: { type: "object" } } as never, client as never, 5000, policy(name)),
    ]),
  )
  return Object.fromEntries(entries)
}

function resolveInput(turn: string) {
  return {
    agent: { name: "build", permission: [{ permission: "*", pattern: "*", action: "allow" }] } as never,
    session: { id: "ses_webmcp_t2", permission: [] } as never,
    model: { providerID: "test-provider", api: { id: "test-model", npm: "@ai-sdk/openai-compatible" } } as never,
    tools: {},
    bypassAgentCheck: false,
    messages: [],
    processor: { message: { id: turn }, partFromToolCall: () => undefined } as never,
  }
}

const execOptions = () => ({
  toolCallId: `call_${Math.random().toString(36).slice(2)}`,
  abortSignal: new AbortController().signal,
})

afterEach(async () => {
  await Instance.disposeAll()
  vi.restoreAllMocks()
})

describe("WebMCP T2 asks through the session layer", () => {
  test("a grant-covered click asks nothing and spends the budget; a per-action fill asks twice", async () => {
    await using tmp = await tmpdir()
    const profile = WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp
    WebMcpProfile.recordSnapshot(profile, 1, snapshotNodes(), PAGE)
    const grants: GrantState = { read: new Set([ORIGIN]), interact: new Map([[ORIGIN, 20]]) }
    const client = fakeClient()
    vi.spyOn(ToolRegistry, "tools").mockResolvedValue([])
    vi.spyOn(MCP, "tools").mockResolvedValue(await bridgeTools(profile, grants, client))
    const ask = vi.spyOn(Permission, "ask").mockResolvedValue(undefined)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await resolveTools(resolveInput("msg_turn_1"))
        await (tools.bridge_click.execute as any)({ pageId: 1, uid: "1_1" }, execOptions())
        expect(ask).not.toHaveBeenCalled()
        expect(client.calls).toContain("click")
        expect(grants.interact.get(ORIGIN)).toBe(19)

        await (tools.bridge_fill.execute as any)({ pageId: 1, uid: "1_5", value: "Jane Doe" }, execOptions())
        expect(ask).toHaveBeenCalledTimes(2)
        expect(ask.mock.calls[0]?.[0]).toMatchObject({ permission: "bridge_fill" })
        expect(ask.mock.calls[1]?.[0]).toMatchObject({
          permission: "webmcp",
          always: [],
          metadata: expect.objectContaining({ interactAction: true, value: "Jane Doe", pageOrigin: ORIGIN }),
        })
        expect(client.calls).toContain("fill")
        expect(grants.interact.get(ORIGIN)).toBe(19)

        // A link click is escalated: it asks per action and spends no budget.
        await (tools.bridge_click.execute as any)({ pageId: 1, uid: "1_2" }, execOptions())
        expect(ask).toHaveBeenCalledTimes(4)
        expect(ask.mock.calls[3]?.[0]).toMatchObject({
          permission: "webmcp",
          metadata: expect.objectContaining({ interactAction: true, escalation: expect.stringContaining("link") }),
        })
        expect(grants.interact.get(ORIGIN)).toBe(19)
      },
    })
  })

  test("an origin without a grant prompts for the interact grant before any action, then the retry proceeds", async () => {
    await using tmp = await tmpdir()
    const profile = WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp
    WebMcpProfile.recordSnapshot(profile, 1, snapshotNodes(), PAGE)
    const grants: GrantState = { read: new Set([ORIGIN]), interact: new Map() }
    const client = fakeClient()
    vi.spyOn(ToolRegistry, "tools").mockResolvedValue([])
    vi.spyOn(MCP, "tools").mockResolvedValue(await bridgeTools(profile, grants, client))
    vi.spyOn(MCP, "checkWebMcpInteractGrant").mockResolvedValue({ ok: true })
    vi.spyOn(MCP, "grantWebMcpInteractOrigin").mockImplementation(async (_name, origin) => {
      grants.interact.set(origin, WebMcpProfile.INTERACT_BUDGET)
      return { ok: true }
    })
    const ask = vi.spyOn(Permission, "ask").mockResolvedValue(undefined)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await resolveTools(resolveInput("msg_turn_1"))
        // Grant-covered click: the dispatch raises the grant error, the prompt is the grant prompt.
        await expect((tools.bridge_click.execute as any)({ pageId: 1, uid: "1_1" }, execOptions())).rejects.toThrow(
          "allowed for this session",
        )
        expect(ask).toHaveBeenCalledTimes(1)
        expect(ask.mock.calls[0]?.[0]).toMatchObject({
          permission: "webmcp",
          always: [],
          metadata: expect.objectContaining({ interactGrant: true, origin: ORIGIN, budget: 20 }),
        })
        expect(client.calls).not.toContain("click")
        expect(grants.interact.get(ORIGIN)).toBe(20)
        await (tools.bridge_click.execute as any)({ pageId: 1, uid: "1_1" }, execOptions())
        expect(ask).toHaveBeenCalledTimes(1)
        expect(grants.interact.get(ORIGIN)).toBe(19)

        // Per-action fill on a fresh origin: the grant prompt comes first, before the per-action asks.
        grants.interact.clear()
        await expect(
          (tools.bridge_fill.execute as any)({ pageId: 1, uid: "1_5", value: "Jane" }, execOptions()),
        ).rejects.toThrow("allowed for this session")
        expect(ask).toHaveBeenCalledTimes(2)
        expect(ask.mock.calls[1]?.[0]).toMatchObject({ metadata: expect.objectContaining({ interactGrant: true }) })
        expect(client.calls).not.toContain("fill")
        await (tools.bridge_fill.execute as any)({ pageId: 1, uid: "1_5", value: "Jane" }, execOptions())
        expect(ask).toHaveBeenCalledTimes(4)
        expect(ask.mock.calls[3]?.[0]).toMatchObject({ metadata: expect.objectContaining({ interactAction: true }) })
        expect(client.calls).toContain("fill")
      },
    })
  })

  test("an unlisted target fails before any ask, and three such failures trip the breaker for the turn", async () => {
    await using tmp = await tmpdir()
    const profile = WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp
    WebMcpProfile.recordSnapshot(profile, 1, snapshotNodes(), PAGE)
    const grants: GrantState = { read: new Set([ORIGIN]), interact: new Map([[ORIGIN, 20]]) }
    const client = fakeClient()
    vi.spyOn(ToolRegistry, "tools").mockResolvedValue([])
    vi.spyOn(MCP, "tools").mockResolvedValue(await bridgeTools(profile, grants, client))
    const ask = vi.spyOn(Permission, "ask").mockResolvedValue(undefined)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const input = resolveInput("msg_turn_1")
        const tools = await resolveTools(input)
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await expect(
            (tools.bridge_fill.execute as any)({ pageId: 1, uid: "9_9", value: "x" }, execOptions()),
          ).rejects.toThrow("not in the latest snapshot")
        }
        expect(ask).not.toHaveBeenCalled()
        expect(client.calls).not.toContain("fill")
        // Tripped: even a well-formed grant-covered click now fails without asking or acting.
        await expect((tools.bridge_click.execute as any)({ pageId: 1, uid: "1_1" }, execOptions())).rejects.toThrow(
          "stopped for this turn",
        )
        expect(client.calls).not.toContain("click")
        const sameTurn = await resolveTools(input)
        await expect((sameTurn.bridge_click.execute as any)({ pageId: 1, uid: "1_1" }, execOptions())).rejects.toThrow(
          "stopped for this turn",
        )
        // A new turn resets it.
        const next = await resolveTools(resolveInput("msg_turn_2"))
        await (next.bridge_click.execute as any)({ pageId: 1, uid: "1_1" }, execOptions())
        expect(client.calls).toContain("click")
        // Late calls from an old turn cannot reset its tripped breaker.
        await expect((tools.bridge_click.execute as any)({ pageId: 1, uid: "1_1" }, execOptions())).rejects.toThrow(
          "stopped for this turn",
        )
      },
    })
  })

  test("three consecutive refusals trip the breaker; an approval in between resets the count", async () => {
    await using tmp = await tmpdir()
    const profile = WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp
    WebMcpProfile.recordSnapshot(profile, 1, snapshotNodes(), PAGE)
    const grants: GrantState = { read: new Set([ORIGIN]), interact: new Map([[ORIGIN, 20]]) }
    const client = fakeClient()
    vi.spyOn(ToolRegistry, "tools").mockResolvedValue([])
    vi.spyOn(MCP, "tools").mockResolvedValue(await bridgeTools(profile, grants, client))
    const ask = vi.spyOn(Permission, "ask")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await resolveTools(resolveInput("msg_turn_1"))
        const fill = () => (tools.bridge_fill.execute as any)({ pageId: 1, uid: "1_5", value: "x" }, execOptions())
        ask.mockRejectedValueOnce(new Permission.RejectedError())
        await expect(fill()).rejects.toBeInstanceOf(Permission.RejectedError)
        ask.mockRejectedValueOnce(new Permission.RejectedError())
        await expect(fill()).rejects.toBeInstanceOf(Permission.RejectedError)
        // An approval resets the refusal count.
        ask.mockResolvedValue(undefined)
        await fill()
        ask.mockRejectedValue(new Permission.RejectedError())
        await expect(fill()).rejects.toBeInstanceOf(Permission.RejectedError)
        await expect(fill()).rejects.toBeInstanceOf(Permission.RejectedError)
        await expect(fill()).rejects.toBeInstanceOf(Permission.RejectedError)
        const asksBefore = ask.mock.calls.length
        await expect(fill()).rejects.toThrow("3 consecutive refusals")
        expect(ask.mock.calls.length).toBe(asksBefore)
        expect(client.calls.filter((name) => name === "fill")).toHaveLength(1)
      },
    })
  })
})
