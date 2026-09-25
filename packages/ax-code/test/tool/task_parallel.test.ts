import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID } from "../../src/session/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { MAX_PARALLEL, TaskParallelTool, expandTaskParallelInput } from "../../src/tool/task_parallel"
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

describe("task_parallel swarm shape", () => {
  test("expands items over one template into distinct members", () => {
    const expansion = expandTaskParallelInput({
      items: ["src/a.ts", "src/b.ts"],
      promptTemplate: "Review {{item}} and report findings.",
      subagentType: "explore",
    })
    expect(expansion.ok).toBe(true)
    if (!expansion.ok) throw new Error(expansion.message)
    expect(expansion.tasks.map((t) => t.prompt)).toEqual([
      "Review src/a.ts and report findings.",
      "Review src/b.ts and report findings.",
    ])
    expect(expansion.tasks.map((t) => t.description)).toEqual(["src/a.ts", "src/b.ts"])
    expect(expansion.tasks.every((t) => t.subagent_type === "explore")).toBe(true)
  })

  test("replaces every placeholder occurrence, and multi-line items keep one label", () => {
    const expansion = expandTaskParallelInput({
      items: ["first line\nsecond line"],
      promptTemplate: "{{item}} / {{item}}",
      subagentType: "explore",
    })
    expect(expansion.ok).toBe(true)
    if (!expansion.ok) throw new Error(expansion.message)
    expect(expansion.tasks[0]?.prompt).toBe("first line\nsecond line / first line\nsecond line")
    expect(expansion.tasks[0]?.description).toBe("first line")
  })

  test("an item that contains the placeholder is inserted verbatim, never re-expanded", () => {
    // Single-pass substitution: the template's placeholder is replaced once and
    // the substituted text is never rescanned.
    const expansion = expandTaskParallelInput({
      items: ["{{item}}"],
      promptTemplate: "literal: {{item}}",
      subagentType: "explore",
    })
    expect(expansion.ok).toBe(true)
    if (!expansion.ok) throw new Error(expansion.message)
    expect(expansion.tasks[0]?.prompt).toBe("literal: {{item}}")
  })

  test("applies one output_schema to every item member", () => {
    const schema = { type: "object", properties: { ok: { type: "boolean" } } }
    const expansion = expandTaskParallelInput({
      items: ["one", "two"],
      promptTemplate: "Check {{item}}",
      subagentType: "explore",
      outputSchema: schema,
    })
    expect(expansion.ok).toBe(true)
    if (!expansion.ok) throw new Error(expansion.message)
    expect(expansion.tasks.map((t) => t.output_schema)).toEqual([schema, schema])
  })

  test("the tasks shape passes through unchanged", () => {
    const tasks = [{ description: "one", prompt: "look", subagent_type: "explore" }]
    const expansion = expandTaskParallelInput({ tasks })
    expect(expansion).toEqual({ ok: true, tasks })
  })

  test.each([
    ["both shapes", { tasks: [{ description: "a", prompt: "b", subagent_type: "explore" }], items: ["x"], promptTemplate: "p {{item}}", subagentType: "explore" }, "not both"],
    ["neither shape", {}, "Provide tasks"],
    ["items without a template", { items: ["x"], subagentType: "explore" }, "prompt_template is required"],
    ["a template without the placeholder", { items: ["x"], promptTemplate: "no placeholder", subagentType: "explore" }, "must contain the literal {{item}}"],
    ["items without an agent type", { items: ["x"], promptTemplate: "check {{item}}", }, "subagent_type is required"],
    ["a template alongside tasks", { tasks: [{ description: "a", prompt: "b", subagent_type: "explore" }], promptTemplate: "p {{item}}", subagentType: "explore" }, "not both"],
    ["duplicate filled prompts", { items: ["x", "x"], promptTemplate: "check {{item}}", subagentType: "explore" }, "distinct prompt"],
    [
      "more items than the cap",
      {
        items: Array.from({ length: MAX_PARALLEL + 1 }, (_, i) => `i${i}`),
        promptTemplate: "check {{item}}",
        subagentType: "explore",
      },
      `At most ${MAX_PARALLEL}`,
    ],
  ])("rejects %s before anything starts", (_name, input, message) => {
    const expansion = expandTaskParallelInput(input as any)
    expect(expansion.ok).toBe(false)
    if (expansion.ok) throw new Error("expected rejection")
    expect(expansion.message).toContain(message)
  })

  test("a rejected swarm never reaches the permission ask or a child session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await parent(tmp.path)
        const promptSpy = vi.spyOn(SessionPrompt, "prompt")
        const ask = vi.fn(async () => {})
        try {
          await expect(
            (await TaskParallelTool.init()).execute(
              { items: ["only one"], prompt_template: "no placeholder here", subagent_type: "explore" } as any,
              { ...ctx, ask } as any,
            ),
          ).rejects.toThrow("must contain the literal {{item}}")
          expect(promptSpy).not.toHaveBeenCalled()
          expect(ask).not.toHaveBeenCalled()
        } finally {
          vi.restoreAllMocks()
        }
      },
    })
  })

  test("a swarm member receives its filled prompt", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await parent(tmp.path)
        const prompts: string[] = []
        vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => {
          prompts.push(input.parts?.[0]?.text ?? "")
          return {
            info: {
              id: input.messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
            },
            parts: [{ type: "text", text: "done" }],
          } as any
        }) as any)
        try {
          const result = await (
            await TaskParallelTool.init()
          ).execute(
            {
              items: ["src/a.ts", "src/b.ts"],
              prompt_template: "Review {{item}}",
              subagent_type: "explore",
            } as any,
            ctx,
          )
          expect(prompts.toSorted()).toEqual(["Review src/a.ts", "Review src/b.ts"])
          // Members keep the caller's order in the aggregation.
          expect((result.metadata as any).results.map((r: any) => r.description)).toEqual(["src/a.ts", "src/b.ts"])
          expect(result.title).toBe("Parallel digs 2/2 ok")
        } finally {
          vi.restoreAllMocks()
        }
      },
    })
  })

  test.each([2, 1])("runs at most %i swarm members at once", async (concurrency) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await parent(tmp.path)
        const items = Array.from({ length: 5 }, (_, i) => `item-${i}`)
        let inFlight = 0
        let peak = 0
        const releases: Array<() => void> = []
        vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => {
          inFlight++
          peak = Math.max(peak, inFlight)
          await new Promise<void>((resolve) => releases.push(resolve))
          inFlight--
          return {
            info: {
              id: input.messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
            },
            parts: [{ type: "text", text: "done" }],
          } as any
        }) as any)
        try {
          const call = (await TaskParallelTool.init()).execute(
            { items, prompt_template: "check {{item}}", subagent_type: "explore", concurrency } as any,
            ctx,
          )
          let settled = false
          void call.then(
            () => {
              settled = true
            },
            () => {
              settled = true
            },
          )
          while (!settled) {
            const release = releases.shift()
            if (release) release()
            await new Promise((resolve) => setTimeout(resolve, 5))
          }
          await call
          expect(peak).toBe(concurrency)
        } finally {
          vi.restoreAllMocks()
        }
      },
    })
  })
})

describe("task_parallel swarm failure polarity", () => {
  test("a member that throws before its session exists cancels only the started siblings", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await parent(tmp.path)
        const originalCreate = Session.create
        const cancels: string[] = []
        let created = 0
        vi.spyOn(Session, "create").mockImplementation(async (input: any) => {
          created++
          if (created === 2) throw new Error("database busy")
          return originalCreate(input)
        })
        vi.spyOn(SessionPrompt, "cancel").mockImplementation((async (sessionID: string) => {
          cancels.push(sessionID)
          return undefined as any
        }) as any)
        vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => {
          // Hold the first member open until the pool reports the failure so the
          // cancel path is exercised rather than finishing first.
          await new Promise((resolve) => setTimeout(resolve, 30))
          return {
            info: {
              id: input.messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
            },
            parts: [{ type: "text", text: "done" }],
          } as any
        }) as any)
        try {
          await expect(
            (await TaskParallelTool.init()).execute(
              {
                items: ["one", "two", "three"],
                prompt_template: "check {{item}}",
                subagent_type: "explore",
                concurrency: 2,
              } as any,
              ctx,
            ),
          ).rejects.toThrow("database busy")
          // The third member was never dispatched: the pool stops pulling work
          // once a member reports a systemic failure.
          expect(created).toBe(2)
          // The started sibling is cancelled (twice at most: once by the pool
          // worker, once by the final sweep, exactly as the pre-pool code did),
          // and no other session is touched.
          expect(new Set(cancels).size).toBe(1)
        } finally {
          vi.restoreAllMocks()
        }
      },
    })
  })
})
