import { afterEach, expect, test, vi } from "vitest"
import { execute } from "../../src/codemode/interpreter"
import { Config } from "../../src/config/config"
import { Session } from "../../src/session"
import { SessionID, MessageID } from "../../src/session/schema"
import { ExecuteTool, codeModeToolIDs } from "../../src/tool/execute"
import type { Tool } from "../../src/tool/tool"

const ctx = (dispatcher: Tool.Dispatcher): Tool.Context => ({
  sessionID: SessionID.make("ses_code"),
  messageID: MessageID.make("msg_code"),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata() {},
  ask: async () => {},
  extra: { toolDispatcher: dispatcher },
})
afterEach(() => vi.restoreAllMocks())

test("dispatch receives detached JSON arguments and catchable message-only errors", async () => {
  const dispatch = vi.fn(async (_id: string, args: unknown) => {
    expect(args).toEqual({ path: "a" })
    throw new Error("Denied")
  })
  const result = await execute(
    "try{await tools.read({path:'a'})}catch(e){return [e.message,typeof e.stack,typeof e.name]}",
    { tools: ["read"], dispatch },
  )
  expect(result.output).toBe('["Denied","undefined","undefined"]')
  expect(dispatch).toHaveBeenCalledTimes(1)
})
test("tool count fails before dispatching beyond the ceiling", async () => {
  const dispatch = vi.fn(async () => ({}))
  const result = await execute("await tools.read({});await tools.read({})", {
    tools: ["read"],
    dispatch,
    limits: { max_tool_calls: 1 },
  })
  expect(result.diagnostic).toMatchObject({ error: "LimitExceeded", limit: "tool_calls" })
  expect(dispatch).toHaveBeenCalledTimes(1)
})
test("Promise.all starts independent tool calls concurrently", async () => {
  let started = 0
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  const result = await execute("await Promise.all([tools.read({n:1}),tools.read({n:2})])", {
    tools: ["read"],
    dispatch: async (_, args) => {
      if (++started === 2) release()
      await ready
      return args
    },
  })
  expect(result.output).toBe('[{"n":1},{"n":2}]')
})
test("tool results are bounded before program access", async () => {
  const result = await execute("await tools.read({})", {
    tools: ["read"],
    dispatch: async () => ({ text: "x".repeat(100) }),
    limits: { max_string_bytes: 20 },
  })
  expect(result.diagnostic?.limit).toBe("string_bytes")
})
test("execute reuses the Batch barrier, records parts, and blocks orchestrators", async () => {
  vi.spyOn(Config, "get").mockResolvedValue({ code_mode: { enabled: true } })
  const parts = vi
    .spyOn(Session, "updatePart")
    .mockImplementation(async (part) => part as Awaited<ReturnType<typeof Session.updatePart>>)
  let active = 0,
    reads = 0,
    maxReads = 0
  const events: string[] = []
  const dispatcher: Tool.Dispatcher = {
    ids: ["read", "write", "execute", "task", "task_parallel", "council", "arena", "batch"],
    concurrencySafe: ({ tool }) => tool === "read",
    async execute({ tool, parameters }) {
      const n = (parameters as { n: number }).n
      if (tool === "write") expect(active).toBe(0)
      active++
      if (tool === "read") maxReads = Math.max(maxReads, ++reads)
      events.push(`start:${n}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
      events.push(`end:${n}`)
      active--
      if (tool === "read") reads--
      return { title: tool, output: String(n), metadata: {} }
    },
  }
  const tool = await ExecuteTool.init()
  const result = await tool.execute(
    {
      code: "await Promise.all([tools.read({n:1}),tools.read({n:2}),tools.write({n:3}),tools.write({n:4}),tools.read({n:5})])",
    },
    ctx(dispatcher),
  )
  expect(result.metadata.toolCalls).toBe(5)
  expect(maxReads).toBe(2)
  expect(events.indexOf("start:3")).toBeGreaterThan(events.indexOf("end:1"))
  expect(events.indexOf("start:3")).toBeGreaterThan(events.indexOf("end:2"))
  expect(events.indexOf("start:4")).toBeGreaterThan(events.indexOf("end:3"))
  expect(events.indexOf("start:5")).toBeGreaterThan(events.indexOf("end:4"))
  expect(parts.mock.calls.filter(([part]) => part.type === "tool" && part.state.status === "running")).toHaveLength(5)
  expect(parts.mock.calls.filter(([part]) => part.type === "tool" && part.state.status === "completed")).toHaveLength(5)
  expect(codeModeToolIDs(dispatcher.ids)).toEqual(["read", "write"])
  expect(
    codeModeToolIDs(["read", "question", "plan_exit", "browser_workflow", "read_recipe", "invalid", "write"]),
  ).toEqual(["read", "write"])
  for (const name of ["execute", "task", "task_parallel", "council", "arena", "batch", "question", "plan_exit"]) {
    expect((await tool.execute({ code: `typeof tools.${name}` }, ctx(dispatcher))).output).toBe('"undefined"')
  }
})
test("an unawaited tool finishes before execute returns", async () => {
  let done = false
  const result = await execute("tools.read({}); return 1", {
    tools: ["read"],
    dispatch: async () => {
      await new Promise((r) => setTimeout(r, 5))
      done = true
      return {}
    },
  })
  expect(result.output).toBe("1")
  expect(done).toBe(true)
})
test("disabled code mode and missing dispatcher fail closed", async () => {
  const tool = await ExecuteTool.init()
  vi.spyOn(Config, "get").mockResolvedValue({})
  await expect(
    tool.execute({ code: "1" }, ctx({ ids: [], execute: async () => ({ title: "", output: "", metadata: {} }) })),
  ).rejects.toThrow("disabled")
  vi.spyOn(Config, "get").mockResolvedValue({ code_mode: { enabled: true } })
  const context = ctx({ ids: [], execute: async () => ({ title: "", output: "", metadata: {} }) })
  context.extra = {}
  await expect(tool.execute({ code: "1" }, context)).rejects.toThrow("dispatcher")
})

test("nested parts and execute source redact credentials without changing dispatch args", async () => {
  const { SessionProcessor } = await import("../../src/session/processor")
  const secret = ["sk", "-", "a".repeat(40)].join("")
  const code = `await tools.read({password:'${secret}'})`
  expect(JSON.stringify(SessionProcessor.redactPersistedToolInput("execute", { code }))).not.toContain(secret)
  vi.spyOn(Config, "get").mockResolvedValue({ code_mode: { enabled: true } })
  const parts = vi
    .spyOn(Session, "updatePart")
    .mockImplementation(async (part) => part as Awaited<ReturnType<typeof Session.updatePart>>)
  const dispatcher: Tool.Dispatcher = {
    ids: ["read"],
    execute: async ({ parameters }) => {
      expect(parameters).toEqual({ password: secret })
      return { title: "", output: "ok", metadata: {} }
    },
  }
  const tool = await ExecuteTool.init()
  await tool.execute({ code }, ctx(dispatcher))
  expect(JSON.stringify(parts.mock.calls)).not.toContain(secret)
})
