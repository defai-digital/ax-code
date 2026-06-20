import { afterEach, describe, expect, test } from "vitest"
import { parseSSE, parseSSEData, parseSSEJsonData, sseMessageData } from "../../src/control-plane/sse"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await resetDatabase()
})

function stream(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  })
}

describe("control-plane/sse", () => {
  test("wraps text data as explicit SSE message events", () => {
    expect(sseMessageData("hello world", { id: "abc", retry: 1500 })).toEqual({
      type: "sse.message",
      properties: {
        data: "hello world",
        id: "abc",
        retry: 1500,
      },
    })
  })

  test("parseSSEData decodes JSON payloads", () => {
    expect(parseSSEData('{"type":"one","properties":{"ok":true}}')).toEqual({
      type: "one",
      properties: { ok: true },
    })
  })

  test("parseSSEJsonData separates JSON parsing from fallback wrapping", () => {
    expect(parseSSEJsonData('{"type":"one"}')).toEqual({ type: "one" })
    expect(parseSSEJsonData('  {"type":"one"}\n')).toEqual({ type: "one" })
    expect(parseSSEJsonData("hello world")).toBeUndefined()
    expect(parseSSEJsonData("")).toBeUndefined()
  })

  test("parseSSEData wraps non-json payloads with event metadata", () => {
    expect(parseSSEData("hello world", { id: "abc", retry: 1500 })).toEqual({
      type: "sse.message",
      properties: {
        data: "hello world",
        id: "abc",
        retry: 1500,
      },
    })
  })

  test("parses JSON events with CRLF and multiline data blocks", async () => {
    const events: unknown[] = []
    const stop = new AbortController()

    await parseSSE(
      stream([
        'data: {"type":"one","properties":{"ok":true}}\r\n\r\n',
        'data: {"type":"two",\r\ndata: "properties":{"n":2}}\r\n\r\n',
      ]),
      stop.signal,
      (event) => events.push(event),
    )

    expect(events).toEqual([
      { type: "one", properties: { ok: true } },
      { type: "two", properties: { n: 2 } },
    ])
  })

  test("falls back to sse.message for non-json payload", async () => {
    const events: unknown[] = []
    const stop = new AbortController()

    await parseSSE(stream(["id: abc\nretry: 1500\ndata: hello world\n\n"]), stop.signal, (event) => events.push(event))

    expect(events).toEqual([
      {
        type: "sse.message",
        properties: {
          data: "hello world",
          id: "abc",
          retry: 1500,
        },
      },
    ])
  })

  test("ignores non-decimal retry fields", async () => {
    const events: unknown[] = []
    const stop = new AbortController()

    await parseSSE(
      stream([
        "retry: 1e3\ndata: scientific\n\n",
        "retry: 0x10\ndata: hex\n\n",
        "retry: -1\ndata: negative\n\n",
        "retry: 12.5\ndata: fractional\n\n",
        "retry: 1500 \ndata: trailing-space\n\n",
      ]),
      stop.signal,
      (event) => events.push(event),
    )

    expect(events).toEqual([
      sseMessageData("scientific"),
      sseMessageData("hex"),
      sseMessageData("negative"),
      sseMessageData("fractional"),
      sseMessageData("trailing-space"),
    ])
  })

  test("caps decimal retry fields at 60 seconds", async () => {
    const events: unknown[] = []
    const stop = new AbortController()

    await parseSSE(stream(["retry: 99999999999999999999\ndata: capped\n\n"]), stop.signal, (event) =>
      events.push(event),
    )

    expect(events).toEqual([sseMessageData("capped", { retry: 60_000 })])
  })

  test("drops trailing carriage returns for mixed CRLF/LF block boundaries", async () => {
    const events: unknown[] = []
    const stop = new AbortController()

    await parseSSE(stream(["id: abc\r\nretry: 1500\r\ndata: hello world\r\n\n"]), stop.signal, (event) =>
      events.push(event),
    )

    expect(events).toEqual([
      {
        type: "sse.message",
        properties: {
          data: "hello world",
          id: "abc",
          retry: 1500,
        },
      },
    ])
  })

  test("parses consecutive events with mixed CRLF/LF block boundaries", async () => {
    const events: unknown[] = []
    const stop = new AbortController()

    await parseSSE(stream(["data: hello\r\n\n\r\ndata: world\n\n"]), stop.signal, (event) => events.push(event))

    expect(events).toEqual([
      {
        type: "sse.message",
        properties: {
          data: "hello",
          id: undefined,
          retry: undefined,
        },
      },
      {
        type: "sse.message",
        properties: {
          data: "world",
          id: undefined,
          retry: undefined,
        },
      },
    ])
  })

  test("parses standalone CR line endings and block boundaries", async () => {
    const events: unknown[] = []
    const stop = new AbortController()

    await parseSSE(stream(["data: first\r\rdata: second\r\r"]), stop.signal, (event) => events.push(event))

    expect(events).toEqual([
      {
        type: "sse.message",
        properties: {
          data: "first",
          id: undefined,
          retry: undefined,
        },
      },
      {
        type: "sse.message",
        properties: {
          data: "second",
          id: undefined,
          retry: undefined,
        },
      },
    ])
  })

  test("emits an unterminated trailing event only once at EOF", async () => {
    const events: unknown[] = []
    const stop = new AbortController()

    await parseSSE(stream(['data: {"type":"tail","properties":{"ok":true}}']), stop.signal, (event) =>
      events.push(event),
    )

    expect(events).toEqual([
      {
        type: "tail",
        properties: { ok: true },
      },
    ])
  })

  test("rejects pathological streams that never delimit an SSE frame", async () => {
    const stop = new AbortController()
    const payload = "x".repeat(1024 * 1024 + 64)

    await expect(parseSSE(stream([payload]), stop.signal, () => undefined)).rejects.toThrow(
      "SSE buffer exceeded maximum size",
    )
  })

  test("checks combined SSE buffer size before appending a chunk", async () => {
    const stop = new AbortController()
    const payload = "x".repeat(1024 * 1024)
    const chunk = "y".repeat(65)

    await expect(parseSSE(stream([payload, chunk]), stop.signal, () => undefined)).rejects.toThrow(
      "SSE buffer exceeded maximum size",
    )
  })
})
