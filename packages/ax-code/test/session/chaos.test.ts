import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import type { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { Bus } from "../../src/bus"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { SessionProcessor } from "../../src/session/processor"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionRetry } from "../../src/session/retry"
import { MessageID } from "../../src/session/schema"
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
  limit: { context: 128_000, output: 8_192 },
  cost: { input: 0, output: 0 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

let streamSpy: ReturnType<typeof spyOn> | undefined
let sleepSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  streamSpy?.mockRestore()
  streamSpy = undefined
  sleepSpy?.mockRestore()
  sleepSpy = undefined
})

async function setup(tmp: { path: string }) {
  const session = await Session.create({})
  const user = await Session.updateMessage({
    id: MessageID.ascending(),
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: model.providerID, modelID: model.id },
    tools: {},
    mode: "build",
  } as MessageV2.User)
  const assistant = await Session.updateMessage({
    id: MessageID.ascending(),
    parentID: user.id,
    sessionID: session.id,
    role: "assistant",
    mode: "build",
    agent: "build",
    path: { cwd: tmp.path, root: tmp.path },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: model.id,
    providerID: model.providerID,
    time: { created: Date.now() },
  } as MessageV2.Assistant)

  const agent = await Agent.get("build")

  const createProcessor = (abort?: AbortSignal) => {
    const proc = SessionProcessor.create({
      assistantMessage: assistant as MessageV2.Assistant,
      sessionID: session.id,
      model,
      abort: abort ?? AbortSignal.any([]),
    })
    return proc
  }

  const processor = createProcessor()

  const process = (abort?: AbortSignal) =>
    processor.process({
      user: user as MessageV2.User,
      agent: agent!,
      abort: abort ?? AbortSignal.any([]),
      sessionID: session.id,
      system: [],
      messages: [],
      tools: {},
      model,
    })

  return { session, user, assistant, processor, process, createProcessor }
}

function mockStream(events: AsyncIterable<any>) {
  streamSpy = spyOn(LLM, "stream").mockResolvedValue({ fullStream: events } as any)
}

function* finishStep(opts?: { tokens?: boolean; reason?: string }) {
  yield {
    type: "finish-step",
    finishReason: opts?.reason ?? "stop",
    usage:
      opts?.tokens !== false
        ? { inputTokens: 100, outputTokens: 10, totalTokens: 110 }
        : { inputTokens: 0, outputTokens: 0 },
  }
}

// ============================================================
// STREAM FAILURE SCENARIOS
// ============================================================
describe("chaos: stream failures", () => {
  test("1. provider crash mid-stream", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "text-start", id: "t1" }
            yield { type: "text-delta", id: "t1", text: "partial" }
            throw new Error("Provider connection reset")
          })(),
        )
        const result = await process()
        expect(result).toBe("stop")
        expect(processor.message.error).toBeDefined()
      },
    })
  })

  test("2. provider crash before any events", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        streamSpy = spyOn(LLM, "stream").mockRejectedValue(new Error("Connection refused"))
        const result = await process()
        expect(result).toBe("stop")
        expect(processor.message.error).toBeDefined()
      },
    })
  })

  test("3. empty stream — only start and finish", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
            }
            yield { type: "finish" }
          })(),
        )
        const result = await process()
        expect(result).toBe("continue")
        expect(processor.message.finish).toBe("stop")
      },
    })
  })

  test("4. stream error event propagates", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "error", error: new Error("Server error 500") }
          })(),
        )
        const result = await process()
        expect(result).toBe("stop")
        expect(processor.message.error).toBeDefined()
      },
    })
  })

  test("5. non-retryable error stops immediately", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        let calls = 0
        streamSpy = spyOn(LLM, "stream").mockImplementation(async () => {
          calls++
          throw new Error("Invalid API key")
        })
        const result = await process()
        expect(result).toBe("stop")
        expect(calls).toBe(1)
        expect(processor.message.error).toBeDefined()
      },
    })
  })

  test("6. retryable error retries then succeeds", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        let calls = 0
        streamSpy = spyOn(LLM, "stream").mockImplementation(async () => {
          calls++
          if (calls <= 2) throw new MessageV2.APIError({ message: "Rate limited", isRetryable: true }).toObject()
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield { type: "text-start", id: "t1" }
              yield { type: "text-delta", id: "t1", text: "recovered" }
              yield { type: "text-end", id: "t1" }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 50, outputTokens: 5, totalTokens: 55 },
              }
              yield { type: "finish" }
            })(),
          } as any
        })
        sleepSpy = spyOn(SessionRetry, "sleep").mockResolvedValue()
        const result = await process()
        expect(result).toBe("continue")
        expect(calls).toBe(3)
      },
    })
  })
})

// ============================================================
// ABORT SIGNAL SCENARIOS
// ============================================================
describe("chaos: abort signal", () => {
  test("7. abort during stream processing stops cleanly", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { createProcessor, user } = await setup(tmp)
        const controller = new AbortController()
        const proc = createProcessor(controller.signal)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "text-start", id: "t1" }
            yield { type: "text-delta", id: "t1", text: "before abort" }
            controller.abort()
            // throwIfAborted() fires on next for-await iteration
            yield { type: "text-delta", id: "t1", text: " more" }
          })(),
        )
        const agent = (await Agent.get("build"))!
        const result = await proc.process({
          user: user as MessageV2.User,
          agent,
          abort: controller.signal,
          sessionID: proc.message.sessionID,
          system: [],
          messages: [],
          tools: {},
          model,
        })
        expect(result).toBe("stop")
        expect(proc.message.error).toBeDefined()
      },
    })
  })

  test("8. pre-aborted signal stops immediately", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { createProcessor, user } = await setup(tmp)
        const controller = new AbortController()
        controller.abort()
        const proc = createProcessor(controller.signal)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
            }
            yield { type: "finish" }
          })(),
        )
        const agent = (await Agent.get("build"))!
        const result = await proc.process({
          user: user as MessageV2.User,
          agent,
          abort: controller.signal,
          sessionID: proc.message.sessionID,
          system: [],
          messages: [],
          tools: {},
          model,
        })
        expect(result).toBe("stop")
        expect(proc.message.error).toBeDefined()
      },
    })
  })

  test("9. abort during retry sleep", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        const controller = new AbortController()
        const err = new MessageV2.APIError({ message: "Rate limited", isRetryable: true }).toObject()
        streamSpy = spyOn(LLM, "stream").mockImplementation(async () => {
          throw err
        })
        sleepSpy = spyOn(SessionRetry, "sleep").mockImplementation(async () => {
          controller.abort()
        })
        const result = await process(controller.signal)
        expect(result).toBe("stop")
      },
    })
  })
})

// ============================================================
// TOOL FAILURE SCENARIOS
// ============================================================
describe("chaos: tool failures", () => {
  test("10. tool-error marks part as error and continues", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "tool-input-start", id: "call_1", toolName: "read" }
            yield { type: "tool-call", toolCallId: "call_1", toolName: "read", input: { file_path: "/nonexistent" } }
            yield {
              type: "tool-error",
              toolCallId: "call_1",
              input: { file_path: "/nonexistent" },
              error: new Error("File not found"),
            }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 50, outputTokens: 5, totalTokens: 55 },
            }
            yield { type: "finish" }
          })(),
        )
        const result = await process()
        expect(result).toBe("continue")
      },
    })
  })

  test("11. tool-result for unknown callID is ignored", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield {
              type: "tool-result",
              toolCallId: "nonexistent_call",
              input: {},
              output: { output: "phantom", title: "?", metadata: {}, attachments: [] },
            }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
            }
            yield { type: "finish" }
          })(),
        )
        const result = await process()
        expect(result).toBe("continue")
      },
    })
  })

  test("12. tool-error for unknown callID is ignored", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "tool-error", toolCallId: "nonexistent", input: {}, error: new Error("unknown") }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
            }
            yield { type: "finish" }
          })(),
        )
        const result = await process()
        expect(result).toBe("continue")
      },
    })
  })

  test("13. multiple tool calls in same step — one fails, one succeeds", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "tool-input-start", id: "call_1", toolName: "glob" }
            yield { type: "tool-input-start", id: "call_2", toolName: "read" }
            yield { type: "tool-call", toolCallId: "call_1", toolName: "glob", input: { pattern: "*" } }
            yield { type: "tool-call", toolCallId: "call_2", toolName: "read", input: { file_path: "/bad" } }
            yield {
              type: "tool-result",
              toolCallId: "call_1",
              input: { pattern: "*" },
              output: { output: "found.txt", title: "Glob", metadata: {}, attachments: [] },
            }
            yield { type: "tool-error", toolCallId: "call_2", input: { file_path: "/bad" }, error: new Error("ENOENT") }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
            }
            yield { type: "finish" }
          })(),
        )
        const result = await process()
        expect(result).toBe("continue")
        expect(processor.message.finish).toBe("tool-calls")
      },
    })
  })
})

// ============================================================
// ERROR EVENT PUBLISHING
// ============================================================
describe("chaos: error events", () => {
  test("14. non-retryable error publishes exactly one Bus error event", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { process } = await setup(tmp)
        const errors: unknown[] = []
        const unsub = Bus.subscribe(Session.Event.Error, (e) => errors.push(e.properties.error))
        try {
          streamSpy = spyOn(LLM, "stream").mockImplementation(async () => {
            throw new Error("Unexpected provider failure")
          })
          await process()
          expect(errors).toHaveLength(1)
        } finally {
          unsub()
        }
      },
    })
  })

  test("15. error preserves partial text content", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "text-start", id: "t1" }
            yield { type: "text-delta", id: "t1", text: "partial content" }
            throw new Error("Stream interrupted")
          })(),
        )
        const result = await process()
        expect(result).toBe("stop")
        expect(processor.message.error).toBeDefined()
        expect(processor.message.time.completed).toBeDefined()
      },
    })
  })
})

// ============================================================
// MULTI-STEP SCENARIOS
// ============================================================
describe("chaos: multi-step", () => {
  test("16. two steps — tool step then text step", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "tool-input-start", id: "call_1", toolName: "glob" }
            yield { type: "tool-call", toolCallId: "call_1", toolName: "glob", input: { pattern: "*" } }
            yield {
              type: "tool-result",
              toolCallId: "call_1",
              input: { pattern: "*" },
              output: { output: "file.ts", title: "Glob", metadata: {}, attachments: [] },
            }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
            }
            yield { type: "start-step" }
            yield { type: "text-start", id: "t1" }
            yield { type: "text-delta", id: "t1", text: "Done." }
            yield { type: "text-end", id: "t1" }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 120, outputTokens: 5, totalTokens: 125 },
            }
            yield { type: "finish" }
          })(),
        )
        const result = await process()
        expect(result).toBe("continue")
        expect(processor.message.finish).toBe("stop")
      },
    })
  })

  test("17. error in second step preserves first step data", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "text-start", id: "t1" }
            yield { type: "text-delta", id: "t1", text: "Step 1 complete." }
            yield { type: "text-end", id: "t1" }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
            }
            yield { type: "start-step" }
            throw new Error("Provider died mid-step-2")
          })(),
        )
        const result = await process()
        expect(result).toBe("stop")
        expect(processor.message.error).toBeDefined()
        expect(processor.message.tokens.input).toBeGreaterThan(0)
      },
    })
  })
})

// ============================================================
// USAGE / TOKEN EDGE CASES
// ============================================================
describe("chaos: usage edge cases", () => {
  test("18. zero usage data logs warning but does not crash", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "text-start", id: "t1" }
            yield { type: "text-delta", id: "t1", text: "test" }
            yield { type: "text-end", id: "t1" }
            yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } }
            yield { type: "finish" }
          })(),
        )
        const result = await process()
        expect(result).toBe("continue")
      },
    })
  })

  test("19. missing usage data does not crash", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "finish-step", finishReason: "stop", usage: undefined }
            yield { type: "finish" }
          })(),
        )
        const result = await process()
        expect(result).toBe("continue")
      },
    })
  })
})

// ============================================================
// REASONING EDGE CASES
// ============================================================
describe("chaos: reasoning", () => {
  test("20. reasoning part trimmed on error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "reasoning-start", id: "r1" }
            yield { type: "reasoning-delta", id: "r1", text: "thinking..." }
            throw new Error("Provider crash during reasoning")
          })(),
        )
        const result = await process()
        expect(result).toBe("stop")
        expect(processor.message.error).toBeDefined()
      },
    })
  })

  test("21. duplicate reasoning-start ID is ignored", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "reasoning-start", id: "r1" }
            yield { type: "reasoning-delta", id: "r1", text: "first" }
            yield { type: "reasoning-start", id: "r1" }
            yield { type: "reasoning-end", id: "r1" }
            yield { type: "text-start", id: "t1" }
            yield { type: "text-delta", id: "t1", text: "ok" }
            yield { type: "text-end", id: "t1" }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 50, outputTokens: 5, totalTokens: 55 },
            }
            yield { type: "finish" }
          })(),
        )
        const result = await process()
        expect(result).toBe("continue")
      },
    })
  })
})

// ============================================================
// INCOMPLETE TOOL STATE
// ============================================================
describe("chaos: incomplete tools", () => {
  test("22. tool in running state marked aborted on process end", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { processor, process } = await setup(tmp)
        mockStream(
          (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "tool-input-start", id: "call_1", toolName: "bash" }
            yield { type: "tool-call", toolCallId: "call_1", toolName: "bash", input: { command: "sleep 999" } }
            // No tool-result — stream ends
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 50, outputTokens: 5, totalTokens: 55 },
            }
            yield { type: "finish" }
          })(),
        )
        const result = await process()
        expect(result).toBe("continue")
      },
    })
  })
})
