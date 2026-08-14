import { afterEach, describe, expect, test, vi } from "vitest"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, SessionID, TaskQueueID } from "../../src/session/schema"
import { TaskTool } from "../../src/tool/task"
import { MessageV2 } from "../../src/session/message-v2"
import { TaskQueue } from "../../src/session/task-queue"
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

        const promptSpy = vi.spyOn(SessionPrompt, "prompt")
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
        const getSpy = vi.spyOn(Session, "get").mockImplementation((async (...args: Parameters<typeof originalGet>) => {
          const result = await originalGet(...args)
          if (result?.id === root.id) {
            await new Promise((resolve) => setTimeout(resolve, 10))
            controller.abort()
          }
          return result
        }) as any)

        const promptSpy = vi.spyOn(SessionPrompt, "prompt")
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
        const getSpy = vi.spyOn(MessageV2, "get").mockImplementation((async (
          ...args: Parameters<typeof originalGet>
        ) => {
          setTimeout(() => controller.abort(), 0)
          await new Promise((resolve) => setTimeout(resolve, 10))
          return originalGet(...args)
        }) as any)

        const cancelSpy = vi.spyOn(SessionPrompt, "cancel").mockResolvedValue(undefined as never)
        const promptSpy = vi.spyOn(SessionPrompt, "prompt")
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
        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => {
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
          const result = await (
            await TaskTool.init()
          ).execute(
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
          expect(result.output).toContain("Review it before treating it as normal subagent evidence.")
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

  test("returns structured empty-result metadata when finalization fails", async () => {
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
        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => {
          calls++
          if (calls === 1) {
            return {
              info: {
                id: input.messageID,
                sessionID: input.sessionID,
                role: "assistant",
                time: { created: Date.now(), completed: Date.now() },
              },
              parts: [],
            } as any
          }
          throw new Error("Subagent finalization timed out after 2 minutes")
        }) as any)
        const cancelSpy = vi.spyOn(SessionPrompt, "cancel").mockResolvedValue(undefined as never)

        try {
          const result = await (
            await TaskTool.init()
          ).execute(
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
          expect(cancelSpy).toHaveBeenCalledTimes(1)
          expect(result.output).toContain("Subagent completed without a final response.")
          expect(result.output).toContain(
            "Finalization failed with Error: Subagent finalization timed out after 2 minutes.",
          )
          expect(result.metadata.emptyResult).toBe(true)
          expect(result.metadata.finalizeAttempted).toBe(true)
          expect(result.metadata.recoveredFromEmpty).toBe(false)
          expect(result.metadata.subagentError).toBe(true)
          expect(result.metadata.errorName).toBe("Error")
          expect(result.metadata.errorMessage).toBe("Subagent finalization timed out after 2 minutes")
          expect(result.metadata.finalizeError).toBe(true)
        } finally {
          promptSpy.mockRestore()
          cancelSpy.mockRestore()
        }
      },
    })
  })

  test("preserves the session and returns a resumable result when the subagent prompt throws", async () => {
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

        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockImplementation((async () => {
          throw new Error("Subagent timed out after 10 minutes — provider may be unresponsive")
        }) as any)
        const cancelSpy = vi.spyOn(SessionPrompt, "cancel").mockResolvedValue(undefined as never)
        const removeSpy = vi.spyOn(Session, "remove")

        try {
          const result = await (
            await TaskTool.init()
          ).execute(
            {
              description: "Analyze Python code for bugs",
              prompt: "find bugs",
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

          // The in-flight processor is cancelled, but the session is NOT
          // removed — it must stay resumable via task_id.
          expect(cancelSpy).toHaveBeenCalledTimes(1)
          expect(removeSpy).not.toHaveBeenCalled()

          const taskID = result.metadata.sessionId
          expect(String(taskID)).toMatch(/^ses_/)
          // The surfaced task_id is a real, resumable child of the parent.
          const resumable = await Session.get(SessionID.make(String(taskID)))
          expect(resumable.parentID).toBe(parent.id)

          expect(result.output).toContain(`task_id: ${taskID}`)
          expect(result.output).toContain("Subagent failed before returning a usable result")
          expect(result.output).toContain("resume the task_id above")
          expect(result.metadata.emptyResult).toBe(true)
          expect(result.metadata.subagentError).toBe(true)
          expect(result.metadata.errorName).toBe("Error")
          expect(result.metadata.errorMessage).toContain("provider may be unresponsive")
        } finally {
          promptSpy.mockRestore()
          cancelSpy.mockRestore()
          removeSpy.mockRestore()
        }
      },
    })
  })

  test("removes the orphaned session and rethrows when the subagent prompt is aborted", async () => {
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

        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockImplementation((async () => {
          throw new DOMException("Aborted", "AbortError")
        }) as any)
        const cancelSpy = vi.spyOn(SessionPrompt, "cancel").mockResolvedValue(undefined as never)
        const removeSpy = vi.spyOn(Session, "remove").mockResolvedValue(undefined as never)

        try {
          await expect(
            (await TaskTool.init()).execute(
              {
                description: "Analyze Python code for bugs",
                prompt: "find bugs",
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
            ),
          ).rejects.toThrow(/AbortError|Aborted/)
          expect(cancelSpy).toHaveBeenCalledTimes(1)
          expect(removeSpy).toHaveBeenCalledTimes(1)
        } finally {
          promptSpy.mockRestore()
          cancelSpy.mockRestore()
          removeSpy.mockRestore()
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

        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockResolvedValue({
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
          const result = await (
            await TaskTool.init()
          ).execute(
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

  test("background spawn returns before the child prompt finishes and writes a TaskQueue row", async () => {
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

        let childFinished = false
        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => {
          await new Promise((resolve) => setTimeout(resolve, 150))
          childFinished = true
          return {
            info: {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
            },
            parts: [{ type: "text", text: "background child done" }],
          } as any
        }) as any)
        const loopSpy = vi.spyOn(SessionPrompt, "loop").mockResolvedValue(undefined as never)

        try {
          const result = await (
            await TaskTool.init()
          ).execute(
            {
              description: "Explore the repo",
              prompt: "find the auth entrypoint",
              subagent_type: "explore",
              background: true,
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

          expect(childFinished).toBe(false)
          expect(result.metadata.background).toBe(true)
          expect(result.output).toContain("state: running")
          expect(result.output).toContain("DO NOT sleep")
          const taskID = String(result.metadata.sessionId)
          expect(taskID).toMatch(/^ses_/)
          const queueID = String(result.metadata.queueID)
          expect(queueID).toMatch(/^tsk_/)

          const child = await Session.get(SessionID.make(taskID))
          expect(child.parentID).toBe(parent.id)

          const queued = await TaskQueue.get(TaskQueueID.make(queueID))
          expect(queued.kind).toBe("subagent")
          expect(queued.sessionID).toBe(taskID)
          expect(queued.title).toBe("Explore the repo")
          expect(["queued", "waiting_for_idle", "running", "completed"]).toContain(queued.status)

          await vi.waitFor(() => {
            expect(childFinished).toBe(true)
            expect(promptSpy).toHaveBeenCalled()
          })
          await vi.waitFor(async () => {
            const latest = await TaskQueue.get(TaskQueueID.make(queueID))
            expect(latest.payload["deliveryStatus"]).toBe("delivered")
          })
          const parentMessages = await Session.messages({ sessionID: parent.id })
          const handoffText = parentMessages
            .flatMap((message) => message.parts)
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .find((text) => text.includes("<task id="))
          expect(handoffText).toContain("background child done")
          expect(handoffText).toContain(`id="${taskID}"`)
          expect(loopSpy).toHaveBeenCalled()
        } finally {
          promptSpy.mockRestore()
          loopSpy.mockRestore()
        }
      },
    })
  })

  test("background empty child result is delivered and blocks the completion gate", async () => {
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

        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => {
          return {
            info: {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
            },
            parts: [],
          } as any
        }) as any)
        const loopSpy = vi.spyOn(SessionPrompt, "loop").mockResolvedValue(undefined as never)

        try {
          const result = await (
            await TaskTool.init()
          ).execute(
            {
              description: "Review code",
              prompt: "review the code",
              subagent_type: "general",
              background: true,
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

          const queueID = String(result.metadata.queueID)
          await vi.waitFor(async () => {
            const latest = await TaskQueue.get(TaskQueueID.make(queueID))
            expect(latest.payload["deliveryStatus"]).toBe("delivered")
            expect(latest.payload["deliveryEmpty"]).toBe(true)
          })

          const { AutonomousCompletionGate } = await import("../../src/control-plane/autonomous-completion-gate")
          const decision = AutonomousCompletionGate.evaluate({
            pendingTodos: [],
            messages: await Session.messages({ sessionID: parent.id }),
          })
          expect(decision).toMatchObject({
            status: "blocked",
            reason: "empty_subagent_result",
            emptyResult: { taskID: result.metadata.sessionId },
          })
        } finally {
          promptSpy.mockRestore()
          loopSpy.mockRestore()
        }
      },
    })
  })

  test("foreground task still waits for the child prompt", async () => {
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

        let childFinished = false
        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          childFinished = true
          return {
            info: {
              id: input.messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
            },
            parts: [{ type: "text", text: "foreground child done" }],
          } as any
        }) as any)

        try {
          const result = await (
            await TaskTool.init()
          ).execute(
            {
              description: "Review code",
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

          expect(childFinished).toBe(true)
          expect(result.metadata.background).toBeUndefined()
          expect(result.output).toContain("foreground child done")
          expect(result.output).not.toContain("state: running")
        } finally {
          promptSpy.mockRestore()
        }
      },
    })
  })
})
