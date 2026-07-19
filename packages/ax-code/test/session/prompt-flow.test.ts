import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import { APICallError } from "ai"
import path from "path"
import { access } from "node:fs/promises"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import type { SessionID } from "../../src/session/schema"
import { LLM } from "../../src/session/llm"
import { SessionPrompt } from "../../src/session/prompt"
import { MAX_TRUNCATED_MODEL_TURN_RETRIES } from "../../src/session/prompt-loop-config"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { Todo } from "../../src/session/todo"
import { Snapshot } from "../../src/snapshot"
import { Database } from "../../src/storage/db"
import { CodeIntelligence } from "../../src/code-intelligence"
import { AutoIndex } from "../../src/code-intelligence/auto-index"
import { AutonomousCompletionGate } from "../../src/control-plane/autonomous-completion-gate"
import { Bus } from "../../src/bus"
import { tmpdir } from "../fixture/fixture"

const model: Provider.Model = {
  id: "test-model" as any,
  providerID: "test" as any,
  name: "Test",
  family: "test",
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai-compatible",
  },
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  limit: {
    context: 128_000,
    output: 8_192,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

const PREFLIGHT_OVER_BUDGET_CONTEXT_TOKENS = 50_000
const PREFLIGHT_OVER_BUDGET_TEXT_CHARS = 240_000

let streamSpy: MockInstance | undefined
let modelSpy: MockInstance | undefined
let summarySpy: MockInstance | undefined
let trackSpy: MockInstance | undefined
let patchSpy: MockInstance | undefined
let codeStatusSpy: MockInstance | undefined
let startWatcherSpy: MockInstance | undefined
let autoIndexSpy: MockInstance | undefined
let gateSpy: MockInstance | undefined

afterEach(async () => {
  streamSpy?.mockRestore()
  streamSpy = undefined
  modelSpy?.mockRestore()
  modelSpy = undefined
  summarySpy?.mockRestore()
  summarySpy = undefined
  trackSpy?.mockRestore()
  trackSpy = undefined
  patchSpy?.mockRestore()
  patchSpy = undefined
  codeStatusSpy?.mockRestore()
  codeStatusSpy = undefined
  startWatcherSpy?.mockRestore()
  startWatcherSpy = undefined
  autoIndexSpy?.mockRestore()
  autoIndexSpy = undefined
  gateSpy?.mockRestore()
  gateSpy = undefined
})

describe("session.prompt flow", () => {
  test("persists text reply and survives instance reload", async () => {
    await using tmp = await tmpdir({ git: true })

    modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
    summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
    streamSpy = vi.spyOn(LLM, "stream").mockResolvedValue({
      fullStream: (async function* () {
        yield { type: "start" }
        yield { type: "start-step" }
        yield { type: "text-start", id: "text_1" }
        yield { type: "text-delta", id: "text_1", text: "hello from flow" }
        yield { type: "text-end", id: "text_1" }
        yield {
          type: "finish-step",
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        }
        yield { type: "finish" }
      })(),
    } as any)

    let sessionID: string

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Prompt Flow Test" })
        sessionID = session.id

        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "say hello" }],
        })

        expect(msg.info.role).toBe("assistant")
        expect(msg.parts.some((part) => part.type === "text" && part.text.includes("hello from flow"))).toBe(true)
        expect(await SessionStatus.get(session.id)).toEqual({ type: "idle" })

        const before = await Session.messages({ sessionID: session.id })
        expect(before).toHaveLength(2)
        expect(before[0]?.info.role).toBe("user")
        expect(before[1]?.info.role).toBe("assistant")
      },
    })

    await Instance.disposeAll()
    Database.close()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const after = await Session.messages({ sessionID: sessionID! as any })
        expect(after).toHaveLength(2)
        expect(after[1]?.parts.some((part) => part.type === "text" && part.text.includes("hello from flow"))).toBe(true)
        await Session.remove(sessionID! as any)
      },
    })
  })

  test("stops autonomous prompt loop after completion gate allows a finished turn", async () => {
    await using tmp = await tmpdir({ git: true })
    const previousAutonomous = process.env["AX_CODE_AUTONOMOUS"]
    process.env["AX_CODE_AUTONOMOUS"] = "true"

    modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
    summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
    gateSpy = vi.spyOn(AutonomousCompletionGate, "evaluate").mockReturnValue({ status: "allow" })
    streamSpy = vi.spyOn(LLM, "stream").mockResolvedValue({
      fullStream: (async function* () {
        yield { type: "start" }
        yield { type: "start-step" }
        yield { type: "text-start", id: "text_1" }
        yield { type: "text-delta", id: "text_1", text: "hello" }
        yield { type: "text-end", id: "text_1" }
        yield {
          type: "finish-step",
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        }
        yield { type: "finish" }
      })(),
    } as any)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Autonomous Stop Test" })

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "hello" }],
          })

          expect(streamSpy).toHaveBeenCalledTimes(1)
          expect(await SessionStatus.get(session.id)).toEqual({ type: "idle" })
          expect(await Session.messages({ sessionID: session.id })).toHaveLength(2)
        },
      })
    } finally {
      if (previousAutonomous === undefined) delete process.env["AX_CODE_AUTONOMOUS"]
      else process.env["AX_CODE_AUTONOMOUS"] = previousAutonomous
    }
  })

  test("blocks a clearly over-budget first prompt before calling the provider", async () => {
    await using tmp = await tmpdir({ git: true })
    const tinyModel: Provider.Model = {
      ...model,
      limit: {
        context: PREFLIGHT_OVER_BUDGET_CONTEXT_TOKENS,
        output: 20,
      },
    }
    modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(tinyModel)
    summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
    streamSpy = vi.spyOn(LLM, "stream").mockImplementation(async () => {
      throw new Error("provider should not be called for a futile first-turn compaction")
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const errors: unknown[] = []
        const unsubscribe = Bus.subscribe(Session.Event.Error, (event) => {
          errors.push(event.properties)
        })
        try {
          const session = await Session.create({ title: "Prompt Preflight Test" })
          const message = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "x".repeat(PREFLIGHT_OVER_BUDGET_TEXT_CHARS) }],
          })

          expect(streamSpy).not.toHaveBeenCalled()
          expect(
            message.parts.some(
              (part) =>
                part.type === "text" && part.text.includes("Automatic compaction cannot help this new or tiny session"),
            ),
          ).toBe(true)

          const messages = await Session.messages({ sessionID: session.id })
          expect(
            messages.some(
              (entry) => entry.info.role === "user" && entry.parts.some((part) => part.type === "compaction"),
            ),
          ).toBe(false)
          expect(await SessionStatus.get(session.id)).toEqual({ type: "idle" })
          expect(errors).toHaveLength(1)
          expect(errors[0]).toMatchObject({
            sessionID: session.id,
            error: { data: { message: expect.stringContaining("Automatic compaction cannot help") } },
          })
          await Session.remove(session.id)
        } finally {
          unsubscribe()
        }
      },
    })
  })

  test("stops repeated context overflow after compaction instead of looping", async () => {
    await using tmp = await tmpdir({ git: true })
    const agents: string[] = []
    const contextOverflow = new APICallError({
      message: "request requires 30144 tokens (28096 prompt + 2048 max output), exceeding model context length 16384",
      url: "https://example.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 400,
      responseHeaders: { "content-type": "application/json" },
      responseBody: JSON.stringify({
        error: {
          message:
            "request requires 30144 tokens (28096 prompt + 2048 max output), exceeding model context length 16384",
          type: "invalid_request_error",
          code: "context_length_exceeded",
        },
      }),
      isRetryable: false,
    })

    modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
    summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
    streamSpy = vi.spyOn(LLM, "stream").mockImplementation(async (input) => {
      agents.push(input.agent.name)
      if (input.agent.name !== "compaction") throw contextOverflow
      return {
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "start-step" }
          yield { type: "text-start", id: "text_compaction" }
          yield { type: "text-delta", id: "text_compaction", text: "compact summary" }
          yield { type: "text-end", id: "text_compaction" }
          yield {
            type: "finish-step",
            finishReason: "stop",
            usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
          }
          yield { type: "finish" }
        })(),
      } as any
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Repeated Context Overflow Test" })
        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "create a website" }],
        })

        expect(agents).toEqual(["build", "compaction", "build"])
        const messages = await Session.messages({ sessionID: session.id })
        const lastAssistant = messages.findLast((message) => message.info.role === "assistant")
        expect(lastAssistant?.info.role).toBe("assistant")
        if (!lastAssistant || lastAssistant.info.role !== "assistant") throw new Error("missing assistant message")
        expect(lastAssistant?.info.error?.data.message).toContain(
          "still exceeds the model context window after compaction",
        )
        await Session.remove(session.id)
      },
    })
  })

  test("defers automatic indexing until after the prompt completes", async () => {
    await using tmp = await tmpdir({ git: true })

    modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
    summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
    codeStatusSpy = vi.spyOn(CodeIntelligence, "status").mockReturnValue({
      projectID: "proj_test" as any,
      lastCommitSha: null,
      nodeCount: 0,
      edgeCount: 0,
      lastUpdated: null,
    })
    startWatcherSpy = vi.spyOn(CodeIntelligence, "startWatcher").mockImplementation(() => {})

    let promptResolved = false
    autoIndexSpy = vi.spyOn(AutoIndex, "maybeStart").mockImplementation(() => {
      expect(promptResolved).toBe(true)
    })

    streamSpy = vi.spyOn(LLM, "stream").mockResolvedValue({
      fullStream: (async function* () {
        yield { type: "start" }
        yield { type: "start-step" }
        yield { type: "text-start", id: "text_1" }
        yield { type: "text-delta", id: "text_1", text: "hello from flow" }
        yield { type: "text-end", id: "text_1" }
        yield {
          type: "finish-step",
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        }
        yield { type: "finish" }
      })(),
    } as any)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Deferred Auto Index Test" })

        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "say hello" }],
        })
        promptResolved = true

        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(startWatcherSpy).toHaveBeenCalledWith(Instance.project.id)
        expect(autoIndexSpy).toHaveBeenCalledWith(Instance.project.id)

        await Session.remove(session.id)
      },
    })
  })

  test("does not schedule todo auto-continuation after the agent step limit is reached", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            steps: 1,
          },
        },
        session: {
          max_continuations: 0,
        },
      },
    })

    const previousAutonomous = process.env["AX_CODE_AUTONOMOUS"]
    process.env["AX_CODE_AUTONOMOUS"] = "true"

    try {
      modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
      summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
      streamSpy = vi.spyOn(LLM, "stream").mockResolvedValue({
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "start-step" }
          yield { type: "text-start", id: "text_1" }
          yield { type: "text-delta", id: "text_1", text: "I still need to write the bug report." }
          yield { type: "text-end", id: "text_1" }
          yield {
            type: "finish-step",
            finishReason: "stop",
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          }
          yield { type: "finish" }
        })(),
      } as any)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Todo Step Limit Test" })
          Todo.update({
            sessionID: session.id,
            todos: [{ content: "Write bug reports to .internal/bugs/", status: "in_progress", priority: "high" }],
          })

          const msg = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "continue the bug sweep" }],
          })

          expect(msg.info.role).toBe("assistant")
          expect(streamSpy).toHaveBeenCalledTimes(1)

          const messages = await Session.messages({ sessionID: session.id })
          expect(messages).toHaveLength(2)
          expect(messages.map((message) => message.info.role)).toEqual(["user", "assistant"])
          const assistant = messages[1]?.info
          expect(assistant?.role).toBe("assistant")
          if (assistant?.role !== "assistant") throw new Error("expected assistant")
          expect(assistant.error?.data.message).toContain("unfinished todo")
          expect(
            messages.some(
              (message) =>
                message.info.role === "user" &&
                message.parts.some(
                  (part) =>
                    part.type === "text" &&
                    part.text.includes("You stopped with 1 todo still pending") &&
                    part.text.includes("auto-continuation"),
                ),
            ),
          ).toBe(false)

          expect(Todo.get(session.id)).toEqual([
            { content: "Write bug reports to .internal/bugs/", status: "in_progress", priority: "high" },
          ])

          await Session.remove(session.id)
        },
      })
    } finally {
      if (previousAutonomous === undefined) delete process.env["AX_CODE_AUTONOMOUS"]
      else process.env["AX_CODE_AUTONOMOUS"] = previousAutonomous
    }
  })

  test("auto-continues before autonomous agent step limit disables tools", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            steps: 2,
          },
        },
        session: {
          max_continuations: 1,
          max_todo_retries: 3,
        },
      },
    })

    const previousAutonomous = process.env["AX_CODE_AUTONOMOUS"]
    process.env["AX_CODE_AUTONOMOUS"] = "true"

    try {
      let sessionID: SessionID | undefined
      let call = 0
      modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
      summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
      streamSpy = vi.spyOn(LLM, "stream").mockImplementation(async () => {
        call++
        if (call === 2 && sessionID) {
          Todo.update({
            sessionID,
            todos: [{ content: "Finish the autonomous task", status: "completed", priority: "high" }],
          })
        }
        return {
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "text-start", id: `text_${call}` }
            yield { type: "text-delta", id: `text_${call}`, text: call === 1 ? "still working" : "done" }
            yield { type: "text-end", id: `text_${call}` }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            }
            yield { type: "finish" }
          })(),
        } as any
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Agent Step Limit Continuation Test" })
          sessionID = session.id
          Todo.update({
            sessionID: session.id,
            todos: [{ content: "Finish the autonomous task", status: "in_progress", priority: "high" }],
          })

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "finish this task autonomously" }],
          })

          expect(streamSpy).toHaveBeenCalledTimes(2)
          const messages = await Session.messages({ sessionID: session.id })
          expect(
            messages.some(
              (message) =>
                message.info.role === "user" &&
                message.parts.some(
                  (part) =>
                    part.type === "text" &&
                    part.text.includes("Autonomous mode reached the build agent step limit") &&
                    part.text.includes("agent step-limit auto-continuation"),
                ),
            ),
          ).toBe(true)
          expect(Todo.get(session.id)).toEqual([
            { content: "Finish the autonomous task", status: "completed", priority: "high" },
          ])

          await Session.remove(session.id)
        },
      })
    } finally {
      if (previousAutonomous === undefined) delete process.env["AX_CODE_AUTONOMOUS"]
      else process.env["AX_CODE_AUTONOMOUS"] = previousAutonomous
    }
  })

  test("does not stop unchanged autonomous todos before max_todo_retries is exhausted", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            steps: 20,
          },
        },
        session: {
          max_todo_retries: 4,
        },
      },
    })

    const previousAutonomous = process.env["AX_CODE_AUTONOMOUS"]
    process.env["AX_CODE_AUTONOMOUS"] = "true"

    try {
      let sessionID: SessionID | undefined
      let call = 0
      modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
      summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
      streamSpy = vi.spyOn(LLM, "stream").mockImplementation(async () => {
        call++
        if (call === 4 && sessionID) {
          Todo.update({
            sessionID,
            todos: [{ content: "Write bug report", status: "completed", priority: "high" }],
          })
        }
        return {
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "text-start", id: `text_${call}` }
            yield { type: "text-delta", id: `text_${call}`, text: call === 4 ? "report finished" : "still pending" }
            yield { type: "text-end", id: `text_${call}` }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            }
            yield { type: "finish" }
          })(),
        } as any
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Todo Retry Budget Test" })
          sessionID = session.id
          Todo.update({
            sessionID: session.id,
            todos: [{ content: "Write bug report", status: "in_progress", priority: "high" }],
          })

          const msg = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "write the bug report" }],
          })

          expect(streamSpy).toHaveBeenCalledTimes(4)
          expect(msg.info.role).toBe("assistant")
          if (msg.info.role !== "assistant") throw new Error("expected assistant")
          expect(msg.info.error).toBeUndefined()
          expect(Todo.get(session.id)).toEqual([{ content: "Write bug report", status: "completed", priority: "high" }])

          await Session.remove(session.id)
        },
      })
    } finally {
      if (previousAutonomous === undefined) delete process.env["AX_CODE_AUTONOMOUS"]
      else process.env["AX_CODE_AUTONOMOUS"] = previousAutonomous
    }
  })

  test("persists tool and patch parts for a tool-using step", async () => {
    await using tmp = await tmpdir({ git: true })

    modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
    summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
    trackSpy = vi.spyOn(Snapshot, "track").mockResolvedValue("snap-1")
    patchSpy = vi.spyOn(Snapshot, "patch").mockResolvedValue({
      hash: "snap-1",
      files: [path.join(tmp.path, "src/file.ts")],
    })
    let call = 0
    streamSpy = vi.spyOn(LLM, "stream").mockImplementation(async () => {
      call++
      if (call === 1) {
        return {
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "tool-input-start", id: "call_1", toolName: "read" }
            yield { type: "tool-call", toolCallId: "call_1", toolName: "read", input: { file: "src/file.ts" } }
            yield {
              type: "tool-result",
              toolCallId: "call_1",
              input: { file: "src/file.ts" },
              output: {
                output: "file body",
                title: "Read src/file.ts",
                metadata: {},
                attachments: [],
              },
            }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
            }
            yield { type: "finish" }
          })(),
        } as any
      }

      return {
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "start-step" }
          yield { type: "text-start", id: "text_1" }
          yield { type: "text-delta", id: "text_1", text: "done" }
          yield { type: "text-end", id: "text_1" }
          yield {
            type: "finish-step",
            finishReason: "stop",
            usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
          }
          yield { type: "finish" }
        })(),
      } as any
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Prompt Tool Flow Test" })

        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "inspect file" }],
        })

        expect(msg.info.role).toBe("assistant")
        expect(msg.parts.some((part) => part.type === "text" && part.text === "done")).toBe(true)

        const stored = await Session.messages({ sessionID: session.id })
        expect(stored).toHaveLength(3)

        const toolStep = stored.find(
          (message) =>
            message.info.role === "assistant" &&
            message.parts.some((part) => part.type === "tool" && part.state.status === "completed"),
        )
        expect(toolStep).toBeDefined()
        expect(toolStep?.parts.some((part) => part.type === "step-start")).toBe(true)
        expect(toolStep?.parts.some((part) => part.type === "step-finish" && part.reason === "tool-calls")).toBe(true)
        expect(toolStep?.parts.some((part) => part.type === "patch" && part.hash === "snap-1")).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("persists partial assistant text on cancel and allows later recovery", async () => {
    await using tmp = await tmpdir({ git: true })

    modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
    summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()

    let call = 0
    let readyResolve!: () => void
    const ready = new Promise<void>((resolve) => {
      readyResolve = resolve
    })

    streamSpy = vi.spyOn(LLM, "stream").mockImplementation(async (input) => {
      call++
      if (call === 1) {
        return {
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "text-start", id: "text_1" }
            yield { type: "text-delta", id: "text_1", text: "partial answer" }
            readyResolve()
            await new Promise((_, reject) => {
              input.abort.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
                once: true,
              })
            })
          })(),
        } as any
      }

      return {
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "start-step" }
          yield { type: "text-start", id: "text_2" }
          yield { type: "text-delta", id: "text_2", text: "recovered answer" }
          yield { type: "text-end", id: "text_2" }
          yield {
            type: "finish-step",
            finishReason: "stop",
            usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 },
          }
          yield { type: "finish" }
        })(),
      } as any
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Prompt Abort Flow Test" })

        const pending = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "start work" }],
        })

        await ready
        await SessionPrompt.cancel(session.id)

        const aborted = await pending
        expect(aborted.info.role).toBe("assistant")
        if (aborted.info.role === "assistant") {
          expect(aborted.info.error?.name).toBe("MessageAbortedError")
        }
        expect(await SessionStatus.get(session.id)).toEqual({ type: "idle" })

        const stored = await Session.messages({ sessionID: session.id })
        expect(stored).toHaveLength(2)
        expect(stored[1]?.parts.some((part) => part.type === "text" && part.text.includes("partial answer"))).toBe(true)

        const recovered = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "continue" }],
        })

        expect(recovered.info.role).toBe("assistant")
        expect(recovered.parts.some((part) => part.type === "text" && part.text.includes("recovered answer"))).toBe(
          true,
        )

        const all = await Session.messages({ sessionID: session.id })
        expect(all).toHaveLength(4)
        expect(all[1]?.info.role).toBe("assistant")
        expect(all[3]?.parts.some((part) => part.type === "text" && part.text.includes("recovered answer"))).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("stops cleanly after a permission-rejected tool call and allows later recovery", async () => {
    // The "stop on deny" path is gated by `shouldBreak`, which is forced
    // to false in autonomous mode (session/processor.ts:184-187). That
    // mode is the runtime default, so this test must explicitly opt out
    // to exercise the human-loop break-on-deny semantic. The autonomous
    // path has separate coverage.
    const originalAutonomous = process.env.AX_CODE_AUTONOMOUS
    process.env.AX_CODE_AUTONOMOUS = "false"
    await using tmp = await tmpdir({ git: true })

    modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
    summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()

    let call = 0
    streamSpy = vi.spyOn(LLM, "stream").mockImplementation(async () => {
      call++
      if (call === 1) {
        return {
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "tool-input-start", id: "call_1", toolName: "edit" }
            yield { type: "tool-call", toolCallId: "call_1", toolName: "edit", input: { file: "src/file.ts" } }
            yield {
              type: "tool-error",
              toolCallId: "call_1",
              input: { file: "src/file.ts" },
              error: new Permission.RejectedError(),
            }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
            }
            yield { type: "finish" }
          })(),
        } as any
      }

      return {
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "start-step" }
          yield { type: "text-start", id: "text_3" }
          yield { type: "text-delta", id: "text_3", text: "continued after denial" }
          yield { type: "text-end", id: "text_3" }
          yield {
            type: "finish-step",
            finishReason: "stop",
            usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 },
          }
          yield { type: "finish" }
        })(),
      } as any
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Prompt Permission Flow Test" })

        const denied = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "edit file" }],
        })

        expect(denied.info.role).toBe("assistant")
        expect(await SessionStatus.get(session.id)).toEqual({ type: "idle" })

        const stored = await Session.messages({ sessionID: session.id })
        expect(stored).toHaveLength(2)
        expect(stored[1]?.parts.some((part) => part.type === "tool" && part.state.status === "error")).toBe(true)
        expect(stored[1]?.parts.some((part) => part.type === "step-finish" && part.reason === "tool-calls")).toBe(true)

        const recovered = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "continue without edit" }],
        })

        expect(recovered.info.role).toBe("assistant")
        expect(
          recovered.parts.some((part) => part.type === "text" && part.text.includes("continued after denial")),
        ).toBe(true)

        const all = await Session.messages({ sessionID: session.id })
        expect(all).toHaveLength(4)

        await Session.remove(session.id)
      },
    })
    if (originalAutonomous === undefined) delete process.env.AX_CODE_AUTONOMOUS
    else process.env.AX_CODE_AUTONOMOUS = originalAutonomous
  })

  test("injects a continuation message when autonomous completion gate blocks on empty subagent result", async () => {
    await using tmp = await tmpdir({ git: true })

    const previousAutonomous = process.env["AX_CODE_AUTONOMOUS"]
    process.env["AX_CODE_AUTONOMOUS"] = "true"

    try {
      modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
      summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()

      // Gate: blocked first two calls, then allow on third
      let gateCallCount = 0
      gateSpy = vi.spyOn(AutonomousCompletionGate, "evaluate").mockImplementation(() => {
        gateCallCount++
        if (gateCallCount <= 2) {
          return {
            status: "blocked",
            reason: "empty_subagent_result",
            signature: `empty:call_1:ses_child:task`,
            message: "Subagent ses_child completed without a usable final response.",
            emptyResult: { callID: "call_1", taskID: "ses_child", description: "task" },
          }
        }
        return { status: "allow" }
      })

      streamSpy = vi.spyOn(LLM, "stream").mockImplementation(
        async () =>
          ({
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield { type: "text-start", id: "text_1" }
              yield { type: "text-delta", id: "text_1", text: "done" }
              yield { type: "text-end", id: "text_1" }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
              }
              yield { type: "finish" }
            })(),
          }) as any,
      )

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Completion Gate Test" })

          const msg = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "run a subagent task" }],
          })

          expect(msg.info.role).toBe("assistant")
          // Gate blocked twice → two continuation user messages injected → three LLM calls total
          expect(streamSpy).toHaveBeenCalledTimes(3)

          const messages = await Session.messages({ sessionID: session.id })
          const userMessages = messages.filter((m) => m.info.role === "user")
          // Original user message + two gate-injected continuation messages
          expect(userMessages).toHaveLength(3)
          const gateMessages = userMessages.filter((m) =>
            m.parts.some((p) => p.type === "text" && p.text.includes("completion gate")),
          )
          expect(gateMessages).toHaveLength(2)

          await Session.remove(session.id)
        },
      })
    } finally {
      if (previousAutonomous === undefined) delete process.env["AX_CODE_AUTONOMOUS"]
      else process.env["AX_CODE_AUTONOMOUS"] = previousAutonomous
    }
  })

  test("stops the session when autonomous completion gate retries are exhausted", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { agent: { build: { steps: 10 } } },
    })

    const previousAutonomous = process.env["AX_CODE_AUTONOMOUS"]
    process.env["AX_CODE_AUTONOMOUS"] = "true"

    try {
      modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
      summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()

      // Gate always blocks with the same signature (no new empty result between retries)
      gateSpy = vi.spyOn(AutonomousCompletionGate, "evaluate").mockReturnValue({
        status: "blocked",
        reason: "empty_subagent_result",
        signature: "empty:call_1:ses_stuck:task",
        message: "Subagent ses_stuck completed without a usable final response.",
        emptyResult: { callID: "call_1", taskID: "ses_stuck", description: "task" },
      })

      streamSpy = vi.spyOn(LLM, "stream").mockImplementation(
        async () =>
          ({
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield { type: "text-start", id: "text_1" }
              yield { type: "text-delta", id: "text_1", text: "still stuck" }
              yield { type: "text-end", id: "text_1" }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
              }
              yield { type: "finish" }
            })(),
          }) as any,
      )

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let errorPublished = false
          const busUnsub = Bus.subscribe(Session.Event.Error, () => {
            errorPublished = true
          })

          const session = await Session.create({ title: "Gate Exhausted Test" })

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "run a subagent task" }],
          })

          busUnsub()

          // maxCompletionGateRetries is 2, so after initial + 2 retries it stops (3 LLM calls max)
          expect(streamSpy!.mock.calls.length).toBeLessThanOrEqual(4)
          expect(errorPublished).toBe(true)

          await Session.remove(session.id)
        },
      })
    } finally {
      if (previousAutonomous === undefined) delete process.env["AX_CODE_AUTONOMOUS"]
      else process.env["AX_CODE_AUTONOMOUS"] = previousAutonomous
    }
  })

  test("stops when a non-toolcall model emits a tool call as text", async () => {
    await using tmp = await tmpdir({ git: true })

    const previousAutonomous = process.env["AX_CODE_AUTONOMOUS"]
    process.env["AX_CODE_AUTONOMOUS"] = "true"

    try {
      modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue({
        ...model,
        capabilities: {
          ...model.capabilities,
          toolcall: false,
        },
      })
      summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
      streamSpy = vi.spyOn(LLM, "stream").mockImplementation(
        async () =>
          ({
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield { type: "text-start", id: "text_1" }
              yield {
                type: "text-delta",
                id: "text_1",
                text: [
                  "I'll create the website now.",
                  "<tool_call>",
                  '<function=write_file write={"filepath":"/work/coffee-shop/index.html","content":"<html></html>"}>',
                  "</tool_call>",
                ].join("\n"),
              }
              yield { type: "text-end", id: "text_1" }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
              }
              yield { type: "finish" }
            })(),
          }) as any,
      )

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let errorPublished = false
          const busUnsub = Bus.subscribe(Session.Event.Error, () => {
            errorPublished = true
          })

          const session = await Session.create({ title: "Fake Tool Text Test" })

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "create a coffee shop website and save it in this project" }],
          })

          busUnsub()

          expect(streamSpy).toHaveBeenCalledTimes(1)
          expect(errorPublished).toBe(true)

          const messages = await Session.messages({ sessionID: session.id })
          const assistant = messages.findLast((message) => message.info.role === "assistant")
          expect(JSON.stringify(assistant?.info)).toContain("plain text")
          expect(
            assistant?.parts.some((part) => part.type === "text" && part.text.includes("<function=write_file")),
          ).toBe(true)
          expect(
            await access(path.join(tmp.path, "coffee-shop/index.html")).then(
              () => true,
              () => false,
            ),
          ).toBe(false)

          await Session.remove(session.id)
        },
      })
    } finally {
      if (previousAutonomous === undefined) delete process.env["AX_CODE_AUTONOMOUS"]
      else process.env["AX_CODE_AUTONOMOUS"] = previousAutonomous
    }
  })

  test("nudges autonomous todo convergence before the final agent step", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            steps: 7,
          },
        },
        session: {
          max_todo_retries: 1,
        },
      },
    })

    const previousAutonomous = process.env["AX_CODE_AUTONOMOUS"]
    process.env["AX_CODE_AUTONOMOUS"] = "true"

    try {
      modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
      summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
      trackSpy = vi.spyOn(Snapshot, "track").mockResolvedValue("snap-1")
      patchSpy = vi.spyOn(Snapshot, "patch").mockResolvedValue({
        hash: "snap-1",
        files: [path.join(tmp.path, "src/file.ts")],
      })

      let call = 0
      streamSpy = vi.spyOn(LLM, "stream").mockImplementation(async () => {
        call++
        if (call === 1) {
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield { type: "tool-input-start", id: "call_1", toolName: "read" }
              yield { type: "tool-call", toolCallId: "call_1", toolName: "read", input: { file: "src/file.ts" } }
              yield {
                type: "tool-result",
                toolCallId: "call_1",
                input: { file: "src/file.ts" },
                output: {
                  output: "file body",
                  title: "Read src/file.ts",
                  metadata: {},
                  attachments: [],
                },
              }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
              }
              yield { type: "finish" }
            })(),
          } as any
        }

        return {
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "text-start", id: `text_${call}` }
            yield { type: "text-delta", id: `text_${call}`, text: "still pending" }
            yield { type: "text-end", id: `text_${call}` }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
            }
            yield { type: "finish" }
          })(),
        } as any
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Todo Deadline Convergence Test" })
          Todo.update({
            sessionID: session.id,
            todos: [
              { content: "Write remaining bug report", status: "in_progress", priority: "high" },
              { content: "Write second bug report", status: "pending", priority: "high" },
              { content: "Write third bug report", status: "pending", priority: "high" },
              { content: "Write fourth bug report", status: "pending", priority: "medium" },
              { content: "Cancel low-confidence report", status: "pending", priority: "low" },
            ],
          })

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "continue bug reporting" }],
          })

          const messages = await Session.messages({ sessionID: session.id })
          const convergenceMessages = messages.filter(
            (message) =>
              message.info.role === "user" &&
              message.parts.some(
                (part) =>
                  part.type === "text" &&
                  part.text.includes("Autonomous mode is approaching the agent step limit") &&
                  part.text.includes("Write remaining bug report") &&
                  part.text.includes("5 unfinished todos") &&
                  part.text.includes("create the required .internal/bugs report now") &&
                  part.text.includes("cancel that report todo with the concrete reason"),
              ),
          )
          expect(convergenceMessages).toHaveLength(1)

          await Session.remove(session.id)
        },
      })
    } finally {
      if (previousAutonomous === undefined) delete process.env["AX_CODE_AUTONOMOUS"]
      else process.env["AX_CODE_AUTONOMOUS"] = previousAutonomous
    }
  })

  test("nudges report todo convergence before large context keeps growing", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            steps: 30,
          },
        },
        session: {
          max_todo_retries: 1,
        },
      },
    })

    const previousAutonomous = process.env["AX_CODE_AUTONOMOUS"]
    process.env["AX_CODE_AUTONOMOUS"] = "true"

    try {
      modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
      summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
      trackSpy = vi.spyOn(Snapshot, "track").mockResolvedValue("snap-1")
      patchSpy = vi.spyOn(Snapshot, "patch").mockResolvedValue({
        hash: "snap-1",
        files: [path.join(tmp.path, "src/file.ts")],
      })

      let call = 0
      streamSpy = vi.spyOn(LLM, "stream").mockImplementation(async () => {
        call++
        if (call === 1) {
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield { type: "tool-input-start", id: "call_1", toolName: "read" }
              yield { type: "tool-call", toolCallId: "call_1", toolName: "read", input: { file: "src/file.ts" } }
              yield {
                type: "tool-result",
                toolCallId: "call_1",
                input: { file: "src/file.ts" },
                output: {
                  output: "large file body",
                  title: "Read src/file.ts",
                  metadata: {},
                  attachments: [],
                },
              }
              yield {
                type: "finish-step",
                finishReason: "tool-calls",
                usage: { inputTokens: 55_000, outputTokens: 8, totalTokens: 55_008 },
              }
              yield { type: "finish" }
            })(),
          } as any
        }

        return {
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "text-start", id: `text_${call}` }
            yield { type: "text-delta", id: `text_${call}`, text: "closing report todo" }
            yield { type: "text-end", id: `text_${call}` }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
            }
            yield { type: "finish" }
          })(),
        } as any
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Report Context Convergence Test" })
          Todo.update({
            sessionID: session.id,
            todos: [
              { content: "Manually inspect critical Rust code paths", status: "in_progress", priority: "high" },
              { content: "Report confirmed bugs to .internal/bugs/", status: "pending", priority: "high" },
            ],
          })

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "continue bug reporting" }],
          })

          const messages = await Session.messages({ sessionID: session.id })
          const convergenceMessages = messages.filter(
            (message) =>
              message.info.role === "user" &&
              message.parts.some(
                (part) =>
                  part.type === "text" &&
                  part.text.includes("Autonomous mode has reached a large context") &&
                  part.text.includes("Report confirmed bugs to .internal/bugs/") &&
                  part.text.includes("do not read more files for broad exploration"),
              ),
          )
          expect(convergenceMessages).toHaveLength(1)

          await Session.remove(session.id)
        },
      })
    } finally {
      if (previousAutonomous === undefined) delete process.env["AX_CODE_AUTONOMOUS"]
      else process.env["AX_CODE_AUTONOMOUS"] = previousAutonomous
    }
  })

  test("renudges large-context report todos after autonomous step-limit continuation", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            steps: 2,
          },
        },
        session: {
          max_continuations: 2,
          max_todo_retries: 3,
        },
      },
    })

    const previousAutonomous = process.env["AX_CODE_AUTONOMOUS"]
    process.env["AX_CODE_AUTONOMOUS"] = "true"

    try {
      let sessionID: SessionID | undefined
      const agents: string[] = []
      modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
      summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
      trackSpy = vi.spyOn(Snapshot, "track").mockResolvedValue("snap-1")
      patchSpy = vi.spyOn(Snapshot, "patch").mockResolvedValue({
        hash: "snap-1",
        files: [path.join(tmp.path, "src/file.ts")],
      })

      let call = 0
      streamSpy = vi.spyOn(LLM, "stream").mockImplementation(async (input) => {
        agents.push(input.agent.name)
        call++
        if (call === 3 && sessionID) {
          Todo.update({
            sessionID,
            todos: [{ content: "Report confirmed bugs to .internal/bugs/", status: "completed", priority: "high" }],
          })
        }

        return {
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            if (call < 3) {
              yield { type: "tool-input-start", id: `call_${call}`, toolName: "read" }
              yield { type: "tool-call", toolCallId: `call_${call}`, toolName: "read", input: { file: "src/file.ts" } }
              yield {
                type: "tool-result",
                toolCallId: `call_${call}`,
                input: { file: "src/file.ts" },
                output: {
                  output: "large file body",
                  title: "Read src/file.ts",
                  metadata: {},
                  attachments: [],
                },
              }
              yield {
                type: "finish-step",
                finishReason: "tool-calls",
                usage: { inputTokens: 55_000, outputTokens: 8, totalTokens: 55_008 },
              }
            } else {
              yield { type: "text-start", id: "text_3" }
              yield { type: "text-delta", id: "text_3", text: "report todo completed" }
              yield { type: "text-end", id: "text_3" }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
              }
            }
            yield { type: "finish" }
          })(),
        } as any
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Report Context Step Continuation Test" })
          sessionID = session.id
          Todo.update({
            sessionID: session.id,
            todos: [{ content: "Report confirmed bugs to .internal/bugs/", status: "in_progress", priority: "high" }],
          })

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "continue report writing" }],
          })

          expect(streamSpy).toHaveBeenCalledTimes(3)
          expect(agents).toEqual(["build", "build", "build"])
          const messages = await Session.messages({ sessionID: session.id })
          const convergenceMessages = messages.filter(
            (message) =>
              message.info.role === "user" &&
              message.parts.some(
                (part) =>
                  part.type === "text" &&
                  part.text.includes("Autonomous mode has reached a large context") &&
                  part.text.includes("Report confirmed bugs to .internal/bugs/"),
              ),
          )
          expect(convergenceMessages).toHaveLength(2)

          await Session.remove(session.id)
        },
      })
    } finally {
      if (previousAutonomous === undefined) delete process.env["AX_CODE_AUTONOMOUS"]
      else process.env["AX_CODE_AUTONOMOUS"] = previousAutonomous
    }
  })

  test("stops autonomous mode with a diagnostic after repeated empty model turns", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            steps: 10,
          },
        },
      },
    })

    const previousAutonomous = process.env["AX_CODE_AUTONOMOUS"]
    process.env["AX_CODE_AUTONOMOUS"] = "true"

    try {
      modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
      summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
      streamSpy = vi.spyOn(LLM, "stream").mockImplementation(
        async () =>
          ({
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield {
                type: "finish-step",
                finishReason: "other",
                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              }
              yield { type: "finish" }
            })(),
          }) as any,
      )

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Empty Model Turn Test" })
          Todo.update({
            sessionID: session.id,
            todos: [{ content: "Write bug reports to .internal/bugs/", status: "in_progress", priority: "high" }],
          })

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "continue bug reporting" }],
          })

          expect(streamSpy).toHaveBeenCalledTimes(2)

          const messages = await Session.messages({ sessionID: session.id })
          expect(
            messages.some(
              (message) =>
                message.info.role === "user" &&
                message.parts.some(
                  (part) =>
                    part.type === "text" &&
                    part.text.includes("The previous autonomous model turn returned no text and no tool calls") &&
                    part.text.includes("empty-turn recovery"),
                ),
            ),
          ).toBe(true)

          const assistantMessages = messages.filter((message) => message.info.role === "assistant")
          const lastAssistant = assistantMessages.at(-1)?.info
          expect(lastAssistant?.role).toBe("assistant")
          if (lastAssistant?.role !== "assistant") throw new Error("expected assistant")
          expect(lastAssistant.error?.data.message).toContain("empty model turn")

          await Session.remove(session.id)
        },
      })
    } finally {
      if (previousAutonomous === undefined) delete process.env["AX_CODE_AUTONOMOUS"]
      else process.env["AX_CODE_AUTONOMOUS"] = previousAutonomous
    }
  })

  test("does not complete autonomous mode after repeated truncated model turns", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            steps: 10,
          },
        },
      },
    })

    const previousAutonomous = process.env["AX_CODE_AUTONOMOUS"]
    process.env["AX_CODE_AUTONOMOUS"] = "true"

    try {
      modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
      summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
      streamSpy = vi.spyOn(LLM, "stream").mockImplementation(
        async () =>
          ({
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield { type: "text-start", id: "text_1" }
              yield { type: "text-delta", id: "text_1", text: "partial generated answer" }
              yield { type: "text-end", id: "text_1" }
              yield {
                type: "finish-step",
                finishReason: "length",
                usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
              }
              yield { type: "finish" }
            })(),
          }) as any,
      )

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Truncated Model Turn Test" })

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "create a small website" }],
          })

          expect(streamSpy).toHaveBeenCalledTimes(MAX_TRUNCATED_MODEL_TURN_RETRIES + 1)

          const messages = await Session.messages({ sessionID: session.id })
          expect(
            messages.some(
              (message) =>
                message.info.role === "user" &&
                message.parts.some(
                  (part) =>
                    part.type === "text" &&
                    part.text.includes("The previous autonomous model turn was truncated by the provider") &&
                    part.text.includes("truncated-turn recovery"),
                ),
            ),
          ).toBe(true)

          const assistantMessages = messages.filter((message) => message.info.role === "assistant")
          const lastAssistant = assistantMessages.at(-1)?.info
          expect(lastAssistant?.role).toBe("assistant")
          if (lastAssistant?.role !== "assistant") throw new Error("expected assistant")
          expect(lastAssistant.error?.data.message).toContain("truncated model turn")

          await Session.remove(session.id)
        },
      })
    } finally {
      if (previousAutonomous === undefined) delete process.env["AX_CODE_AUTONOMOUS"]
      else process.env["AX_CODE_AUTONOMOUS"] = previousAutonomous
    }
  })
})
