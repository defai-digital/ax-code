import { expect, test } from "vitest"
import { createServer } from "node:http"
import { streamText } from "ai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { LLM } from "../../src/session/llm"

function wrap(fullStream: AsyncIterable<unknown>, controller: AbortController, idleTimeoutMs = 0) {
  return LLM.attachStreamIdleWatchdog(
    { fullStream },
    {
      idleAbort: controller,
      idleTimeoutMs,
      providerID: "ax-engine",
      modelID: "fixture",
    },
  ).fullStream
}

test.each([0, 5000])(
  "consumer loop failure aborts the request before iterator cleanup (timeout %i)",
  async (timeout) => {
    const request = new AbortController()
    const parent = new AbortController()
    const combined = AbortSignal.any([parent.signal, request.signal])
    const failure = new Error("output loop detected")
    let returned = false
    const stream = wrap(
      {
        [Symbol.asyncIterator]() {
          return {
            next: async () => ({ done: false as const, value: "repeated output" }),
            return: async () => {
              expect(combined.aborted).toBe(true)
              returned = true
              return { done: true as const, value: undefined }
            },
          }
        },
      },
      request,
      timeout,
    )
    await expect(async () => {
      for await (const _ of stream) throw failure
    }).rejects.toBe(failure)
    expect(returned).toBe(true)
    expect(parent.signal.aborted).toBe(false)
  },
)

test("explicit iterator throw aborts before forwarding the original error", async () => {
  const controller = new AbortController()
  const failure = new Error("consumer failed")
  const iterator = wrap(
    {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false as const, value: "text" }),
        throw: async (error) => {
          expect(controller.signal.aborted).toBe(true)
          throw error
        },
      }),
    },
    controller,
  )[Symbol.asyncIterator]()
  await iterator.next()
  await expect(iterator.throw!(failure)).rejects.toBe(failure)
})

test("provider stream errors cancel unfinished requests and preserve their error", async () => {
  const controller = new AbortController()
  const failure = new Error("transport failed")
  const iterator = wrap(
    {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          throw failure
        },
      }),
    },
    controller,
  )[Symbol.asyncIterator]()
  await expect(iterator.next()).rejects.toBe(failure)
  expect(controller.signal.aborted).toBe(true)
})

test("breaking an SDK tee stream closes HTTP inference and releases single-request admission", async () => {
  let active = false
  let requests = 0
  const closed = Promise.withResolvers<void>()
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      /* consume body */
    }
    if (active) {
      res.writeHead(429, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "concurrency_limit" } }))
      return
    }
    active = true
    requests++
    res.writeHead(200, { "content-type": "text/event-stream" })
    const chunk = (content: string, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: { content }, finish_reason: finish }] })}\n\n`
    if (requests > 1) {
      res.end(chunk("recovered") + chunk("", "stop") + "data: [DONE]\n\n")
      active = false
      return
    }
    res.write(chunk("repeated output"))
    const timer = setInterval(() => res.write(chunk("repeated output")), 10)
    res.on("close", () => {
      clearInterval(timer)
      active = false
      closed.resolve()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing HTTP fixture address")
  const provider = createOpenAICompatible({ name: "fixture", baseURL: `http://127.0.0.1:${address.port}/v1` })
  const abort = new AbortController()
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    const output = streamText({ model: provider("fixture"), prompt: "test", abortSignal: abort.signal, maxRetries: 0 })
    await Promise.race([
      (async () => {
        for await (const part of wrap(output.fullStream, abort)) {
          if ((part as { type?: string }).type === "text-delta") break
        }
        await closed.promise
      })(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error("Abandoned inference still occupies the admission slot")), 2000)
      }),
    ])
    expect(active).toBe(false)
    const recovery = streamText({ model: provider("fixture"), prompt: "recover", maxRetries: 0 })
    expect(await recovery.text).toBe("recovered")
    expect(requests).toBe(2)
  } finally {
    abort.abort()
    if (deadline) clearTimeout(deadline)
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("abort-induced cleanup errors do not turn a break into failure, and closed iterators stay closed", async () => {
  const controller = new AbortController()
  let reads = 0
  let cleanups = 0
  const iterator = wrap(
    {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          reads++
          return { done: false as const, value: "text" }
        },
        return: async () => {
          cleanups++
          throw new DOMException("aborted", "AbortError")
        },
      }),
    },
    controller,
  )[Symbol.asyncIterator]()
  await iterator.next()
  expect(await iterator.return!()).toEqual({ done: true, value: undefined })
  expect(await iterator.next()).toEqual({ done: true, value: undefined })
  await iterator.return!()
  expect(reads).toBe(1)
  expect(cleanups).toBe(1)
})

test("unrelated iterator cleanup failures remain visible", async () => {
  const failure = new Error("cleanup failed")
  const iterator = wrap(
    {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false as const, value: "text" }),
        return: async () => {
          throw failure
        },
      }),
    },
    new AbortController(),
  )[Symbol.asyncIterator]()
  await iterator.next()
  await expect(iterator.return!()).rejects.toBe(failure)
})

test("abort-induced throw cleanup preserves the consumer error", async () => {
  const failure = new Error("consumer failed")
  const iterator = wrap(
    {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false as const, value: "text" }),
        throw: async () => {
          throw new DOMException("aborted", "AbortError")
        },
      }),
    },
    new AbortController(),
  )[Symbol.asyncIterator]()
  await iterator.next()
  await expect(iterator.throw!(failure)).rejects.toBe(failure)
})
