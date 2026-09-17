import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID } from "../../src/session/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { TaskParallelTool } from "../../src/tool/task_parallel"
import { WriteIsolation } from "../../src/session/write-isolation"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

/**
 * task_parallel integration with LLM sessions is covered by smoke dogfood.
 * Unit coverage here locks the write-isolation gate the tool applies before
 * fan-out (ADR-048 Phase 1).
 */
describe("task_parallel write isolation contract", () => {
  test("parallel explore digs are permitted", () => {
    const decision = WriteIsolation.evaluateParallelAgents([
      {
        name: "explore",
        permission: [
          { permission: "*", pattern: "*", action: "deny" },
          { permission: "read", pattern: "*", action: "allow" },
        ],
      },
      {
        name: "explore",
        permission: [
          { permission: "*", pattern: "*", action: "deny" },
          { permission: "grep", pattern: "*", action: "allow" },
        ],
      },
    ])
    expect(decision.ok).toBe(true)
  })

  test("parallel build digs are rejected", () => {
    const decision = WriteIsolation.evaluateParallelAgents([
      {
        name: "build",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      },
      {
        name: "test",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      },
    ])
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error("expected multi_writer rejection")
    expect(decision.reason).toBe("multi_writer")
  })
})

describe("task_parallel prompt routing", () => {
  test("foreground parallel prompts preserve the requested agent when the prompt mentions a bug", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: parent.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test" as any, modelID: "test-model" as any },
          tools: { bash: false, edit: false, read: true },
          isolation: { mode: "read-only", network: false },
          mode: "build",
        } as any)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: parent.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: "test-model",
          providerID: "test",
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        let calls = 0
        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => {
          calls++
          return {
            info: {
              id: input.messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
            },
            parts: calls === 1 ? [] : [{ type: "text", text: "no bugs found" }],
          } as any
        }) as any)

        try {
          const result = await (
            await TaskParallelTool.init()
          ).execute(
            {
              tasks: [
                {
                  description: "Hunt bug in engines",
                  prompt: "find the bug in the slide engine",
                  subagent_type: "explore",
                },
              ],
            },
            {
              sessionID: parent.id,
              messageID: assistant.id,
              callID: "",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => {},
              ask: async () => {},
              extra: {},
            } as any,
          )

          expect(promptSpy).toHaveBeenCalledTimes(2)
          for (const [input] of promptSpy.mock.calls) {
            expect(input).toMatchObject({
              agent: "explore",
              agentRouting: "preserve",
              isolation: { mode: "read-only", network: false },
              tools: { bash: false, edit: false, list_background_tasks: false, message_background_task: false },
            })
          }
          for (const [input] of promptSpy.mock.calls) expect(input.tools?.read).not.toBe(true)
          expect(result.output).toContain("no bugs found")
        } finally {
          promptSpy.mockRestore()
        }
      },
    })
  })
})

describe("task_parallel sibling lifecycle", () => {
  async function parent(tmpPath: string) {
    const parentSession = await Session.create({})
    const user = await Session.updateMessage({
      id: MessageID.ascending(),
      sessionID: parentSession.id,
      role: "user",
      time: { created: Date.now() },
      agent: "build",
      model: { providerID: "test" as any, modelID: "test-model" as any },
      tools: {},
      isolation: { mode: "read-only", network: false },
      mode: "build",
    } as any)
    const assistant = await Session.updateMessage({
      id: MessageID.ascending(),
      parentID: user.id,
      sessionID: parentSession.id,
      role: "assistant",
      mode: "build",
      agent: "build",
      path: { cwd: tmpPath, root: tmpPath },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: "test-model",
      providerID: "test",
      time: { created: Date.now() },
    } as MessageV2.Assistant)
    const ctx = {
      sessionID: parentSession.id,
      messageID: assistant.id,
      callID: "",
      agent: "build",
      abort: AbortSignal.any([]),
      messages: [],
      metadata: () => {},
      ask: async () => {},
      extra: {},
    } as any
    return { parentSession, ctx }
  }

  test("fires SubagentStop for every child with its outcome", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await parent(tmp.path)
        const { LifecycleHooks } = await import("../../src/hooks/lifecycle")
        const stops: unknown[] = []
        vi.spyOn(LifecycleHooks, "runForWorkspace").mockImplementation(async (input) => {
          if (input.event === "SubagentStop") stops.push(input.args)
          return { ok: true, blocked: false, outputs: [] }
        })
        let calls = 0
        vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => {
          calls++
          const failing = input.parts?.[0]?.text?.includes("fail")
          return {
            info: {
              id: input.messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              ...(failing ? { error: { name: "UnknownError", data: { message: "boom" } } } : {}),
            },
            parts: failing ? [] : [{ type: "text", text: `done ${calls}` }],
          } as any
        }) as any)
        try {
          const result = await (
            await TaskParallelTool.init()
          ).execute(
            {
              tasks: [
                { description: "one", prompt: "look at one", subagent_type: "explore" },
                { description: "two", prompt: "fail on two", subagent_type: "explore" },
              ],
            },
            ctx,
          )
          expect(result.title).toBe("Parallel digs 1/2 ok")
          expect(stops.map((item: any) => item.status).toSorted()).toEqual(["completed", "failed"])
          expect(stops.every((item: any) => item.agent === "explore")).toBe(true)
        } finally {
          vi.restoreAllMocks()
        }
      },
    })
  })

  test("a child that fails before its session exists cancels the siblings that already started", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx, parentSession } = await parent(tmp.path)
        const originalCreate = Session.create
        let created = 0
        vi.spyOn(Session, "create").mockImplementation(async (input: any) => {
          created++
          if (created === 2) throw new Error("database busy")
          return originalCreate(input)
        })
        let childStarted!: () => void
        const started = new Promise<void>((resolve) => {
          childStarted = resolve
        })
        let releaseHang!: () => void
        const hang = new Promise<void>((resolve) => {
          releaseHang = resolve
        })
        const { LifecycleHooks } = await import("../../src/hooks/lifecycle")
        const stops: unknown[] = []
        vi.spyOn(LifecycleHooks, "runForWorkspace").mockImplementation(async (input) => {
          if (input.event === "SubagentStop") stops.push(input)
          return { ok: true, blocked: false, outputs: [] }
        })
        const cancel = vi.spyOn(SessionPrompt, "cancel").mockImplementation(async () => {
          releaseHang()
        })
        vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => {
          childStarted()
          await hang
          throw new Error("aborted")
        }) as any)
        try {
          const run = (await TaskParallelTool.init()).execute(
            {
              tasks: [
                { description: "one", prompt: "look at one", subagent_type: "explore" },
                { description: "two", prompt: "look at two", subagent_type: "explore" },
              ],
            },
            ctx,
          )
          await started
          await expect(run).rejects.toThrow("database busy")
          const children = await Session.children(parentSession.id)
          expect(children).toHaveLength(1)
          expect(cancel).toHaveBeenCalledWith(children[0]!.id, { interrupt: true })
          expect(stops.some((item: any) => item.sessionID === children[0]!.id && item.args?.status === "failed")).toBe(
            true,
          )
        } finally {
          vi.restoreAllMocks()
        }
      },
    })
  })
})

describe("task_parallel structured output", () => {
  test("captures a structured task result and reports its status", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: parent.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test" as any, modelID: "test-model" as any },
          tools: { bash: false, edit: false, read: true },
          isolation: { mode: "read-only", network: false },
          mode: "build",
        } as any)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: parent.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: "test-model",
          providerID: "test",
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => ({
          info: {
            id: input.messageID,
            sessionID: input.sessionID,
            role: "assistant",
            time: { created: Date.now(), completed: Date.now() },
            structured: { verdict: "ok" },
          },
          parts: [],
        })) as any)

        try {
          const result = await (
            await TaskParallelTool.init()
          ).execute(
            {
              tasks: [
                {
                  description: "audit module",
                  prompt: "audit the module",
                  subagent_type: "explore",
                  output_schema: { type: "object", properties: { verdict: { type: "string" } } },
                },
              ],
            },
            {
              sessionID: parent.id,
              messageID: assistant.id,
              callID: "",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => {},
              ask: async () => {},
              extra: {},
            } as any,
          )

          // A structured-only child counts as a successful, usable result.
          expect(result.metadata.results).toHaveLength(1)
          expect(result.metadata.results[0]).toMatchObject({
            ok: true,
            structuredStatus: "captured",
            structured: { verdict: "ok" },
          })
          expect(result.output).toContain("<task_structured_output>")
          expect(result.output).toContain('"verdict": "ok"')
          expect(promptSpy.mock.calls[0]![0]).toMatchObject({ format: { type: "json_schema" } })
        } finally {
          vi.restoreAllMocks()
        }
      },
    })
  })
})
