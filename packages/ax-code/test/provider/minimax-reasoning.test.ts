import { describe, expect, test } from "vitest"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { isMiniMaxM3ChatRequest, normalizeMiniMaxReasoning } from "../../src/provider/minimax-reasoning"

const npm = "@ai-sdk/openai-compatible"
const details = [
  { type: "reasoning.text", text: "Check α. " },
  { type: "reasoning.text", text: "Then act." },
]
function fixture(delta: object, eol = "\n") {
  return `: keepalive${eol}${eol}data: ${JSON.stringify({
    id: "test",
    model: "MiniMax-M3",
    created: 1,
    choices: [{ index: 0, delta, finish_reason: null }],
  })}${eol}${eol}data: [DONE]${eol}${eol}`
}
function response(text: string) {
  const bytes = new TextEncoder().encode(text)
  // Split UTF-8 and SSE boundaries deliberately.
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
        controller.close()
      },
    }),
    { headers: { "content-type": "text/event-stream", "x-request-id": "fixture" } },
  )
}

describe("MiniMax M3 reasoning_details stream fallback", () => {
  test.each(["MiniMax-M3", "minimax/MiniMax-M3"])("%s reaches reasoning deltas in the installed SDK", async (model) => {
    const sdk = createOpenAICompatible({
      name: "gateway",
      baseURL: "https://gateway.example/v1",
      apiKey: "test",
      fetch: async (_url, init) =>
        normalizeMiniMaxReasoning(
          response(fixture({ reasoning_details: details, content: "answer" })),
          isMiniMaxM3ChatRequest(npm, init?.body),
        ),
    })
    const { stream } = await sdk
      .chatModel(model)
      .doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }] })
    const parts = await Array.fromAsync(stream)
    expect(
      parts
        .filter((part) => part.type === "reasoning-delta")
        .map((part) => part.delta)
        .join(""),
    ).toBe("Check α. Then act.")
    expect(
      parts
        .filter((part) => part.type === "text-delta")
        .map((part) => part.delta)
        .join(""),
    ).toBe("answer")
    expect(parts.some((part) => part.type === "error")).toBe(false)
  })

  test.each(["\n", "\r\n", "\r"])("handles split frames and UTF-8 with %j delimiters", async (eol) => {
    const output = normalizeMiniMaxReasoning(response(fixture({ reasoning_details: details }, eol)), true)
    expect(output.headers.get("x-request-id")).toBe("fixture")
    expect(await output.text()).toContain('"reasoning_content":"Check α. Then act."')
  })

  test.each([
    { content: "answer" },
    { reasoning_content: "native", reasoning_details: details },
    { reasoning: "native", reasoning_details: details },
    { reasoning_details: [{ type: "reasoning.encrypted", text: "opaque" }, null, { type: "reasoning.text", text: 1 }] },
  ])("is byte-preserving without fallback text or with native reasoning: %j", async (delta) => {
    const text = fixture(delta)
    expect(await normalizeMiniMaxReasoning(response(text), true).text()).toBe(text)
  })

  test.each([{ reasoning_content: "" }, { reasoning: "" }, { reasoning_content: null }])(
    "empty native fields still extract details: %j",
    async (native) => {
      const text = await normalizeMiniMaxReasoning(
        response(fixture({ ...native, reasoning_details: details })),
        true,
      ).text()
      expect(text).toContain('"reasoning_content":"Check α. Then act."')
    },
  )

  test("preserves tool calls, finish reasons and usage alongside extracted reasoning", async () => {
    const value = {
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          delta: {
            reasoning_details: details,
            tool_calls: [
              { index: 0, id: "call-1", type: "function", function: { name: "read", arguments: '{"path":"a"}' } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 5 },
    }
    const text = await normalizeMiniMaxReasoning(response(`data: ${JSON.stringify(value)}\n\n`), true).text()
    const parsed = JSON.parse(text.trim().slice(6))
    expect(parsed).toEqual({
      ...value,
      choices: [{ ...value.choices[0], delta: { ...value.choices[0].delta, reasoning_content: "Check α. Then act." } }],
    })
  })

  test.each(["qwen3.8-flash", "deepseek-flash", "gpt-oss-120b", "MiniMax-M2.7", "MiniMax-M30"])(
    "%s is unchanged even when the same SDK serves another model",
    (model) => {
      const enabled = isMiniMaxM3ChatRequest(npm, JSON.stringify({ model, stream: true }))
      expect(enabled).toBe(false)
      const original = response(fixture({ reasoning_details: details }))
      expect(normalizeMiniMaxReasoning(original, enabled)).toBe(original)
    },
  )

  test("other SDKs, non-stream requests, malformed requests and non-SSE responses are unchanged", () => {
    expect(isMiniMaxM3ChatRequest("@ai-sdk/anthropic", JSON.stringify({ model: "MiniMax-M3", stream: true }))).toBe(
      false,
    )
    for (const body of [null, "bad json", "[]", JSON.stringify({ model: "MiniMax-M3", stream: false })]) {
      expect(isMiniMaxM3ChatRequest(npm, body)).toBe(false)
    }
    const json = Response.json({ choices: [] })
    expect(normalizeMiniMaxReasoning(json, true)).toBe(json)
  })

  test("propagates cancellation to the upstream stream", async () => {
    let canceled = false
    const original = new Response(
      new ReadableStream({
        cancel() {
          canceled = true
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    )
    await normalizeMiniMaxReasoning(original, true).body!.cancel()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(canceled).toBe(true)
  })
})
