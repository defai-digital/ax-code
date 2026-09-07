import { expect, test, vi } from "vitest"
import type { LanguageModelV3StreamPart, LanguageModelV3StreamResult } from "@ai-sdk/provider"
import { MockLanguageModelV3 } from "ai/test"
import { streamText, tool, wrapLanguageModel } from "ai"
import z from "zod"
import { RequestTiming } from "../../src/session/request-timing"
import { LLMResponseEvent } from "../../src/replay/event"

function wrap(timing: ReturnType<typeof RequestTiming.create>, stream: ReadableStream<LanguageModelV3StreamPart>) {
  return dispatch(timing, async () => ({ stream }))
}

function dispatch(
  timing: ReturnType<typeof RequestTiming.create>,
  doStream: () => Promise<LanguageModelV3StreamResult>,
) {
  return timing.middleware.wrapStream!({
    doStream,
    doGenerate: async () => {
      throw new Error("Unexpected generate")
    },
    params: { prompt: [] },
    model: new MockLanguageModelV3(),
  })
}

async function drain(stream: ReadableStream<LanguageModelV3StreamPart>) {
  const reader = stream.getReader()
  while (!(await reader.read()).done) {
    /* Consume without altering chunks. */
  }
}

const finish: LanguageModelV3StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
}

test("times meaningful content and finish independently of metadata and consumer post-processing", async () => {
  let now = 10
  const timing = RequestTiming.create(() => now)
  expect(timing.snapshot()).toBeUndefined()
  let source!: ReadableStreamDefaultController<LanguageModelV3StreamPart>
  const stream = new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      source = controller
    },
  })
  now = 30
  const reader = (await wrap(timing, stream)).stream.getReader()
  async function send(at: number, part: LanguageModelV3StreamPart) {
    now = at
    source.enqueue(part)
    expect((await reader.read()).value).toBe(part)
  }
  await send(35, { type: "stream-start", warnings: [] })
  await send(40, { type: "text-start", id: "t" })
  await send(45, { type: "text-delta", id: "t", delta: "" })
  expect(timing.snapshot()).toEqual({ boundary: "provider-adapter", attempt: 1, setupMs: 20 })
  await send(60, { type: "reasoning-delta", id: "r", delta: "Think" })
  await send(90, { type: "text-delta", id: "t", delta: "Done" })
  await send(100, finish)
  source.close()
  await reader.read()
  now = 10_000
  expect(timing.snapshot()).toEqual({
    boundary: "provider-adapter",
    attempt: 1,
    setupMs: 20,
    firstContentMs: 30,
    firstTextMs: 60,
    streamMs: 70,
  })
  // Snapshots are detached so consumers cannot modify the live measurement.
  timing.snapshot()!.setupMs = 999
  expect(timing.snapshot()!.setupMs).toBe(20)
})

test("tool-only responses have first content but no fabricated first text", async () => {
  let now = 0
  const timing = RequestTiming.create(() => now)
  const result = await wrap(
    timing,
    new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "tool-input-start", id: "c", toolName: "read" })
        controller.enqueue({ type: "tool-call", toolCallId: "c", toolName: "read", input: "{}" })
        controller.enqueue(finish)
        controller.close()
      },
    }),
  )
  now = 50
  await drain(result.stream)
  expect(timing.snapshot()).toEqual({
    boundary: "provider-adapter",
    attempt: 1,
    setupMs: 0,
    firstContentMs: 50,
    streamMs: 50,
  })
})

test("failed dispatch and retry retain latest attempt identity without inventing milestones", async () => {
  let now = 0
  const timing = RequestTiming.create(() => now)
  const error = new Error("adapter failed")
  now = 20
  await expect(
    dispatch(timing, async () => {
      throw error
    }),
  ).rejects.toBe(error)
  expect(timing.snapshot()).toEqual({ boundary: "provider-adapter", attempt: 1, setupMs: 20 })
  now = 100
  const result = await wrap(
    timing,
    new ReadableStream({
      start(controller) {
        controller.close()
      },
    }),
  )
  await drain(result.stream)
  expect(timing.snapshot()).toEqual({ boundary: "provider-adapter", attempt: 2, setupMs: 100 })
})

test("passes cancellation and stream errors through without draining the provider", async () => {
  const cancel = vi.fn()
  const pull = vi.fn()
  const timing = RequestTiming.create()
  const result = await wrap(timing, new ReadableStream({ pull, cancel }))
  const reason = new Error("cancelled")
  await result.stream.cancel(reason)
  await Promise.resolve()
  expect(cancel).toHaveBeenCalledWith(reason)
  expect(pull.mock.calls.length).toBeLessThanOrEqual(2)
  expect(timing.snapshot()).not.toHaveProperty("streamMs")
  const error = new Error("provider stream failed")
  const failed = await wrap(
    timing,
    new ReadableStream({
      start(controller) {
        controller.error(error)
      },
    }),
  )
  await expect(failed.stream.getReader().read()).rejects.toBe(error)
  expect(timing.snapshot()).not.toHaveProperty("firstContentMs")
})

test("replay keeps legacy response shape and validates optional adapter timing", () => {
  const legacy = {
    type: "llm.response",
    sessionID: "s",
    finishReason: "stop",
    tokens: { input: 1, output: 1 },
    latencyMs: 400,
  }
  expect(LLMResponseEvent.parse(legacy)).toEqual(legacy)
  const timing = { boundary: "provider-adapter", attempt: 1, setupMs: 20, firstContentMs: 30, streamMs: 90 }
  expect(LLMResponseEvent.parse({ ...legacy, timing })).toEqual({ ...legacy, timing })
  expect(LLMResponseEvent.safeParse({ ...legacy, timing: { ...timing, streamMs: -1 } }).success).toBe(false)
})

test("SDK tool execution cannot inflate an already observed provider finish", async () => {
  let now = 0
  const timing = RequestTiming.create(() => now)
  const releaseTool = Promise.withResolvers<void>()
  const toolStarted = Promise.withResolvers<void>()
  const adapter = new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          now = 50
          controller.enqueue({ type: "stream-start", warnings: [] })
          controller.enqueue({ type: "tool-call", toolCallId: "c", toolName: "wait", input: "{}" })
          controller.enqueue({ ...finish, finishReason: { unified: "tool-calls", raw: "tool_calls" } })
          controller.close()
        },
      }),
    }),
  })
  const result = streamText({
    model: wrapLanguageModel({ model: adapter, middleware: timing.middleware }),
    prompt: "Call wait",
    maxRetries: 0,
    tools: {
      wait: tool({
        inputSchema: z.object({}),
        execute: async () => {
          toolStarted.resolve()
          await releaseTool.promise
          return "Done"
        },
      }),
    },
  })
  const consumed = result.consumeStream()
  try {
    await toolStarted.promise
    // Let the SDK consume the provider finish while the tool is still pending.
    await vi.waitFor(() => expect(timing.snapshot()?.streamMs).toBe(50), { timeout: 1000 })
    now = 10_000
  } finally {
    releaseTool.resolve()
  }
  await consumed
  expect(timing.snapshot()?.streamMs).toBe(50)
  expect(await result.finishReason).toBe("tool-calls")
})
