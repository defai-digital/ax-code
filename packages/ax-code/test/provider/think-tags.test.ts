import { describe, expect, test } from "vitest"
import { attachThinkTagStream, stripThinkTags, ThinkTagParser, wrapThinkTagText } from "../../src/provider/think-tags"

async function collect(stream: AsyncIterable<unknown>) {
  const events: unknown[] = []
  for await (const event of stream) events.push(event)
  return events
}

function streamOf(events: unknown[]) {
  return attachThinkTagStream({
    fullStream: {
      async *[Symbol.asyncIterator]() {
        yield* events
      },
    },
  })
}

describe("ThinkTagParser", () => {
  test("splits MiniMax tags across deltas", () => {
    const parser = new ThinkTagParser()
    expect(parser.push("<mm:")).toEqual([])
    expect(parser.push("think>plan")).toEqual([{ type: "reasoning", text: "plan", tag: "mm:think" }])
    expect(parser.push(" it</mm:th")).toEqual([{ type: "reasoning", text: " it", tag: "mm:think" }])
    expect(parser.push("ink>\nDo the work")).toEqual([{ type: "text", text: "\nDo the work" }])
    expect(parser.flush()).toEqual([])
  })

  test("prefers <thinking> over the <think> prefix", () => {
    const parser = new ThinkTagParser()
    expect(parser.push("<thinking>hidden</thinking>visible")).toEqual([
      { type: "reasoning", text: "hidden", tag: "thinking" },
      { type: "text", text: "visible" },
    ])
  })

  test("treats an unclosed tag as reasoning on flush", () => {
    const parser = new ThinkTagParser()
    expect(parser.push("<think>still thinking")).toEqual([{ type: "reasoning", text: "still thinking", tag: "think" }])
    expect(parser.flush()).toEqual([])
  })
})

describe("stripThinkTags / wrapThinkTagText", () => {
  test("strips MiniMax and generic think blocks", () => {
    expect(stripThinkTags("<mm:think>scratch</mm:think>\nQuality review")).toBe("Quality review")
    expect(stripThinkTags("<think>only thinking</think>")).toBe("")
    expect(wrapThinkTagText("plan")).toBe("<mm:think>plan</mm:think>")
  })
})

describe("attachThinkTagStream", () => {
  test("rewrites MiniMax text into reasoning events and keeps visible text", async () => {
    const events = await collect(
      streamOf([
        { type: "start" },
        { type: "text-start", id: "t0" },
        { type: "text-delta", id: "t0", text: "<mm:think>plan the edit</mm:think>Now call bash" },
        { type: "text-end", id: "t0" },
        { type: "tool-call", toolName: "bash" },
      ]).fullStream,
    )

    expect(events).toEqual([
      { type: "start" },
      { type: "reasoning-start", id: "think-tag-1", providerMetadata: { thinkTag: "mm:think" } },
      {
        type: "reasoning-delta",
        id: "think-tag-1",
        text: "plan the edit",
        providerMetadata: { thinkTag: "mm:think" },
      },
      { type: "reasoning-end", id: "think-tag-1" },
      { type: "text-start", id: "t0" },
      { type: "text-delta", id: "t0", text: "Now call bash" },
      { type: "text-end", id: "t0" },
      { type: "tool-call", toolName: "bash" },
    ])
  })

  test("omits empty text parts when the model only thinks", async () => {
    const events = await collect(
      streamOf([
        { type: "text-start", id: "t0" },
        { type: "text-delta", id: "t0", text: "<mm:think>only thinking</mm:think>" },
        { type: "text-end", id: "t0" },
      ]).fullStream,
    )

    expect(events).toEqual([
      { type: "reasoning-start", id: "think-tag-1", providerMetadata: { thinkTag: "mm:think" } },
      {
        type: "reasoning-delta",
        id: "think-tag-1",
        text: "only thinking",
        providerMetadata: { thinkTag: "mm:think" },
      },
      { type: "reasoning-end", id: "think-tag-1" },
    ])
  })
})
