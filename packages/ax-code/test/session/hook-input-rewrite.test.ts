import { afterEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { jsonSchema } from "ai"
import { Instance } from "../../src/project/instance"
import { Plugin } from "../../src/plugin"
import { ToolRegistry } from "../../src/tool/registry"
import { Tool } from "../../src/tool/tool"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { LifecycleHooks } from "../../src/hooks/lifecycle"
import { effectiveInputForApproval, resolveTools } from "../../src/session/prompt/prompt-tools"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})

test.each([
  { invalid: false, askHook: false },
  { invalid: false, askHook: true },
  { invalid: true, askHook: false },
])(
  "native hook rewrites pass validation, permission and persisted metadata (case=%j)",
  async ({ invalid, askHook }) => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    await using tmp = await tmpdir()
    const secret = ["sk", "-", "a".repeat(40)].join("")
    const updatedInput = { command: invalid ? 42 : "echo rewritten", description: "test", password: secret }
    await fs.mkdir(path.join(tmp.path, ".ax-code"))
    await fs.writeFile(
      path.join(tmp.path, ".ax-code/hooks.json"),
      JSON.stringify({
        hooks: [
          {
            event: "PreToolUse",
            protocol: "claude-code",
            matcher: "bash",
            command: `node -e 'process.stdout.write(${JSON.stringify(JSON.stringify({ updatedInput, ...(askHook ? { hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "Confirm replacement" } } : {}) }))})'`,
          },
        ],
      }),
    )
    const executed: unknown[] = []
    const native = await Tool.define("bash", {
      description: "Rewrite test tool",
      parameters: z.object({ command: z.string(), description: z.string() }),
      execute: async (args, ctx) => {
        await ctx.ask({ permission: "bash", patterns: [args.command], always: [], metadata: {} })
        executed.push(args)
        await ctx.metadata({ metadata: { progress: true } })
        return { title: "test", output: "ok", metadata: { truncated: false } }
      },
    }).init()
    vi.spyOn(ToolRegistry, "tools").mockResolvedValue([{ id: "bash", ...native }])
    vi.spyOn(MCP, "tools").mockResolvedValue({})
    vi.spyOn(Plugin, "trigger").mockImplementation(async (_name, _input, output) => output)
    const ask = vi.spyOn(Permission, "ask").mockResolvedValue(undefined)
    const persist = vi.spyOn(Session, "updatePart").mockImplementation(async (part) => part)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: unknown[] = []
        const unsubscribe = Bus.subscribe(LifecycleHooks.Event.Completed, (event) => {
          events.push(event.properties)
        })
        const tools = await resolveTools({
          agent: { name: "build", permission: [] },
          session: { id: "ses_rewrite", permission: [] },
          model: { providerID: "test-provider", api: { id: "test-model", npm: "@ai-sdk/openai-compatible" } },
          tools: {},
          bypassAgentCheck: false,
          messages: [],
          isolation: { mode: "workspace-write", network: false, protected: [] },
          processor: {
            message: { id: "msg_rewrite" },
            partFromToolCall: () => ({
              id: "prt_rewrite",
              type: "tool",
              tool: "bash",
              sessionID: "ses_rewrite",
              messageID: "msg_rewrite",
              callID: "call_rewrite",
              state: { status: "running", input: { command: "echo original" }, time: { start: 1 } },
            }),
          },
        } as unknown as Parameters<typeof resolveTools>[0])
        const execution = tools.bash.execute!(
          { command: "echo original", description: "test" },
          { toolCallId: "call_rewrite", messages: [] },
        )
        if (invalid) {
          await expect(execution).rejects.toThrow(/hook node produced invalid input.*bash/)
          expect(executed).toEqual([])
          expect(ask).not.toHaveBeenCalled()
        } else {
          const result = (await execution) as Tool.InvocationResult
          expect(executed).toEqual([{ command: "echo rewritten", description: "test" }])
          expect(ask).toHaveBeenCalledWith(
            expect.objectContaining({
              patterns: ["echo rewritten"],
              metadata: expect.objectContaining({
                hookRewritten: true,
                effectiveInput: { command: "echo rewritten", description: "test" },
                changedFields: ["command"],
              }),
            }),
            expect.anything(),
          )
          expect(JSON.stringify(ask.mock.calls)).not.toContain("echo original")
          if (askHook)
            expect(ask.mock.calls[0]?.[0]).toMatchObject({
              permission: "hook",
              metadata: {
                hookRewritten: true,
                effectiveInput: { command: "echo rewritten" },
                changedFields: ["command"],
              },
            })
          expect(result.metadata.hookRewrite.hooks).toEqual(["node"])
          expect(result.metadata.hookRewrite.before).toContain("echo original")
          expect(result.metadata.hookRewrite.after).toContain("echo rewritten")
        }
        unsubscribe()
        expect(events).toContainEqual(expect.objectContaining({ outcome: "rewritten" }))
        expect(JSON.stringify(events)).not.toContain(secret)
        expect(persist).toHaveBeenCalled()
        expect(JSON.stringify(persist.mock.calls)).not.toContain(secret)
        for (const [part] of persist.mock.calls) {
          if (part.type === "tool" && part.state.status === "running")
            expect(part.state.metadata?.hookRewrite).toBeDefined()
        }
      },
    })
  },
)

test.each([
  { invalid: false, askHook: false },
  { invalid: false, askHook: true },
  { invalid: true, askHook: false },
])("MCP rewrite validation and permission patterns use the replacement (case=%j)", async ({ invalid, askHook }) => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  await using tmp = await tmpdir()
  await fs.mkdir(path.join(tmp.path, ".ax-code"))
  await fs.writeFile(
    path.join(tmp.path, ".ax-code/hooks.json"),
    JSON.stringify({
      hooks: [
        {
          event: "PreToolUse",
          protocol: "claude-code",
          matcher: "server_probe",
          command: `node -e 'process.stdout.write(${JSON.stringify(JSON.stringify({ updatedInput: { path: invalid ? 42 : "/new/path" }, ...(askHook ? { permissionDecision: "ask", reason: "Confirm replacement" } : {}) }))})'`,
        },
      ],
    }),
  )
  const execute = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] }))
  vi.spyOn(ToolRegistry, "tools").mockResolvedValue([])
  vi.spyOn(MCP, "tools").mockResolvedValue({
    server_probe: {
      inputSchema: jsonSchema({ type: "object", properties: { path: { type: "string" } }, required: ["path"] }),
      execute,
    },
  })
  vi.spyOn(Plugin, "trigger").mockImplementation(async (_name, _input, output) => output)
  const ask = vi.spyOn(Permission, "ask").mockResolvedValue(undefined)
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const tools = await resolveTools({
        agent: { name: "build", permission: [] },
        session: { id: "ses_rewrite", permission: [] },
        model: { providerID: "test-provider", api: { id: "test-model", npm: "@ai-sdk/openai-compatible" } },
        tools: {},
        bypassAgentCheck: false,
        messages: [],
        processor: { message: { id: "msg_rewrite" }, partFromToolCall: () => undefined },
      } as unknown as Parameters<typeof resolveTools>[0])
      const execution = tools.server_probe.execute!(
        { path: "/original/path" },
        { toolCallId: "call_rewrite", messages: [] },
      )
      if (invalid) {
        await expect(execution).rejects.toThrow(/hook node produced invalid input.*server_probe.*string/)
        expect(execute).not.toHaveBeenCalled()
        expect(ask).not.toHaveBeenCalled()
        return
      }
      await execution
      expect(execute).toHaveBeenCalledWith({ path: "/new/path" }, expect.anything())
      expect(ask.mock.calls[0]?.[0]).toMatchObject({
        metadata: {
          hookRewritten: true,
          effectiveInput: { path: "/new/path" },
          changedFields: ["path"],
        },
      })
      if (askHook) expect(ask.mock.calls[0]?.[0].permission).toBe("hook")
      for (const [request] of ask.mock.calls)
        expect(request.metadata).toMatchObject({
          hookRewritten: true,
          effectiveInput: { path: "/new/path" },
          changedFields: ["path"],
        })
      expect(JSON.stringify(ask.mock.calls)).toContain("/new/path")
      expect(JSON.stringify(ask.mock.calls)).not.toContain("/original/path")
    },
  })
})

test("effectiveInputForApproval keeps primitives, redacts and caps strings, and recursively redacts objects", () => {
  const secret = ["sk", "live-abcdefghijklmnopqrstuvwxyz0123456789"].join("-")
  const out = effectiveInputForApproval({
    filePath: "customer-data.csv",
    limit: 5,
    flag: true,
    command: `curl -H "Authorization: Bearer ${secret}" https://example.test`,
    long: "x".repeat(5_000),
    nested: { a: 1 },
    list: ["a", "b"],
  })
  expect(out.filePath).toBe("customer-data.csv")
  expect(out.limit).toBe(5)
  expect(out.flag).toBe(true)
  expect(String(out.command)).not.toContain(secret)
  expect((out.long as string).length).toBe(2_000)
  expect(out.nested).toEqual({ a: 1 })
  expect(out.list).toEqual(["a", "b"])
})

test("approval values recursively redact sensitive keys, including objects inside arrays", () => {
  const value = ["value", "one"].join("-")
  const out = effectiveInputForApproval({
    password: value,
    nested: { token: value, authorization: value },
    list: [{ api_key: value, secret: { hidden: value }, safe: "visible" }],
  })
  expect(out).toEqual({
    password: "[redacted]",
    nested: { token: "[redacted]", authorization: "[redacted]" },
    list: [{ api_key: "[redacted]", secret: "[redacted]", safe: "visible" }],
  })
  expect(JSON.stringify(out)).not.toContain(value)
})
