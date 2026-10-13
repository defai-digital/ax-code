import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Permission } from "../../src/permission"
import { MCP } from "../../src/mcp"
import { ToolRegistry } from "../../src/tool/registry"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { convertMcpTool } from "../../src/mcp/tool-conversion"
import { resolveTools } from "../../src/session/prompt/prompt-tools"
import { Bus } from "../../src/bus"

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
          { id: "1_6", role: "button", name: "Submit" },
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
      if (request.name === "new_page" || request.name === "navigate_page") {
        return {
          content: [],
          structuredContent: {
            message: `Successfully navigated to ${PAGE}`,
            pages: [{ id: 1, url: PAGE, selected: true }],
          },
        }
      }
      if (request.name === "list_webmcp_tools") {
        return { content: [], structuredContent: { webmcpTools: [{ name: "echo", inputSchema: { type: "object" } }] } }
      }
      if (request.name === "execute_webmcp_tool") {
        return {
          content: [],
          structuredContent: { message: JSON.stringify({ status: "Completed", output: "fixture" }) },
        }
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
    [
      "click",
      "fill",
      "fill_form",
      "press_key",
      "handle_dialog",
      "close_page",
      "execute_webmcp_tool",
      "wait_for",
      "list_pages",
      "new_page",
      "navigate_page",
      "list_webmcp_tools",
      "take_snapshot",
    ].map(async (name) => [
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
  messages: [],
})

afterEach(async () => {
  await Instance.disposeAll()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("WebMCP T2 asks through the session layer", () => {
  test.each(["workspace-write", "full-access"])(
    "%s Auto browsing admits both actual permission layers without a popup",
    async (mode) => {
      vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
      vi.stubEnv("AX_CODE_ISOLATION_MODE", mode)
      await using tmp = await tmpdir()
      const profile = WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp
      const grants: GrantState = { read: new Set(), interact: new Map() }
      const client = fakeClient()
      vi.spyOn(ToolRegistry, "tools").mockResolvedValue([])
      vi.spyOn(MCP, "tools").mockResolvedValue(await bridgeTools(profile, grants, client))
      vi.spyOn(MCP, "matchesWebMcpProfile").mockResolvedValue(true)
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const input = resolveInput("msg_auto_browse")
          input.agent = { name: "build", permission: [{ permission: "*", pattern: "*", action: "ask" }] } as never
          const asked: Permission.Request[] = []
          const stop = Bus.subscribe(Permission.Event.Asked, (event) => {
            asked.push(event.properties)
            void Permission.reply({ requestID: event.properties.id, reply: "reject" })
          })
          try {
            const tools = await resolveTools(input)
            for (const [name, args] of [
              ["list_pages", {}],
              ["new_page", { url: PAGE }],
              ["navigate_page", { pageId: 1, type: "url", url: PAGE }],
              ["list_webmcp_tools", { pageId: 1 }],
            ] as const) {
              await tools[`bridge_${name}`]!.execute!(args, execOptions())
              expect(client.calls).toContain(name)
            }
            expect(asked).toEqual([])
            expect(await Permission.list()).toEqual([])
          } finally {
            stop()
          }
        },
      })
    },
  )

  test("full-access Auto runs repeated form actions and page invocations without pending approvals", async () => {
    vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
    vi.stubEnv("AX_CODE_ISOLATION_MODE", "full-access")
    await using tmp = await tmpdir()
    const profile = WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp
    WebMcpProfile.recordSnapshot(profile, 1, snapshotNodes(), PAGE)
    const grants: GrantState = { read: new Set(), interact: new Map() }
    const client = fakeClient()
    vi.spyOn(ToolRegistry, "tools").mockResolvedValue([])
    vi.spyOn(MCP, "tools").mockResolvedValue(await bridgeTools(profile, grants, client))
    vi.spyOn(MCP, "matchesWebMcpProfile").mockResolvedValue(true)
    vi.spyOn(MCP, "checkWebMcpInteractGrant").mockResolvedValue({ ok: true })
    vi.spyOn(MCP, "grantWebMcpInteractOrigin").mockImplementation(async (_server, origin) => {
      grants.interact.set(origin, WebMcpProfile.INTERACT_BUDGET)
      return { ok: true }
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const asked = vi.fn((event: { properties: Permission.Request }) => {
          void Permission.reply({ requestID: event.properties.id, reply: "reject" })
        })
        const stop = Bus.subscribe(Permission.Event.Asked, asked)
        try {
          const input = resolveInput("msg_full_access_actions")
          input.agent = { name: "build", permission: [{ permission: "*", pattern: "*", action: "ask" }] } as never
          const tools = await resolveTools(input)
          for (const value of ["Jane", "Jane Doe"]) {
            await tools.bridge_fill!.execute!({ pageId: 1, uid: "1_5", value }, execOptions())
          }
          const fillsBeforeInvalid = client.calls.filter((name) => name === "fill").length
          await expect(
            tools.bridge_fill!.execute!({ pageId: 1, uid: "1_5", value: "sk-proj-" + "x".repeat(24) }, execOptions()),
          ).rejects.toThrow("credential")
          await expect(
            tools.bridge_fill!.execute!({ pageId: 1, uid: "9_9", value: "fixture" }, execOptions()),
          ).rejects.toThrow("snapshot")
          WebMcpProfile.recordSnapshot(profile, 1, snapshotNodes(), PAGE + "/stale")
          await expect(
            tools.bridge_fill!.execute!({ pageId: 1, uid: "1_5", value: "fixture" }, execOptions()),
          ).rejects.toThrow("snapshot")
          WebMcpProfile.recordSnapshot(profile, 1, snapshotNodes(), PAGE)
          expect(client.calls.filter((name) => name === "fill")).toHaveLength(fillsBeforeInvalid)
          expect(grants.interact.get(ORIGIN)).toBe(20)
          for (const [name, args] of [
            ["fill_form", { pageId: 1, elements: [{ uid: "1_5", value: "Jane" }] }],
            ["press_key", { pageId: 1, key: "Enter" }],
            ["click", { pageId: 1, uid: "1_2" }],
            ["click", { pageId: 1, uid: "1_1", dblClick: true }],
            ["click", { pageId: 1, uid: "1_6" }],
            ["handle_dialog", { pageId: 1, action: "accept" }],
            ["list_webmcp_tools", { pageId: 1 }],
            ["execute_webmcp_tool", { pageId: 1, toolName: "echo", input: "{}" }],
            ["close_page", { pageId: 1 }],
          ] as const) {
            WebMcpProfile.recordDialog(profile, 1, {
              structuredContent: { dialog: { type: "confirm", message: "Continue?" } },
            })
            await tools[`bridge_${name}`]!.execute!(args, execOptions())
            expect(client.calls).toContain(name)
          }
          expect(asked).not.toHaveBeenCalled()
          expect(await Permission.list()).toEqual([])
          expect(client.calls.filter((name) => name === "fill")).toHaveLength(2)
        } finally {
          stop()
        }
      },
    })
  })

  test("sandboxed Auto grants first read and ordinary interaction through the real permission engine", async () => {
    vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
    vi.stubEnv("AX_CODE_ISOLATION_MODE", "workspace-write")
    await using tmp = await tmpdir()
    const profile = WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp
    WebMcpProfile.recordSnapshot(profile, 1, snapshotNodes(), PAGE)
    const grants: GrantState = { read: new Set<string>(), interact: new Map<string, number>() }
    const client = fakeClient()
    vi.spyOn(ToolRegistry, "tools").mockResolvedValue([])
    vi.spyOn(MCP, "tools").mockResolvedValue(await bridgeTools(profile, grants, client))
    vi.spyOn(MCP, "matchesWebMcpProfile").mockResolvedValue(true)
    vi.spyOn(MCP, "checkWebMcpReadGrant").mockResolvedValue({ ok: true })
    vi.spyOn(MCP, "checkWebMcpInteractGrant").mockResolvedValue({ ok: true })
    vi.spyOn(MCP, "grantWebMcpReadOrigin").mockImplementation(async (_server, origin) => {
      grants.read.add(origin)
      return { ok: true }
    })
    vi.spyOn(MCP, "grantWebMcpInteractOrigin").mockImplementation(async (_server, origin) => {
      grants.interact.set(origin, WebMcpProfile.INTERACT_BUDGET)
      return { ok: true }
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const asked = vi.fn((event: { properties: Permission.Request }) => {
          void Permission.reply({ requestID: event.properties.id, reply: "reject" })
        })
        const stop = Bus.subscribe(Permission.Event.Asked, asked)
        try {
          const tools = await resolveTools(resolveInput("msg_auto_grants"))
          await tools.bridge_take_snapshot!.execute!({ pageId: 1 }, execOptions())
          expect(grants.read.has(ORIGIN)).toBe(true)
          expect(client.calls.filter((name) => name === "take_snapshot")).toHaveLength(1)
          // A successful read replaces the snapshot; bind the fixture's target again.
          WebMcpProfile.recordSnapshot(profile, 1, snapshotNodes(), PAGE)
          await expect(tools.bridge_click!.execute!({ pageId: 1, uid: "1_1" }, execOptions())).rejects.toThrow(
            "allowed for this session",
          )
          expect(client.calls).not.toContain("click")
          expect(grants.interact.get(ORIGIN)).toBe(20)
          await tools.bridge_click!.execute!({ pageId: 1, uid: "1_1" }, execOptions())
          expect(grants.interact.get(ORIGIN)).toBe(19)
          expect(asked).not.toHaveBeenCalled()
        } finally {
          stop()
        }
      },
    })
  })

  test("sandboxed Auto still requires a per-action decision before typing or a consequential click", async () => {
    vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
    vi.stubEnv("AX_CODE_ISOLATION_MODE", "workspace-write")
    await using tmp = await tmpdir()
    const profile = WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp
    WebMcpProfile.recordSnapshot(profile, 1, snapshotNodes(), PAGE)
    const grants: GrantState = { read: new Set([ORIGIN]), interact: new Map([[ORIGIN, 20]]) }
    const client = fakeClient()
    vi.spyOn(ToolRegistry, "tools").mockResolvedValue([])
    vi.spyOn(MCP, "tools").mockResolvedValue(await bridgeTools(profile, grants, client))
    vi.spyOn(MCP, "matchesWebMcpProfile").mockResolvedValue(true)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const asked: Permission.Request[] = []
        const stop = Bus.subscribe(Permission.Event.Asked, (event) => {
          asked.push(event.properties)
          void Permission.reply({ requestID: event.properties.id, reply: "reject" })
        })
        try {
          const tools = await resolveTools(resolveInput("msg_auto_protected"))
          await expect(
            tools.bridge_fill!.execute!({ pageId: 1, uid: "1_5", value: "Jane" }, execOptions()),
          ).rejects.toThrow("rejected")
          await expect(tools.bridge_click!.execute!({ pageId: 1, uid: "1_2" }, execOptions())).rejects.toThrow(
            "rejected",
          )
          expect(asked).toHaveLength(2)
          expect(
            asked.every(
              (item) =>
                item.permission === "webmcp" && item.metadata.interactAction === true && item.autoOnceAt === undefined,
            ),
          ).toBe(true)
          expect(client.calls).not.toContain("fill")
          expect(client.calls).not.toContain("click")
        } finally {
          stop()
        }
      },
    })
  })

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

        // Per-action fill on a fresh origin: the grant prompt comes first, then
        // the per-action asks and the dispatch continue in the same call.
        grants.interact.clear()
        await (tools.bridge_fill.execute as any)({ pageId: 1, uid: "1_5", value: "Jane" }, execOptions())
        expect(ask).toHaveBeenCalledTimes(4)
        expect(ask.mock.calls[1]?.[0]).toMatchObject({ metadata: expect.objectContaining({ interactGrant: true }) })
        expect(ask.mock.calls[3]?.[0]).toMatchObject({ metadata: expect.objectContaining({ interactAction: true }) })
        expect(client.calls).toContain("fill")
        // A per-action call spends none of the fresh budget.
        expect(grants.interact.get(ORIGIN)).toBe(20)
      },
    })
  })

  test("a deny rule stops a per-action call before the interact grant is offered", async () => {
    await using tmp = await tmpdir()
    const profile = WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp
    WebMcpProfile.recordSnapshot(profile, 1, snapshotNodes(), PAGE)
    const grants: GrantState = { read: new Set([ORIGIN]), interact: new Map() }
    const client = fakeClient()
    vi.spyOn(ToolRegistry, "tools").mockResolvedValue([])
    vi.spyOn(MCP, "tools").mockResolvedValue(await bridgeTools(profile, grants, client))
    vi.spyOn(MCP, "checkWebMcpInteractGrant").mockResolvedValue({ ok: true })
    const grant = vi.spyOn(MCP, "grantWebMcpInteractOrigin").mockResolvedValue({ ok: true })
    const ask = vi.spyOn(Permission, "ask").mockResolvedValue(undefined)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const input = resolveInput("msg_turn_deny")
        input.agent = {
          name: "build",
          permission: [
            { permission: "*", pattern: "*", action: "allow" },
            { permission: "webmcp", pattern: "*", action: "deny" },
          ],
        } as never
        const tools = await resolveTools(input)
        await expect(
          (tools.bridge_fill.execute as any)({ pageId: 1, uid: "1_5", value: "Jane" }, execOptions()),
        ).rejects.toBeInstanceOf(Permission.DeniedError)
        expect(ask).not.toHaveBeenCalled()
        expect(grant).not.toHaveBeenCalled()
        expect(client.calls).not.toContain("fill")
      },
    })
  })

  test("a wait_for reservation is returned when the call never reaches the bridge and kept when it does", async () => {
    await using tmp = await tmpdir()
    const profile = WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp
    WebMcpProfile.recordSnapshot(profile, 1, snapshotNodes(), PAGE)
    const grants: GrantState = { read: new Set([ORIGIN]), interact: new Map([[ORIGIN, 20]]) }
    const client = fakeClient()
    vi.spyOn(ToolRegistry, "tools").mockResolvedValue([])
    vi.spyOn(MCP, "tools").mockResolvedValue(await bridgeTools(profile, grants, client))
    vi.spyOn(Permission, "ask").mockResolvedValue(undefined)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await resolveTools(resolveInput("msg_turn_wait"))
        const wait = (args: Record<string, unknown>) => (tools.bridge_wait_for.execute as any)(args, execOptions())
        // The page is gone before the bridge is asked to wait: four such
        // failures must not exhaust the 120 s per-turn wait budget.
        client.callTool.mockImplementation(async (request: { name: string }) => {
          client.calls.push(request.name)
          if (request.name === "list_pages") return { content: [], structuredContent: { pages: [] } }
          return { content: [{ type: "text", text: "ok" }], structuredContent: {} }
        })
        for (let i = 0; i < 5; i++) {
          await expect(wait({ pageId: 1, text: ["Saved"], timeout: 30_000 })).rejects.toThrow(
            "not in the bridge page list",
          )
        }
        expect(client.calls).not.toContain("wait_for")
        // Waits that reach the bridge keep their reservation: the fifth one
        // trips the per-turn budget.
        client.callTool.mockImplementation(async (request: { name: string }) => {
          client.calls.push(request.name)
          if (request.name === "list_pages") {
            return { content: [], structuredContent: { pages: [{ id: 1, url: PAGE, selected: true }] } }
          }
          return {
            content: [{ type: "text", text: "snapshot" }],
            structuredContent: { snapshot: { id: "1_0", role: "RootWebArea", name: "App" } },
          }
        })
        for (let i = 0; i < 4; i++) await wait({ pageId: 1, text: ["Saved"], timeout: 30_000 })
        expect(client.calls.filter((name) => name === "wait_for")).toHaveLength(4)
        await expect(wait({ pageId: 1, text: ["Saved"], timeout: 1 })).rejects.toThrow("wait_for budget for this turn")
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
