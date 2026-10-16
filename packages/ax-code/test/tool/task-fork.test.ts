import { afterEach, describe, expect, test, vi } from "vitest"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID } from "../../src/session/schema"
import { TaskTool } from "../../src/tool/task"
import { MessageV2 } from "../../src/session/message-v2"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

// ADR-239: optional `fork: true` on `task` copies the parent's history into
// the child. The tests below lock the validation paths without driving the
// LLM. SessionPrompt.prompt is spied so the executor cannot reach the
// provider stack even if a validation gate is missed.

describe("tool.task fork schema (ADR-239)", () => {
  test("the tool parameter schema advertises an optional fork boolean", async () => {
    // `username` is set in the config so the loader does not have to call
    // os.userInfo() — that call returns ENOENT in this sandbox (see
    // packages/ax-code/test/AGENTS.md). The other config fields are
    // placeholders the tool executor does not need for this test.
    await using tmp = await tmpdir({
      git: true,
      config: { username: "tester", model: "test/test-model" as any },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskTool.init()
        const shape = tool.parameters as { shape?: Record<string, unknown> }
        // ZodObject stores the field schema under `.shape`. Both z.object
        // and the older .extend() flow expose the same surface, so the
        // fork parameter is reachable here either way.
        const fields = (shape.shape ?? (shape as unknown as Record<string, unknown>)) as Record<string, unknown>
        expect(fields).toHaveProperty("fork")
        // The schema must remain tolerant of both the absent-field and
        // the explicit-true cases — those are the two shapes the model
        // actually emits, and existing callers must keep working.
        const parse = (tool.parameters as unknown as { parse: (input: unknown) => unknown }).parse.bind(tool.parameters)
        expect(() => parse({ description: "test", prompt: "x", subagent_type: "general" })).not.toThrow()
        expect(() => parse({ description: "test", prompt: "x", subagent_type: "general", fork: true })).not.toThrow()
      },
    })
  })
})

describe("tool.task fork validation (ADR-239)", () => {
  test("refuses when the calling session is itself a subagent", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "tester", model: "test/test-model" as any },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Build a 2-deep chain: root → child. The child's parentID is set,
        // so any `task({ fork: true })` from the child should be refused
        // because the fork would carry the parent's subagent context and
        // bypass the ADR-005 fan-out deny.
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })

        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: child.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test" as any, modelID: "test-model" as any },
          tools: {},
          mode: "build",
        } as any)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: child.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "test-model",
          providerID: "test",
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        const promptSpy = vi.spyOn(SessionPrompt, "prompt")
        try {
          await expect(
            (await TaskTool.init()).execute(
              {
                description: "fork from subagent",
                prompt: "should be refused",
                subagent_type: "general",
                fork: true,
              },
              {
                sessionID: child.id,
                messageID: assistant.id,
                callID: "",
                agent: "build",
                abort: AbortSignal.any([]),
                messages: [],
                metadata: () => {},
                ask: async () => {},
                extra: {},
              } as any,
            ),
          ).rejects.toThrow(/calling session is itself a subagent/)
          // The validation must reject before the child prompt runs, so
          // SessionPrompt.prompt is never called for a refused fork.
          expect(promptSpy).not.toHaveBeenCalled()
        } finally {
          promptSpy.mockRestore()
        }
      },
    })
  })

  test("refuses when combined with task_id", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "tester", model: "test/test-model" as any },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: root.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test" as any, modelID: "test-model" as any },
          tools: {},
          mode: "build",
        } as any)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: root.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "test-model",
          providerID: "test",
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        const promptSpy = vi.spyOn(SessionPrompt, "prompt")
        try {
          await expect(
            (await TaskTool.init()).execute(
              {
                description: "fork+resume",
                prompt: "should be refused",
                subagent_type: "general",
                fork: true,
                task_id: "ses_old",
              },
              {
                sessionID: root.id,
                messageID: assistant.id,
                callID: "",
                agent: "build",
                abort: AbortSignal.any([]),
                messages: [],
                metadata: () => {},
                ask: async () => {},
                extra: {},
              } as any,
            ),
          ).rejects.toThrow(/fork is not supported with task_id/)
          expect(promptSpy).not.toHaveBeenCalled()
        } finally {
          promptSpy.mockRestore()
        }
      },
    })
  })

  test("Agent.build is available so a real fork execution can be wired up later", async () => {
    // The fork success path requires a real agent to look up — make sure
    // build is present in the test fixture. The success path itself is
    // exercised by an end-to-end dogfood test, not by this unit suite.
    await using tmp = await tmpdir({
      git: true,
      config: { username: "tester", model: "test/test-model" as any },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        expect(build).toBeDefined()
        expect(build?.name).toBe("build")
      },
    })
  })
})
