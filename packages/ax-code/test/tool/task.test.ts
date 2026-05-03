import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, SessionID } from "../../src/session/schema"
import { TaskTool } from "../../src/tool/task"
import { MessageV2 } from "../../src/session/message-v2"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.task", () => {
  test("description sorts subagents by name and is stable across calls", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const first = await TaskTool.init({ agent: build })
        const second = await TaskTool.init({ agent: build })

        expect(first.description).toBe(second.description)

        const alpha = first.description.indexOf("- alpha: Alpha agent")
        const explore = first.description.indexOf("- explore:")
        const general = first.description.indexOf("- general:")
        const zebra = first.description.indexOf("- zebra: Zebra agent")

        expect(alpha).toBeGreaterThan(-1)
        expect(explore).toBeGreaterThan(alpha)
        expect(general).toBeGreaterThan(explore)
        expect(zebra).toBeGreaterThan(general)
      },
    })
  })

  test("rejects task calls beyond the max nesting depth", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let parent: SessionID | undefined
        for (let i = 0; i < 6; i++) {
          const next = await Session.create({ parentID: parent })
          parent = next.id
        }

        const tool = await TaskTool.init()
        await expect(
          tool.execute(
            {
              description: "deep task",
              prompt: "do work",
              subagent_type: "general",
            },
            {
              sessionID: parent!,
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
        ).rejects.toThrow("Maximum subagent nesting depth")
      },
    })
  })

  test("does not launch a subagent prompt when already aborted before prompt setup", async () => {
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
          tools: {},
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

        const controller = new AbortController()
        controller.abort()

        const promptSpy = spyOn(SessionPrompt, "prompt")
        const tool = await TaskTool.init()

        try {
          await expect(
            tool.execute(
              {
                description: "aborted task",
                prompt: "do work",
                subagent_type: "general",
              },
              {
                sessionID: parent.id,
                messageID: assistant.id,
                callID: "",
                agent: "build",
                abort: controller.signal,
                messages: [],
                metadata: () => {},
                ask: async () => {},
                extra: {},
              } as any,
            ),
          ).rejects.toThrow(/AbortError|Aborted/)
          expect(promptSpy).not.toHaveBeenCalled()
        } finally {
          promptSpy.mockRestore()
        }
      },
    })
  })

  test("does not launch a subagent prompt if abort happens while resolving task depth", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })

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

        const controller = new AbortController()
        const originalGet = Session.get
        // Session.get is a callable namespace with attached `force` and
        // `schema` properties. spyOn's mockImplementation infers a plain
        // function type, so cast to any.
        const getSpy = spyOn(Session, "get").mockImplementation((async (...args: Parameters<typeof originalGet>) => {
          const result = await originalGet(...args)
          if (result?.id === root.id) {
            await new Promise((resolve) => setTimeout(resolve, 10))
            controller.abort()
          }
          return result
        }) as any)

        const promptSpy = spyOn(SessionPrompt, "prompt")
        try {
          await expect(
            (await TaskTool.init()).execute(
              {
                description: "aborted task",
                prompt: "do work",
                subagent_type: "general",
              },
              {
                sessionID: child.id,
                messageID: assistant.id,
                callID: "",
                agent: "build",
                abort: controller.signal,
                messages: [],
                metadata: () => {},
                ask: async () => {},
                extra: {},
              } as any,
            ),
          ).rejects.toThrow(/AbortError|Aborted/)
          expect(promptSpy).not.toHaveBeenCalled()
        } finally {
          getSpy.mockRestore()
          promptSpy.mockRestore()
        }
      },
    })
  })

  test("cancels the subagent session if abort fires after session creation but before prompt setup", async () => {
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
          tools: {},
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

        const controller = new AbortController()
        const originalGet = MessageV2.get
        const getSpy = spyOn(MessageV2, "get").mockImplementation((async (...args: Parameters<typeof originalGet>) => {
          setTimeout(() => controller.abort(), 0)
          await new Promise((resolve) => setTimeout(resolve, 10))
          return originalGet(...args)
        }) as any)

        const cancelSpy = spyOn(SessionPrompt, "cancel").mockResolvedValue(undefined as never)
        const promptSpy = spyOn(SessionPrompt, "prompt")
        try {
          await expect(
            (await TaskTool.init()).execute(
              {
                description: "aborted task",
                prompt: "do work",
                subagent_type: "general",
              },
              {
                sessionID: parent.id,
                messageID: assistant.id,
                callID: "",
                agent: "build",
                abort: controller.signal,
                messages: [],
                metadata: () => {},
                ask: async () => {},
                extra: {},
              } as any,
            ),
          ).rejects.toThrow(/AbortError|Aborted/)
          expect(cancelSpy).toHaveBeenCalledTimes(1)
          expect(String(cancelSpy.mock.calls[0]?.[0] ?? "")).toMatch(/^ses_/)
          expect(promptSpy).not.toHaveBeenCalled()
        } finally {
          getSpy.mockRestore()
          cancelSpy.mockRestore()
          promptSpy.mockRestore()
        }
      },
    })
  })

  test("asks the subagent to finalize once when the first result has no text", async () => {
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
          tools: {},
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
        const promptSpy = spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => {
          calls++
          return {
            info: {
              id: input.messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
            },
            parts: calls === 1 ? [] : [{ type: "text", text: "Recovered subagent findings." }],
          } as any
        }) as any)

        try {
          const result = await (await TaskTool.init()).execute(
            {
              description: "review code",
              prompt: "review the code",
              subagent_type: "general",
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
          expect((promptSpy.mock.calls[1]?.[0] as any).parts[0].text).toContain("ended without a usable final response")
          expect(result.output).toContain("Recovered subagent findings.")
          expect(result.metadata.emptyResult).toBe(false)
          expect(result.metadata.finalizeAttempted).toBe(true)
          expect(result.metadata.recoveredFromEmpty).toBe(true)
          expect(result.metadata.recoveredResultNeedsReview).toBe(false)
        } finally {
          promptSpy.mockRestore()
        }
      },
    })
  })

  test("does not finalize over an errored empty subagent result", async () => {
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
          tools: {},
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

        const promptSpy = spyOn(SessionPrompt, "prompt").mockResolvedValue({
          info: {
            id: MessageID.ascending(),
            sessionID: parent.id,
            role: "assistant",
            time: { created: Date.now(), completed: Date.now() },
            error: new MessageV2.APIError({ message: "provider failed", isRetryable: false }).toObject(),
          },
          parts: [],
        } as any)

        try {
          const result = await (await TaskTool.init()).execute(
            {
              description: "review code",
              prompt: "review the code",
              subagent_type: "general",
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

          expect(promptSpy).toHaveBeenCalledTimes(1)
          expect(result.output).toContain("Subagent ended with APIError: provider failed.")
          expect(result.metadata.emptyResult).toBe(true)
          expect(result.metadata.finalizeAttempted).toBe(false)
          expect(result.metadata.subagentError).toBe(true)
          expect(result.metadata.errorName).toBe("APIError")
          expect(result.metadata.errorMessage).toBe("provider failed")
        } finally {
          promptSpy.mockRestore()
        }
      },
    })
  })
})
