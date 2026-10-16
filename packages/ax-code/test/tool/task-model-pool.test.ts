import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID } from "../../src/session/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { ModelPool } from "../../src/config/schema-impl"
import { TaskTool } from "../../src/tool/task"
import { TaskParallelTool } from "../../src/tool/task_parallel"
import { assertPoolAlias, parseModelRef, resolvePoolModel } from "../../src/tool/task-model-pool"
import { tmpdir } from "../fixture/fixture"
import type { MessageV2 as MessageV2Type } from "../../src/session/message-v2"

afterEach(async () => {
  await Instance.disposeAll()
  vi.restoreAllMocks()
})

const POOL = {
  default: "cheap",
  models: [
    { alias: "cheap", model: "prov/cheap-model", hint: "Cheap scouting model" },
    { alias: "deep", model: "prov/deep-model" },
  ],
}

describe("agents.model_pool config schema", () => {
  test("normalizes the record form to aliased entries", () => {
    const pool = ModelPool.parse({
      default: "fast",
      models: {
        fast: { model: "prov/fast-model", hint: "Fast answers" },
      },
    })
    expect(pool).toEqual({
      default: "fast",
      models: [{ alias: "fast", model: "prov/fast-model", hint: "Fast answers" }],
    })
  })

  test("rejects malformed entries at config load", () => {
    expect(() => ModelPool.parse({ models: [{ model: "no-slash" }] })).toThrow()
    expect(() =>
      ModelPool.parse({
        models: [
          { alias: "cheap", model: "prov/cheap" },
          { alias: "cheap", model: "prov/other" },
        ],
      }),
    ).toThrow(/Duplicate pool alias/)
    expect(() => ModelPool.parse({ default: "missing", models: [{ alias: "cheap", model: "prov/cheap" }] })).toThrow(
      /does not match any pool entry/,
    )
  })
})

describe("model pool resolution", () => {
  const fallback = { providerID: "parent" as any, modelID: "parent-model" as any }

  test("parses provider/model at the first slash", () => {
    expect(parseModelRef("prov/deep/model")).toEqual({ providerID: "prov", modelID: "deep/model" })
    expect(() => parseModelRef("noslash")).toThrow(/provider\/model/)
  })

  test("explicit alias beats the agent pin; primary keeps the parent model", () => {
    const agentPin = { providerID: "pin" as any, modelID: "pinned-model" as any }
    expect(resolvePoolModel({ pool: POOL, requested: "deep", agentPin, fallback })).toEqual({
      providerID: "prov",
      modelID: "deep-model",
    })
    expect(resolvePoolModel({ pool: POOL, requested: "primary", agentPin, fallback })).toEqual(fallback)
  })

  test("without a request the agent pin wins over the pool default", () => {
    const agentPin = { providerID: "pin" as any, modelID: "pinned-model" as any }
    expect(resolvePoolModel({ pool: POOL, agentPin, fallback })).toEqual(agentPin)
    expect(resolvePoolModel({ pool: POOL, fallback })).toEqual({ providerID: "prov", modelID: "cheap-model" })
    expect(resolvePoolModel({ pool: undefined, fallback })).toEqual(fallback)
  })

  test("unknown aliases are rejected with the valid alias list", () => {
    expect(() => resolvePoolModel({ pool: POOL, requested: "bogus", fallback })).toThrow(
      /Unknown model alias "bogus". Valid aliases: cheap, deep, primary/,
    )
    // Without a pool nothing but "primary" is legal.
    expect(() => assertPoolAlias(undefined, "cheap")).toThrow(/Unknown model alias "cheap"/)
    expect(() => assertPoolAlias(POOL, "primary")).not.toThrow()
    expect(() => assertPoolAlias(POOL, undefined)).not.toThrow()
  })
})

async function parentWithAssistant(tmpPath: string) {
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
  } as MessageV2Type.Assistant)
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

function mockPrompt() {
  return vi.spyOn(SessionPrompt, "prompt").mockImplementation(
    (async (input: any) =>
      ({
        info: {
          id: input.messageID,
          sessionID: input.sessionID,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
        parts: [{ type: "text", text: "subagent done" }],
      }) as any) as any,
  )
}

describe("task tool model pool parameter (ADR-218)", () => {
  test("without a pool the schema exposes no model parameter", async () => {
    await using tmp = await tmpdir({ git: true, config: { username: "testuser" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskTool.init()
        // The set of declared parameters is itself load-bearing: the new
        // fork parameter (ADR-239) MUST appear in the no-pool case so a
        // caller can opt in without a pool. Only `model` is the field the
        // pool controls, so the negative check is what proves the pool
        // is truly absent.
        expect(Object.keys((tool.parameters as any).shape).sort()).toEqual(
          [
            "background",
            "command",
            "description",
            "fork",
            "output_schema",
            "prompt",
            "subagent_type",
            "task_id",
          ].sort(),
        )
        expect("model" in (tool.parameters as any).shape).toBe(false)

        const parallel = await TaskParallelTool.init()
        expect("model" in (parallel.parameters as any).shape).toBe(false)
      },
    })
  })

  test("with a pool the schema lists aliases and hints", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "testuser", agents: { model_pool: POOL } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskTool.init()
        const model = (tool.parameters as any).shape.model
        expect(model).toBeDefined()
        expect(model.description).toContain("- cheap: Cheap scouting model")
        expect(model.description).toContain("- deep: prov/deep-model")
        expect(model.description).toContain('"primary"')
        expect(model.description).toContain("Default when omitted: cheap")

        const parallel = await TaskParallelTool.init()
        expect((parallel.parameters as any).shape.model).toBeDefined()
      },
    })
  })

  test("resolves the alias to the configured model for the child prompt", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "testuser", agents: { model_pool: POOL } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await parentWithAssistant(tmp.path)
        const spy = mockPrompt()
        const tool = await TaskTool.init()
        await tool.execute(
          {
            description: "pooled task",
            prompt: "do work",
            subagent_type: "general",
            model: "deep",
          } as any,
          ctx,
        )
        expect(spy).toHaveBeenCalled()
        expect(spy.mock.calls[0]![0].model).toEqual({ providerID: "prov", modelID: "deep-model" })
      },
    })
  })

  test("primary keeps the parent model and the pool default applies when omitted", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "testuser", agents: { model_pool: POOL } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskTool.init()
        // One spy for both executions: vi.spyOn on an already-spied method
        // returns the same spy, so separate spies would share call history.
        const spy = mockPrompt()

        const primaryCtx = await parentWithAssistant(tmp.path)
        await tool.execute(
          { description: "primary task", prompt: "do work", subagent_type: "general", model: "primary" } as any,
          primaryCtx.ctx,
        )
        expect(spy.mock.calls[0]![0].model).toEqual({ providerID: "test", modelID: "test-model" })

        const omittedCtx = await parentWithAssistant(tmp.path)
        await tool.execute({ description: "default task", prompt: "do work", subagent_type: "general" }, omittedCtx.ctx)
        expect(spy.mock.calls[1]![0].model).toEqual({ providerID: "prov", modelID: "cheap-model" })
      },
    })
  })

  test("rejects an unknown alias before any child session exists", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "testuser", agents: { model_pool: POOL } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parentSession = await Session.create({})
        const tool = await TaskTool.init()
        await expect(
          tool.execute(
            {
              description: "bad alias",
              prompt: "do work",
              subagent_type: "general",
              model: "bogus",
            } as any,
            {
              sessionID: parentSession.id,
              messageID: MessageID.make(""),
              callID: "",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => {},
              ask: async () => {},
              extra: {},
            } as any,
          ),
        ).rejects.toThrow(/Unknown model alias "bogus". Valid aliases: cheap, deep, primary/)
        expect(await Session.children(parentSession.id)).toHaveLength(0)
      },
    })
  })
})

describe("task_parallel model pool (ADR-218)", () => {
  test("applies the swarm-wide alias to every member", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "testuser", agents: { model_pool: POOL } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await parentWithAssistant(tmp.path)
        const spy = mockPrompt()
        const tool = await TaskParallelTool.init()
        await tool.execute(
          {
            tasks: [
              { description: "first dig", prompt: "find one", subagent_type: "explore" },
              { description: "second dig", prompt: "find two", subagent_type: "explore" },
            ],
            model: "cheap",
          } as any,
          ctx,
        )
        expect(spy).toHaveBeenCalledTimes(2)
        for (const [input] of spy.mock.calls) {
          expect(input.model).toEqual({ providerID: "prov", modelID: "cheap-model" })
        }
      },
    })
  })

  test("rejects an unknown alias before any member starts", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "testuser", agents: { model_pool: POOL } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await parentWithAssistant(tmp.path)
        const tool = await TaskParallelTool.init()
        await expect(
          tool.execute(
            {
              tasks: [{ description: "dig", prompt: "find", subagent_type: "explore" }],
              model: "bogus",
            } as any,
            ctx,
          ),
        ).rejects.toThrow(/Unknown model alias "bogus"/)
      },
    })
  })
})
