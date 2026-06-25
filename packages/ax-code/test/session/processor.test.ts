import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import path from "path"
import { readFile } from "fs/promises"
import { Agent } from "../../src/agent/agent"
import type { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { Bus } from "../../src/bus"
import { Permission } from "../../src/permission"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { SessionProcessor } from "../../src/session/processor"
import { MessageV2 } from "../../src/session/message-v2"
import { resolvePromptLoopErrorTransition } from "../../src/session/prompt-loop-errors"
import { providerFallbackSwitchState } from "../../src/session/prompt-helpers"
import { SessionRetry } from "../../src/session/retry"
import { MessageID, SessionID } from "../../src/session/schema"
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

let streamSpy: MockInstance | undefined
let sleepSpy: MockInstance | undefined

afterEach(() => {
  streamSpy?.mockRestore()
  streamSpy = undefined
  sleepSpy?.mockRestore()
  sleepSpy = undefined
})

describe("session.processor", () => {
  test("flushes pending deltas before breaking for compaction", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/session/processor-impl.ts"), "utf-8")
    const start = src.indexOf("if (needsCompaction) {")
    const end = src.indexOf("\n                break", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)

    expect(src.slice(start, end)).toContain("deltaBatcher.flush()")
    expect(src.slice(start, end)).toContain("persistFinalizedInFlightParts({ overwriteEndTime: false })")
  })

  test("finalizes in-flight parts before processor error handling", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/session/processor-impl.ts"), "utf-8")
    const catchStart = src.indexOf("} catch (e: unknown) {")
    const retryStart = src.indexOf("const errStack", catchStart)
    expect(catchStart).toBeGreaterThan(-1)
    expect(retryStart).toBeGreaterThan(catchStart)
    expect(src.slice(catchStart, retryStart)).toContain("persistFinalizedInFlightParts({ overwriteEndTime: true })")
  })

  test("resets short-lived tool loop state across compaction", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/session/processor-impl.ts"), "utf-8")
    expect(src).toContain("const resetShortLivedToolLoopState = () => {")
    expect(src).toContain("recentToolRing.length = 0")
    expect(src).toContain("toolCallTimestamps.length = 0")
    expect(src).toContain("for (const key of Object.keys(toolInputCache)) delete toolInputCache[key]")
    const start = src.indexOf("if (needsCompaction) {")
    const end = src.indexOf("\n                break", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(src.slice(start, end)).toContain("resetShortLivedToolLoopState()")
  })

  test("resets short-lived tool loop state across processor errors", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/session/processor-impl.ts"), "utf-8")
    const catchStart = src.indexOf("} catch (e: unknown) {")
    const retryStart = src.indexOf("const retry = SessionRetry.retryable(error)", catchStart)
    expect(catchStart).toBeGreaterThan(-1)
    expect(retryStart).toBeGreaterThan(catchStart)
    expect(src.slice(catchStart, retryStart)).toContain("resetShortLivedToolLoopState()")
  })

  test("continue-loop-on-deny config is read per process call", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/session/processor-impl.ts"), "utf-8")
    expect(src).not.toContain("cachedShouldBreak")
    expect(src).toContain(
      "const shouldBreak = autonomous ? false : (await Config.get()).experimental?.continue_loop_on_deny !== true",
    )
  })

  test("delta batch timer does not keep the process alive", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/session/processor-impl.ts"), "utf-8")
    const start = src.indexOf("function createDeltaBatcher")
    const end = src.indexOf("export type Info", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const batcher = src.slice(start, end)
    expect(batcher).toContain("timer = setTimeout(flush, DELTA_BATCH_MS)")
    expect(batcher).toContain("timer.unref?.()")
  })

  test("wraps recurring error-pattern guidance in system-reminder tags", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/session/processor-impl.ts"), "utf-8")
    expect(src).toContain("annotatedError = `${base}\\n\\n<system-reminder>\\n${guidance}\\n</system-reminder>`")
  })

  test("sanitizes tool output before appending doom-loop reminders", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/session/processor-impl.ts"), "utf-8")
    expect(src).toContain("`${sanitizeForXmlTag(value.output.output)}\\n\\n<system-reminder>")
  })

  test("stores sanitized rejected permission and question errors", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/session/processor-impl.ts"), "utf-8")
    expect(src).toContain("const sanitizedError = sanitizeForXmlTag(errorMsg)")
    expect(src).toContain("let annotatedError = sanitizedError")
  })

  test("clears per-attempt tool rate-limit timestamps before retrying", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/session/processor-impl.ts"), "utf-8")
    const catchStart = src.indexOf("} catch (e: unknown) {")
    const retryStart = src.indexOf("const errStack", catchStart)
    expect(catchStart).toBeGreaterThan(-1)
    expect(retryStart).toBeGreaterThan(catchStart)
    expect(src.slice(catchStart, retryStart)).toContain("resetShortLivedToolLoopState()")
  })

  test("provider fallback only partially resets consecutive error budget", async () => {
    const fallbackSwitch = providerFallbackSwitchState({
      current: { providerID: "current" as any, modelID: "model-a" as any },
      fallback: { providerID: "fallback" as any, modelID: "model-b" as any },
      errorMessage: "rate limited",
      consecutiveErrors: 5,
    })

    const transition = await resolvePromptLoopErrorTransition(
      {
        sessionID: SessionID.descending(),
        currentModel: { providerID: "current" as any, modelID: "model-a" as any },
        error: new Error("rate limited"),
        consecutiveErrors: 4,
        fallbackModelOverride: undefined,
        step: 1,
      },
      {
        async handleError() {
          return {
            action: "fallback",
            fallbackModel: { providerID: "fallback" as any, modelID: "model-b" as any },
            consecutiveErrors: fallbackSwitch.nextConsecutiveErrors,
          }
        },
      },
    )

    expect(fallbackSwitch.nextConsecutiveErrors).toBe(2)
    expect(transition).toMatchObject({
      action: "retry",
      consecutiveErrors: 2,
      fallbackModelOverride: { providerID: "fallback", modelID: "model-b" },
      resetCachedModel: true,
    })
  })

  test("successful fallback step preserves the fallback override for the remainder of the continuation", async () => {
    const fallbackModel = { providerID: "fallback" as any, modelID: "model-b" as any }
    const transition = await resolvePromptLoopErrorTransition({
      sessionID: SessionID.descending(),
      currentModel: { providerID: "current" as any, modelID: "model-a" as any },
      error: undefined,
      consecutiveErrors: 2,
      fallbackModelOverride: fallbackModel,
      step: 2,
    })

    expect(transition).toEqual({
      action: "continue",
      consecutiveErrors: 0,
      fallbackModelOverride: fallbackModel,
      resetCachedModel: false,
    })
  })

  test("prompt loop resolves provider errors before processor stop decisions", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/session/prompt.ts"), "utf-8")
    const errorTransitionStart = src.indexOf("const errorTransition = await resolvePromptLoopErrorTransition")
    const processorDecisionStart = src.indexOf("const processorDecision = processorLoopDecision")

    expect(errorTransitionStart).toBeGreaterThan(-1)
    expect(processorDecisionStart).toBeGreaterThan(-1)
    expect(errorTransitionStart).toBeLessThan(processorDecisionStart)
    expect(src.slice(errorTransitionStart, processorDecisionStart)).toContain("if (processor.message.error)")
    expect(src.slice(errorTransitionStart, processorDecisionStart)).toContain("continue")
  })

  test("marks tool-using steps as tool-calls even when provider finish reason is stop", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
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
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        streamSpy = vi.spyOn(LLM, "stream").mockResolvedValue({
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "tool-input-start", id: "call_1", toolName: "glob" }
            yield { type: "tool-call", toolCallId: "call_1", toolName: "glob", input: { pattern: "**/*" } }
            yield {
              type: "tool-result",
              toolCallId: "call_1",
              input: { pattern: "**/*" },
              output: { output: "match", title: "Glob", metadata: {}, attachments: [] },
            }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
            }
            yield { type: "finish" }
          })(),
        } as any)

        const processor = SessionProcessor.create({
          assistantMessage: assistant as MessageV2.Assistant,
          sessionID: session.id,
          model,
          abort: AbortSignal.any([]),
        })

        const result = await processor.process({
          user: user as MessageV2.User,
          agent: await Agent.get("build"),
          abort: AbortSignal.any([]),
          sessionID: session.id,
          system: [],
          messages: [],
          tools: {},
          model,
        })

        expect(result).toBe("continue")
        expect(processor.message.finish).toBe("tool-calls")
      },
    })
  })

  test("tool-call loop tracking does not crash on non-printable serialization errors", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
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
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        const broken = function brokenThrowable() {
          return undefined
        }
        Object.defineProperty(broken, Symbol.toPrimitive, {
          value() {
            throw new Error("cannot stringify")
          },
        })
        const badInput = {
          toJSON() {
            throw broken
          },
        }

        streamSpy = vi.spyOn(LLM, "stream").mockResolvedValue({
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "tool-input-start", id: "call_1", toolName: "glob" }
            yield { type: "tool-call", toolCallId: "call_1", toolName: "glob", input: badInput }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
            }
            yield { type: "finish" }
          })(),
        } as any)

        const processor = SessionProcessor.create({
          assistantMessage: assistant as MessageV2.Assistant,
          sessionID: session.id,
          model,
          abort: AbortSignal.any([]),
        })

        const result = await processor.process({
          user: user as MessageV2.User,
          agent: await Agent.get("build"),
          abort: AbortSignal.any([]),
          sessionID: session.id,
          system: [],
          messages: [],
          tools: {},
          model,
        })

        expect(result).toBe("continue")
        expect(processor.message.error).toBeUndefined()
      },
    })
  })

  test("autonomous doom-loop detection preserves the triggering tool result", async () => {
    await using tmp = await tmpdir({ git: true })
    const previousAutonomous = process.env.AX_CODE_AUTONOMOUS
    process.env.AX_CODE_AUTONOMOUS = "true"

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
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
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
          } as MessageV2.Assistant)

          streamSpy = vi.spyOn(LLM, "stream").mockResolvedValue({
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              for (let i = 1; i <= 3; i++) {
                yield { type: "tool-input-start", id: `call_${i}`, toolName: "glob" }
                yield { type: "tool-call", toolCallId: `call_${i}`, toolName: "glob", input: { pattern: "**/*" } }
                yield {
                  type: "tool-result",
                  toolCallId: `call_${i}`,
                  input: { pattern: "**/*" },
                  output: { output: `match ${i}`, title: "Glob", metadata: {}, attachments: [] },
                }
              }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
              }
              yield { type: "finish" }
            })(),
          } as any)

          const processor = SessionProcessor.create({
            assistantMessage: assistant as MessageV2.Assistant,
            sessionID: session.id,
            model,
            abort: AbortSignal.any([]),
          })

          const result = await processor.process({
            user: user as MessageV2.User,
            agent: await Agent.get("build"),
            abort: AbortSignal.any([]),
            sessionID: session.id,
            system: [],
            messages: [],
            tools: {},
            model,
          })

          expect(result).toBe("continue")
          const saved = await MessageV2.get({ sessionID: session.id, messageID: assistant.id })
          const toolParts = saved.parts.filter((part) => part.type === "tool")
          expect(toolParts).toHaveLength(3)
          const repeatedPart = toolParts[2]
          expect(repeatedPart?.state.status).toBe("completed")
          if (repeatedPart?.state.status !== "completed") throw new Error("repeated tool call did not complete")
          expect(repeatedPart.state.output).toContain("Doom-loop detection")
        },
      })
    } finally {
      if (previousAutonomous === undefined) delete process.env.AX_CODE_AUTONOMOUS
      else process.env.AX_CODE_AUTONOMOUS = previousAutonomous
    }
  })

  test("interactive doom-loop detection injects a reminder after the user approves", async () => {
    await using tmp = await tmpdir({ git: true })
    // Not autonomous: the detector asks for permission. Non-Claude providers
    // (Qwen, GLM, etc.) have no built-in loop detection, so this injected
    // reminder is the only signal the model receives to change strategy.

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Auto-approve every doom_loop ask with "once" so the repeated tool
        // call proceeds and the reminder lands on the tool result. Subscribe
        // inside the instance context so the Bus resolves the right store.
        const unsub = Bus.subscribe(Permission.Event.Asked, (event) => {
          if (event.properties.permission !== "doom_loop") return
          void Permission.reply({ requestID: event.properties.id, reply: "once" })
        })
        try {
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
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
          } as MessageV2.Assistant)

          streamSpy = vi.spyOn(LLM, "stream").mockResolvedValue({
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              for (let i = 1; i <= 3; i++) {
                yield { type: "tool-input-start", id: `call_${i}`, toolName: "glob" }
                yield { type: "tool-call", toolCallId: `call_${i}`, toolName: "glob", input: { pattern: "**/*" } }
                yield {
                  type: "tool-result",
                  toolCallId: `call_${i}`,
                  input: { pattern: "**/*" },
                  output: { output: `match ${i}`, title: "Glob", metadata: {}, attachments: [] },
                }
              }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
              }
              yield { type: "finish" }
            })(),
          } as any)

          const processor = SessionProcessor.create({
            assistantMessage: assistant as MessageV2.Assistant,
            sessionID: session.id,
            model,
            abort: AbortSignal.any([]),
          })

          const result = await processor.process({
            user: user as MessageV2.User,
            agent: await Agent.get("build"),
            abort: AbortSignal.any([]),
            sessionID: session.id,
            system: [],
            messages: [],
            tools: {},
            model,
          })

          expect(result).toBe("continue")
          const saved = await MessageV2.get({ sessionID: session.id, messageID: assistant.id })
          const toolParts = saved.parts.filter((part) => part.type === "tool")
          expect(toolParts).toHaveLength(3)
          const repeatedPart = toolParts[2]
          expect(repeatedPart?.state.status).toBe("completed")
          if (repeatedPart?.state.status !== "completed") throw new Error("repeated tool call did not complete")
          expect(repeatedPart.state.output).toContain("Doom-loop detection")
        } finally {
          unsub()
        }
      },
    })
  })

  test("resets tool tracking for a later non-tool step in the same stream", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
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
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        streamSpy = vi.spyOn(LLM, "stream").mockResolvedValue({
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "tool-call", toolCallId: "call_1", toolName: "glob", input: { pattern: "**/*" } }
            yield {
              type: "tool-result",
              toolCallId: "call_1",
              input: { pattern: "**/*" },
              output: { output: "match", title: "Glob", metadata: {}, attachments: [] },
            }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
            }
            yield { type: "start-step" }
            yield { type: "text-start", id: "text_1" }
            yield { type: "text-delta", id: "text_1", text: "done" }
            yield { type: "text-end", id: "text_1" }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 110, outputTokens: 15, totalTokens: 125 },
            }
            yield { type: "finish" }
          })(),
        } as any)

        const processor = SessionProcessor.create({
          assistantMessage: assistant as MessageV2.Assistant,
          sessionID: session.id,
          model,
          abort: AbortSignal.any([]),
        })

        const result = await processor.process({
          user: user as MessageV2.User,
          agent: await Agent.get("build"),
          abort: AbortSignal.any([]),
          sessionID: session.id,
          system: [],
          messages: [],
          tools: {},
          model,
        })

        expect(result).toBe("continue")
        expect(processor.message.finish).toBe("stop")

        // The provider streamed `tool-call` without a preceding
        // `tool-input-start`; the tool part and its result must still persist
        // instead of being silently dropped.
        const saved = await MessageV2.get({ sessionID: session.id, messageID: assistant.id })
        const toolParts = saved.parts.filter((part) => part.type === "tool")
        expect(toolParts).toHaveLength(1)
        const globPart = toolParts[0]
        expect(globPart?.state.status).toBe("completed")
        if (globPart?.state.status !== "completed") throw new Error("glob tool part did not complete")
        expect(globPart.state.output).toBe("match")
      },
    })
  })

  test("stops after capped retryable failures", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
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
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        const err = new MessageV2.APIError({
          message: "Rate Limited",
          isRetryable: true,
        }).toObject()

        streamSpy = vi.spyOn(LLM, "stream").mockImplementation(async () => {
          throw err
        })
        sleepSpy = vi.spyOn(SessionRetry, "sleep").mockResolvedValue()

        const processor = SessionProcessor.create({
          assistantMessage: assistant as MessageV2.Assistant,
          sessionID: session.id,
          model,
          abort: AbortSignal.any([]),
        })

        const result = await processor.process({
          user: user as MessageV2.User,
          agent: await Agent.get("build"),
          abort: AbortSignal.any([]),
          sessionID: session.id,
          system: [],
          messages: [],
          tools: {},
          model,
        })

        expect(result).toBe("stop")
        expect(streamSpy.mock.calls.length).toBe(SessionRetry.RETRY_MAX_ATTEMPTS + 1)
        expect(sleepSpy.mock.calls.length).toBe(SessionRetry.RETRY_MAX_ATTEMPTS)
        expect(processor.message.error).toBeDefined()
      },
    })
  })

  test("publishes one error event after retry exhaustion", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
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
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        const err = new MessageV2.APIError({
          message: "Rate Limited",
          isRetryable: true,
        }).toObject()

        const events: string[] = []
        const unsub = Bus.subscribe(Session.Event.Error, () => {
          events.push("error")
        })

        streamSpy = vi.spyOn(LLM, "stream").mockImplementation(async () => {
          throw err
        })
        sleepSpy = vi.spyOn(SessionRetry, "sleep").mockResolvedValue()

        try {
          const processor = SessionProcessor.create({
            assistantMessage: assistant as MessageV2.Assistant,
            sessionID: session.id,
            model,
            abort: AbortSignal.any([]),
          })

          const result = await processor.process({
            user: user as MessageV2.User,
            agent: await Agent.get("build"),
            abort: AbortSignal.any([]),
            sessionID: session.id,
            system: [],
            messages: [],
            tools: {},
            model,
          })

          expect(result).toBe("stop")
          expect(events).toHaveLength(1)
        } finally {
          unsub()
        }
      },
    })
  })

  test("retries Alibaba short-window quota and continues when the next attempt succeeds", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
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
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        const quota = new MessageV2.APIError({
          message:
            "Alibaba rejected the request as exceeding short-window allocatable token quota. This is a per-request or TPS/TPM reservation limit, not total plan usage. ax-code treats this as retryable short-window throttling; if it persists, wait briefly or lower the per-request output cap via AX_CODE_ALIBABA_OUTPUT_TOKEN_MAX (e.g. 2048 or 1024). Details: https://www.alibabacloud.com/help/en/model-studio/error-code#token-limit",
          isRetryable: true,
          statusCode: 429,
          metadata: { errorCode: "alibaba_token_plan_short_window_quota" },
        }).toObject()

        let calls = 0
        streamSpy = vi.spyOn(LLM, "stream").mockImplementation(async () => {
          calls++
          if (calls === 1) throw quota
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
                usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
              }
              yield { type: "finish" }
            })(),
          } as any
        })
        sleepSpy = vi.spyOn(SessionRetry, "sleep").mockResolvedValue()

        const processor = SessionProcessor.create({
          assistantMessage: assistant as MessageV2.Assistant,
          sessionID: session.id,
          model,
          abort: AbortSignal.any([]),
        })

        const result = await processor.process({
          user: user as MessageV2.User,
          agent: await Agent.get("build"),
          abort: AbortSignal.any([]),
          sessionID: session.id,
          system: [],
          messages: [],
          tools: {},
          model,
        })

        expect(result).toBe("continue")
        expect(calls).toBe(2)
        expect(sleepSpy.mock.calls.length).toBe(1)
        const delay = sleepSpy.mock.calls[0]?.[0]
        expect(delay).toBeGreaterThanOrEqual(45_000)
        expect(delay).toBeLessThanOrEqual(75_000)
        expect(processor.message.error).toBeUndefined()
      },
    })
  })

  test("resets retry budget when process restarts after compaction", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
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
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        let callCount = 0
        streamSpy = vi.spyOn(LLM, "stream").mockImplementation(async () => {
          callCount++
          if (callCount === 1) {
            throw new MessageV2.APIError({
              message: "Rate Limited",
              isRetryable: true,
            }).toObject()
          }
          if (callCount === 2) {
            throw new MessageV2.ContextOverflowError({
              message: "Context window exceeded",
            }).toObject()
          }
          if (callCount <= 2 + SessionRetry.RETRY_MAX_ATTEMPTS) {
            throw new MessageV2.APIError({
              message: "Rate Limited",
              isRetryable: true,
            }).toObject()
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
                usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
              }
              yield { type: "finish" }
            })(),
          } as any
        })
        sleepSpy = vi.spyOn(SessionRetry, "sleep").mockResolvedValue()

        const processor = SessionProcessor.create({
          assistantMessage: assistant as MessageV2.Assistant,
          sessionID: session.id,
          model,
          abort: AbortSignal.any([]),
        })

        const first = await processor.process({
          user: user as MessageV2.User,
          agent: await Agent.get("build"),
          abort: AbortSignal.any([]),
          sessionID: session.id,
          system: [],
          messages: [],
          tools: {},
          model,
        })
        expect(first).toBe("compact")

        const second = await processor.process({
          user: user as MessageV2.User,
          agent: await Agent.get("build"),
          abort: AbortSignal.any([]),
          sessionID: session.id,
          system: [],
          messages: [],
          tools: {},
          model,
        })

        expect(second).toBe("continue")
        expect(callCount).toBe(2 + SessionRetry.RETRY_MAX_ATTEMPTS + 1)
        expect(sleepSpy.mock.calls.length).toBe(1 + SessionRetry.RETRY_MAX_ATTEMPTS)
      },
    })
  })
})
