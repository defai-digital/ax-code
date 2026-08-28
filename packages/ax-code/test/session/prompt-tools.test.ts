import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import z from "zod"
import { Agent } from "../../src/agent/agent"
import { ProviderTransform } from "../../src/provider/transform"
import { Instance } from "../../src/project/instance"
import {
  collectMcpToolContent,
  collectMcpToolResult,
  resolveTools,
  runToolLifecycle,
  shouldBypassAgentCheck,
  transformMcpInputSchema,
} from "../../src/session/prompt-tools"
import { tmpdir } from "../fixture/fixture"
import { Plugin } from "../../src/plugin"
import { LifecycleHooks } from "../../src/hooks/lifecycle"
import { ToolRegistry } from "../../src/tool/registry"
import { MCP } from "../../src/mcp"
import { BatchTool } from "../../src/tool/batch"
import { Isolation } from "../../src/isolation"
import { Permission } from "../../src/permission"
import { Session } from "../../src/session"

describe("session.prompt-tools", () => {
  let schemaSpy: MockInstance | undefined

  afterEach(async () => {
    vi.restoreAllMocks()
    schemaSpy = undefined
    await Instance.disposeAll()
  })

  test("bypasses agent checks only when the turn explicitly includes an agent part", () => {
    expect(shouldBypassAgentCheck(undefined)).toBe(false)
    expect(shouldBypassAgentCheck([{ type: "text", text: "hello" } as any])).toBe(false)
    expect(
      shouldBypassAgentCheck([{ type: "text", text: "hello" } as any, { type: "agent", name: "build" } as any]),
    ).toBe(true)
  })

  test("collects MCP tool text with binary placeholders instead of raw model-facing blobs", () => {
    const result = collectMcpToolContent([
      { type: "text", text: "visible text" },
      { type: "image", mimeType: "image/png", data: "abc123" },
      {
        type: "resource",
        resource: {
          uri: "secret://large",
          mimeType: "application/octet-stream",
          blob: "rawblob",
        },
      },
    ])

    expect(result.textParts).toEqual([
      "visible text",
      "[Image content: image/png]",
      "[Binary MCP resource: secret://large (application/octet-stream)]",
    ])
    expect(result.attachments).toHaveLength(2)
    expect(result.attachments[1]).toMatchObject({
      filename: "secret://large",
      mime: "application/octet-stream",
    })
  })

  test("image content block produces a valid data URL FilePart for TUI screenshot rendering", () => {
    const b64 = Buffer.from("fake-png-bytes").toString("base64")
    const result = collectMcpToolContent([{ type: "image", mimeType: "image/png", data: b64 }])

    expect(result.textParts).toEqual(["[Image content: image/png]"])
    expect(result.attachments).toHaveLength(1)

    const attachment = result.attachments[0]!
    expect(attachment.type).toBe("file")
    expect(attachment.mime).toBe("image/png")
    expect(attachment.url).toBe(`data:image/png;base64,${b64}`)
    // Images have no filename — they render inline via the data URL
    expect(attachment.filename).toBeUndefined()
  })

  test("uses structuredContent only when MCP content is empty", () => {
    const both = collectMcpToolResult({
      content: [{ type: "text", text: "visible" }],
      structuredContent: { ignored: true },
    })
    expect(both.textParts).toEqual(["visible"])

    const structuredOnly = collectMcpToolResult({
      content: [],
      structuredContent: { ok: true, count: 2 },
    })
    expect(structuredOnly.textParts).toEqual(['{"ok":true,"count":2}'])

    const empty = collectMcpToolResult({ content: [{ type: "text", text: "  " }], structuredContent: {} })
    expect(empty.textParts).toEqual([])
  })

  test("browser_screenshot image block (no explicit mimeType) defaults to image/png", () => {
    // @playwright/mcp browser_screenshot returns type:"image" without mimeType
    const b64 = Buffer.from("screenshot-bytes").toString("base64")
    const result = collectMcpToolContent([{ type: "image", data: b64 } as any])

    expect(result.attachments).toHaveLength(1)
    const attachment = result.attachments[0]!
    expect(attachment.mime).toBe("image/png")
    expect(attachment.url).toMatch(/^data:image\/png;base64,/)
  })

  test("deduplicates concurrent MCP schema transforms for the same cache key", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = {
          id: "test-model",
          providerID: "test-provider",
          api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
        } as any
        const inputSchema = z.object({ query: z.string() })
        const cacheKey = `mcp:test-tool:${Date.now()}:${Math.random()}`
        const originalSchema = ProviderTransform.schema
        schemaSpy = vi
          .spyOn(ProviderTransform, "schema")
          .mockImplementation((modelArg, schemaArg) => originalSchema(modelArg, schemaArg))

        const [first, second] = await Promise.all([
          transformMcpInputSchema({ cacheKey, model, inputSchema }),
          transformMcpInputSchema({ cacheKey, model, inputSchema }),
        ])

        expect(first).toBe(second)
        expect(schemaSpy).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("keeps transformed schemas isolated between live instances", async () => {
    await using alpha = await tmpdir()
    await using beta = await tmpdir()
    const model = {
      id: "test-model",
      providerID: "test-provider",
      api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
    } as any
    const cacheKey = "mcp:same-tool:same-model"

    const alphaSchema = await Instance.provide({
      directory: alpha.path,
      fn: () => transformMcpInputSchema({ cacheKey, model, inputSchema: z.object({ alpha: z.string() }) }),
    })
    const betaSchema = await Instance.provide({
      directory: beta.path,
      fn: () => transformMcpInputSchema({ cacheKey, model, inputSchema: z.object({ beta: z.string() }) }),
    })

    expect(alphaSchema.properties).toHaveProperty("alpha")
    expect(alphaSchema.properties).not.toHaveProperty("beta")
    expect(betaSchema.properties).toHaveProperty("beta")
    expect(betaSchema.properties).not.toHaveProperty("alpha")
  })

  test("invalidates transformed schema identity when a same-name MCP schema changes", async () => {
    await using tmp = await tmpdir()
    const model = {
      id: "test-model",
      providerID: "test-provider",
      api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
    } as any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await transformMcpInputSchema({
          cacheKey: "mcp:changing-tool:same-model",
          model,
          inputSchema: z.object({ before: z.string() }),
        })
        const second = await transformMcpInputSchema({
          cacheKey: "mcp:changing-tool:same-model",
          model,
          inputSchema: z.object({ after: z.number() }),
        })

        expect(first.properties).toHaveProperty("before")
        expect(second.properties).toHaveProperty("after")
        expect(second.properties).not.toHaveProperty("before")
      },
    })
  })

  test("keys schema transforms by the full model transformation identity", async () => {
    await using tmp = await tmpdir()
    schemaSpy = vi.spyOn(ProviderTransform, "schema").mockImplementation(
      (model, schema) =>
        ({
          ...(schema as Record<string, unknown>),
          "x-test-model": model.id,
        }) as any,
    )
    const base = {
      providerID: "shared-provider",
      api: { id: "shared-api", npm: "@ai-sdk/openai-compatible", url: "https://example.test" },
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const standard = await transformMcpInputSchema({
          cacheKey: "mcp:model-sensitive",
          model: { ...base, id: "standard-model" } as any,
          inputSchema: z.object({ value: z.string() }),
        })
        const kimi = await transformMcpInputSchema({
          cacheKey: "mcp:model-sensitive",
          model: { ...base, id: "kimi-model" } as any,
          inputSchema: z.object({ value: z.string() }),
        })

        expect(standard["x-test-model"]).toBe("standard-model")
        expect(kimi["x-test-model"]).toBe("kimi-model")
        expect(schemaSpy).toHaveBeenCalledTimes(2)
      },
    })
  })

  test("runs plugin and lifecycle hooks in canonical order", async () => {
    await using tmp = await tmpdir()
    const order: string[] = []
    vi.spyOn(Plugin, "trigger").mockImplementation((async (name: string, _input: unknown, output: unknown) => {
      if (name === "tool.execute.before") order.push("plugin:before")
      if (name === "tool.execute.after") order.push("plugin:after")
      return output
    }) as any)
    vi.spyOn(LifecycleHooks, "runForWorkspace").mockImplementation(async ({ event }) => {
      order.push(`lifecycle:${event}`)
      return { ok: true, blocked: false, outputs: [] }
    })

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        runToolLifecycle({
          toolID: "example",
          sessionID: "ses_lifecycle",
          callID: "call_lifecycle",
          args: { value: 1 },
          cwd: tmp.path,
          async execute() {
            order.push("execute")
            return "done"
          },
        }),
    })

    expect(result).toBe("done")
    expect(order).toEqual(["plugin:before", "lifecycle:PreToolUse", "execute", "plugin:after", "lifecycle:PostToolUse"])
  })

  test("stops execution when PreToolUse blocks", async () => {
    await using tmp = await tmpdir()
    const execute = vi.fn(async () => "unexpected")
    const plugin = vi
      .spyOn(Plugin, "trigger")
      .mockImplementation((async (_name: string, _input: unknown, output: unknown) => output) as any)
    vi.spyOn(LifecycleHooks, "runForWorkspace").mockImplementation(async ({ event }) => ({
      ok: false,
      blocked: event === "PreToolUse",
      outputs: event === "PreToolUse" ? [{ command: "deny", exit: 1, stdout: "", stderr: "policy denied" }] : [],
    }))

    await expect(
      Instance.provide({
        directory: tmp.path,
        fn: () =>
          runToolLifecycle({
            toolID: "blocked",
            sessionID: "ses_blocked",
            callID: "call_blocked",
            args: {},
            cwd: tmp.path,
            execute,
          }),
      }),
    ).rejects.toThrow("PreToolUse hook blocked tool blocked: policy denied")

    expect(execute).not.toHaveBeenCalled()
    expect(plugin.mock.calls.map(([name]) => name)).toEqual(["tool.execute.before"])
  })

  test("preserves direct lifecycle, attachments, and interactive isolation escalation", async () => {
    await using tmp = await tmpdir()
    const events: string[] = []
    const deniedPath = `${tmp.path}-outside/direct-probe.txt`
    let attempts = 0
    let afterPayload: unknown
    const execute = vi.fn(async (_args: unknown, ctx: any) => {
      attempts++
      events.push(`execute:${attempts}`)
      if (!ctx.extra?.isolation?.bypass?.includes(deniedPath)) {
        throw new Isolation.DeniedError("write", "outside workspace", deniedPath)
      }
      return {
        title: "Direct probe",
        output: "ok",
        metadata: {},
        attachments: [
          {
            type: "file" as const,
            mime: "text/plain",
            filename: "probe.txt",
            url: "data:text/plain,ok",
          },
        ],
      }
    })
    vi.spyOn(ToolRegistry, "tools").mockResolvedValue([
      {
        id: "direct_probe",
        description: "direct probe",
        parameters: z.object({}),
        execute,
      },
    ] as any)
    vi.spyOn(MCP, "tools").mockResolvedValue({})
    vi.spyOn(Plugin, "trigger").mockImplementation((async (name: string, _input: unknown, output: unknown) => {
      if (name === "tool.execute.before") events.push("plugin:before")
      if (name === "tool.execute.after") {
        events.push("plugin:after")
        afterPayload = output
      }
      return output
    }) as any)
    vi.spyOn(LifecycleHooks, "runForWorkspace").mockImplementation(async ({ event }) => {
      events.push(`lifecycle:${event}`)
      return { ok: true, blocked: false, outputs: [] }
    })
    const ask = vi.spyOn(Permission, "ask").mockImplementation(async (request) => {
      events.push(`permission:${request.permission}`)
    })

    const result = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await resolveTools({
          agent: { name: "build", permission: [{ permission: "*", pattern: "*", action: "allow" }] } as any,
          session: { id: "ses_direct", permission: [] } as any,
          model: {
            providerID: "test-provider",
            api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
          } as any,
          tools: {},
          bypassAgentCheck: false,
          messages: [],
          isolation: { mode: "workspace-write", network: true, protected: [] },
          processor: { message: { id: "msg_direct" }, partFromToolCall: () => undefined } as any,
        })
        return (tools.direct_probe.execute as any)(
          {},
          { toolCallId: "call_direct", abortSignal: new AbortController().signal },
        )
      },
    })

    expect(execute).toHaveBeenCalledTimes(2)
    expect(events).toEqual([
      "plugin:before",
      "lifecycle:PreToolUse",
      "execute:1",
      "permission:isolation_escalation",
      "execute:2",
      "plugin:after",
      "lifecycle:PostToolUse",
    ])
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "isolation_escalation",
        patterns: ["outside workspace"],
        metadata: expect.objectContaining({ path: deniedPath, requireInteractive: true }),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.attachments).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        sessionID: "ses_direct",
        messageID: "msg_direct",
        filename: "probe.txt",
      }),
    ])
    expect(afterPayload).toMatchObject({ attachments: result.attachments })
  })

  test("applies canonical lifecycle hooks to MCP execution", async () => {
    await using tmp = await tmpdir()
    const events: string[] = []
    let afterPayload: unknown
    let afterCallID: unknown
    const execute = vi.fn(async () => ({ content: [{ type: "text", text: "hello" }] }))
    vi.spyOn(ToolRegistry, "tools").mockResolvedValue([])
    vi.spyOn(MCP, "tools").mockResolvedValue({
      remote_echo: {
        description: "echo",
        inputSchema: z.object({ text: z.string() }),
        execute,
      } as any,
    })
    vi.spyOn(Plugin, "trigger").mockImplementation((async (name: string, hookInput: any, output: unknown) => {
      if (name.startsWith("tool.execute.")) events.push(name)
      if (name === "tool.execute.after") {
        afterPayload = output
        afterCallID = hookInput.callID
      }
      return output
    }) as any)
    vi.spyOn(LifecycleHooks, "runForWorkspace").mockImplementation(async ({ event }) => {
      events.push(event)
      return { ok: true, blocked: false, outputs: [] }
    })
    const ask = vi.spyOn(Permission, "ask").mockResolvedValue(undefined)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await resolveTools({
          agent: { name: "build", permission: [{ permission: "*", pattern: "*", action: "allow" }] } as any,
          session: { id: "ses_mcp", permission: [] } as any,
          model: {
            providerID: "test-provider",
            api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
          } as any,
          tools: {},
          bypassAgentCheck: false,
          messages: [],
          processor: {
            message: { id: "msg_mcp" },
            partFromToolCall: () => undefined,
          } as any,
        })

        await (tools.remote_echo.execute as any)(
          { text: "hello" },
          {
            toolCallId: "call_mcp",
            abortSignal: new AbortController().signal,
          },
        )
      },
    })

    expect(execute).toHaveBeenCalledOnce()
    expect(events).toEqual(["tool.execute.before", "PreToolUse", "tool.execute.after", "PostToolUse"])
    expect(afterPayload).toEqual({ content: [{ type: "text", text: "hello" }] })
    expect(afterCallID).toBe("call_mcp")
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "remote_echo",
        sessionID: "ses_mcp",
        tool: { messageID: "msg_mcp", callID: "call_mcp" },
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  test("gives Batch only final-visible registry tools with lifecycle, permissions, and fail-closed isolation", async () => {
    await using tmp = await tmpdir()
    const events: Array<{ tool: string; phase: string }> = []
    const batch = await BatchTool.init()
    let batchDispatcherIDs: string[] | undefined
    const permittedExecute = vi.fn(async (_args: unknown, ctx: any) => {
      await ctx.ask({ permission: "read", patterns: ["visible"], always: [], metadata: {} })
      return { title: "Permitted", output: "ok", metadata: {} }
    })
    const deniedExecute = vi.fn(async () => {
      throw new Isolation.DeniedError("write", "blocked", "/outside")
    })
    const hiddenBashExecute = vi.fn(async () => ({ title: "", output: "unsafe", metadata: {} }))
    const isolationHiddenExecute = vi.fn(async () => ({ title: "", output: "isolation bypass", metadata: {} }))
    const configHiddenExecute = vi.fn(async () => ({ title: "", output: "config bypass", metadata: {} }))
    const permissionHiddenExecute = vi.fn(async () => ({ title: "", output: "permission bypass", metadata: {} }))
    const taskExecute = vi.fn(async () => ({ title: "", output: "task bypass", metadata: {} }))
    const mcpExecute = vi.fn(async () => ({ content: [{ type: "text", text: "mcp bypass" }] }))
    const isolationDisabledIDs = ["edit", "write", "apply_patch", "multiedit", "webfetch", "websearch", "codesearch"]
    vi.spyOn(ToolRegistry, "tools").mockResolvedValue([
      {
        id: "batch",
        ...batch,
        execute: async (args: any, ctx: any) => {
          batchDispatcherIDs = [...ctx.extra.toolDispatcher.ids]
          return batch.execute(args, ctx)
        },
      },
      {
        id: "permitted",
        description: "permitted child",
        parameters: z.object({}),
        execute: permittedExecute,
      },
      {
        id: "denied",
        description: "always denied",
        parameters: z.object({}),
        execute: deniedExecute,
      },
      {
        id: "bash",
        description: "hidden in read-only mode",
        parameters: z.object({ command: z.string() }),
        execute: hiddenBashExecute,
      },
      ...isolationDisabledIDs.map((id) => ({
        id,
        description: "hidden by isolation policy",
        parameters: z.object({}),
        execute: isolationHiddenExecute,
      })),
      {
        id: "config_hidden",
        description: "disabled by turn config",
        parameters: z.object({}),
        execute: configHiddenExecute,
      },
      {
        id: "permission_hidden",
        description: "disabled by permission ruleset",
        parameters: z.object({}),
        execute: permissionHiddenExecute,
      },
      {
        id: "task",
        description: "task stays direct-only",
        parameters: z.object({}),
        execute: taskExecute,
      },
    ] as any)
    vi.spyOn(MCP, "tools").mockResolvedValue({
      remote_echo: {
        description: "MCP stays direct-only",
        inputSchema: z.object({}),
        execute: mcpExecute,
      } as any,
    })
    vi.spyOn(Session, "updatePart").mockImplementation(async (part) => part as any)
    const ask = vi.spyOn(Permission, "ask").mockResolvedValue(undefined)
    vi.spyOn(Plugin, "trigger").mockImplementation((async (name: string, hookInput: any, output: unknown) => {
      if (name === "tool.execute.before") events.push({ tool: hookInput.tool, phase: "plugin:before" })
      if (name === "tool.execute.after") events.push({ tool: hookInput.tool, phase: "plugin:after" })
      return output
    }) as any)
    vi.spyOn(LifecycleHooks, "runForWorkspace").mockImplementation(async ({ event, tool }) => {
      events.push({ tool: tool!, phase: event! })
      return { ok: true, blocked: false, outputs: [] }
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await resolveTools({
          agent: {
            name: "build",
            permission: [
              { permission: "*", pattern: "*", action: "allow" },
              { permission: "permission_hidden", pattern: "*", action: "deny" },
            ],
          } as any,
          session: { id: "ses_batch_policy", permission: [] } as any,
          model: {
            providerID: "test-provider",
            api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
          } as any,
          tools: { config_hidden: false },
          bypassAgentCheck: false,
          messages: [],
          isolation: { mode: "read-only", network: false, protected: [] },
          processor: {
            message: { id: "msg_batch_policy" },
            partFromToolCall: () => undefined,
          } as any,
        })

        expect(tools.bash).toBeUndefined()
        for (const id of isolationDisabledIDs) expect(tools[id]).toBeUndefined()
        expect(tools.config_hidden).toBeUndefined()
        expect(tools.permission_hidden).toBeUndefined()
        expect(tools.task).toBeDefined()
        expect(tools.remote_echo).toBeDefined()
        const result = await (tools.batch.execute as any)(
          {
            tool_calls: [
              { tool: "permitted", parameters: {} },
              { tool: "denied", parameters: {} },
              { tool: "bash", parameters: { command: "pwd" } },
              ...isolationDisabledIDs.map((tool) => ({ tool, parameters: {} })),
              { tool: "config_hidden", parameters: {} },
              { tool: "permission_hidden", parameters: {} },
              { tool: "task", parameters: {} },
              { tool: "remote_echo", parameters: {} },
              { tool: "batch", parameters: { tool_calls: [{ tool: "permitted", parameters: {} }] } },
            ],
          },
          { toolCallId: "call_batch_policy", abortSignal: new AbortController().signal },
        )
        expect(result.metadata).toMatchObject({ totalCalls: 15, successful: 1, failed: 14 })
      },
    })

    expect(batchDispatcherIDs).toEqual(["permitted", "denied"])
    const phases = (tool: string) => events.filter((event) => event.tool === tool).map((event) => event.phase)
    expect(phases("batch")).toEqual(["plugin:before", "PreToolUse", "plugin:after", "PostToolUse"])
    expect(phases("permitted")).toEqual(["plugin:before", "PreToolUse", "plugin:after", "PostToolUse"])
    expect(phases("denied")).toEqual(["plugin:before", "PreToolUse"])
    for (const hidden of [
      "bash",
      ...isolationDisabledIDs,
      "config_hidden",
      "permission_hidden",
      "task",
      "remote_echo",
    ]) {
      expect(phases(hidden)).toEqual([])
    }
    expect(permittedExecute).toHaveBeenCalledOnce()
    expect(deniedExecute).toHaveBeenCalledOnce()
    expect(hiddenBashExecute).not.toHaveBeenCalled()
    expect(isolationHiddenExecute).not.toHaveBeenCalled()
    expect(configHiddenExecute).not.toHaveBeenCalled()
    expect(permissionHiddenExecute).not.toHaveBeenCalled()
    expect(taskExecute).not.toHaveBeenCalled()
    expect(mcpExecute).not.toHaveBeenCalled()
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "read", patterns: ["visible"] }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(ask.mock.calls.some(([request]) => request.permission === "isolation_escalation")).toBe(false)
  })

  test("does not expose the Batch dispatcher capability to ordinary tools", async () => {
    await using tmp = await tmpdir()
    let exposed: unknown
    vi.spyOn(ToolRegistry, "tools").mockResolvedValue([
      {
        id: "probe",
        description: "probe context",
        parameters: z.object({}),
        execute: async (_args: unknown, ctx: any) => {
          exposed = ctx.extra?.toolDispatcher
          return { title: "", output: "ok", metadata: {} }
        },
      },
    ] as any)
    vi.spyOn(MCP, "tools").mockResolvedValue({})
    vi.spyOn(Plugin, "trigger").mockImplementation(
      (async (_name: string, _input: unknown, output: unknown) => output) as any,
    )
    vi.spyOn(LifecycleHooks, "runForWorkspace").mockResolvedValue({ ok: true, blocked: false, outputs: [] })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await resolveTools({
          agent: { name: "build", permission: [{ permission: "*", pattern: "*", action: "allow" }] } as any,
          session: { id: "ses_probe", permission: [] } as any,
          model: {
            providerID: "test-provider",
            api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
          } as any,
          tools: {},
          bypassAgentCheck: false,
          messages: [],
          processor: { message: { id: "msg_probe" }, partFromToolCall: () => undefined } as any,
        })
        await (tools.probe.execute as any)(
          {},
          {
            toolCallId: "call_probe",
            abortSignal: new AbortController().signal,
          },
        )
      },
    })

    expect(exposed).toBeUndefined()
  })

  test("filters tools denied by the active agent ruleset", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("compaction")
        expect(agent).toBeDefined()

        const tools = await resolveTools({
          agent: agent!,
          session: { id: "ses_test", permission: [] } as any,
          model: {
            providerID: "test-provider",
            api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
          } as any,
          tools: {},
          bypassAgentCheck: false,
          messages: [],
          processor: {
            message: { id: "msg_test" },
            partFromToolCall: () => undefined,
          } as any,
        })

        expect(Object.keys(tools)).toEqual([])
      },
    })
  })
})
