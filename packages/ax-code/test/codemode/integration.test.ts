import { afterEach, expect, test, vi } from "vitest"
import z from "zod"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Tool } from "../../src/tool/tool"
import { ToolRegistry } from "../../src/tool/registry"
import { resolveTools, toolGateMode } from "../../src/session/prompt/prompt-tools"
import { Permission } from "../../src/permission"
import { Session } from "../../src/session"
import { SessionID, MessageID } from "../../src/session/schema"
import { MCP } from "../../src/mcp"
import { LifecycleHooks } from "../../src/hooks/lifecycle"
import { Plugin } from "../../src/plugin"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

test("real registry Code Mode uses permission, hooks, normal parts and MCP wrappers", async () => {
  await using tmp = await tmpdir()
  vi.spyOn(Config, "get").mockResolvedValue({ code_mode: { enabled: true } })
  const parts = vi
    .spyOn(Session, "updatePart")
    .mockImplementation(async (part) => part as Awaited<ReturnType<typeof Session.updatePart>>)
  vi.spyOn(MCP, "tools").mockResolvedValue({
    remote_echo: {
      description: "Echo",
      inputSchema: z.object({}),
      execute: async () => ({ content: [{ type: "text", text: "remote result" }] }),
    },
  })
  let rewrite = false
  let hookAsk = false
  const hooks = vi.spyOn(LifecycleHooks, "runForWorkspace").mockImplementation(async ({ event, tool }) => ({
    ok: true,
    blocked: false,
    outputs: [],
    ...(rewrite && event === "PreToolUse" && tool === "code_probe"
      ? { rewrite: { hooks: ["test-hook"], updatedInput: { path: "secret" } } }
      : {}),
    ...(hookAsk && event === "PreToolUse" && tool === "code_probe" ? { ask: { reason: "Needs approval" } } : {}),
  }))
  vi.spyOn(LifecycleHooks, "resolveHooks").mockResolvedValue([
    {
      event: "PreToolUse",
      protocol: "claude-code",
      matcher: "code_probe",
      command: "test-hook",
      blockOnFailure: false,
    },
  ])
  vi.spyOn(Plugin, "trigger").mockImplementation(async (_event, _input, output) => output)
  const ask = vi.spyOn(Permission, "ask")
  const effects: string[] = []
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const unregister = await ToolRegistry.register(
        Tool.define("code_probe", {
          description: "Read-like permission probe",
          parameters: z.object({ path: z.string() }),
          concurrencySafe: () => true,
          async execute(args, ctx) {
            await ctx.ask({ permission: "read", patterns: [args.path], always: [], metadata: {} })
            effects.push(args.path)
            return { title: "Probe", output: args.path, metadata: {} }
          },
        }),
      )
      try {
        const input = {
          agent: {
            name: "build",
            mode: "primary",
            options: {},
            permission: [
              { permission: "*", pattern: "*", action: "allow" },
              { permission: "read", pattern: "secret", action: "deny" },
            ],
          },
          session: { id: SessionID.make("ses_code_integration"), permission: [] },
          model: {
            id: ModelID.make("test-model"),
            providerID: ProviderID.make("test-provider"),
            api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
          },
          tools: {},
          bypassAgentCheck: false,
          messages: [],
          isolation: { mode: "workspace-write", network: true, protected: [] },
          processor: { message: { id: MessageID.make("msg_code_integration") }, partFromToolCall: () => undefined },
        } as unknown as Parameters<typeof resolveTools>[0]
        const tools = await resolveTools(input)
        expect(tools.execute).toBeDefined()
        expect(tools.execute.description).toContain("code_probe:")
        expect(tools.execute.description).toContain('"path"')
        expect(toolGateMode({ toolID: "execute", args: { code: "1" } })).toBe("exclusive")
        const run = async (code: string) =>
          tools.execute.execute!(
            { code },
            { toolCallId: "code_call", abortSignal: new AbortController().signal, messages: [] },
          ) as Promise<Tool.InvocationResult>
        const denied = await run(
          "try{await tools.code_probe({path:'secret'})}catch(e){return {message:e.message,stack:e.stack}}",
        )
        expect(denied.output).toContain("message")
        expect(denied.output).not.toContain('"stack"')
        expect(effects).toEqual([])
        expect(
          ask.mock.calls.some(([request]) => request.permission === "read" && request.patterns.includes("secret")),
        ).toBe(true)
        expect((await run("(await tools.code_probe({path:'public'})).output")).output).toBe('"public"')
        expect(effects).toEqual(["public"])
        expect((await run("(await tools.remote_echo({})).output")).output).toContain("remote result")
        expect(ask.mock.calls.some(([request]) => request.permission === "remote_echo")).toBe(true)
        expect(
          hooks.mock.calls.some(([request]) => request.event === "PreToolUse" && request.tool === "code_probe"),
        ).toBe(true)
        expect(
          parts.mock.calls.some(
            ([part]) => part.type === "tool" && part.tool === "code_probe" && part.state.status === "error",
          ),
        ).toBe(true)
        expect(
          parts.mock.calls.some(
            ([part]) => part.type === "tool" && part.tool === "code_probe" && part.state.status === "completed",
          ),
        ).toBe(true)
        rewrite = true
        const rewritten = await run("try{await tools.code_probe({path:'public'})}catch(e){return e.message}")
        expect(rewritten.output).toContain("read")
        expect(effects).toEqual(["public"])
        const lastReadAsk = ask.mock.calls.filter(([request]) => request.permission === "read").at(-1)![0]
        expect(lastReadAsk.patterns).toEqual(["secret"])
        expect(lastReadAsk.metadata).toMatchObject({ hookRewritten: true, effectiveInput: { path: "secret" } })
        expect(
          parts.mock.calls.some(
            ([part]) =>
              part.type === "tool" &&
              part.tool === "code_probe" &&
              part.state.status === "error" &&
              part.state.metadata?.hookRewrite,
          ),
        ).toBe(true)
        rewrite = false
        hookAsk = true
        ask.mockRejectedValueOnce(new Error("Hook approval denied"))
        expect((await run("try{await tools.code_probe({path:'public'})}catch(e){return e.message}")).output).toBe(
          '"Hook approval denied"',
        )
        expect(ask.mock.calls.at(-1)![0].permission).toBe("hook")
        expect(effects).toEqual(["public"])
        hookAsk = false
        const deniedTools = await resolveTools({ ...input, tools: { code_probe: false, question: false } })
        const result = (await deniedTools.execute.execute!(
          { code: "[typeof tools.code_probe,typeof tools.question]" },
          { toolCallId: "hidden", messages: [] },
        )) as Tool.InvocationResult
        expect(result.output).toBe('["undefined","undefined"]')
      } finally {
        unregister()
      }
    },
  })
})
