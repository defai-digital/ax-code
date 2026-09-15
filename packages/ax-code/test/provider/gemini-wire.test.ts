import { describe, expect, test } from "vitest"
import { generateText, streamText, type ModelMessage } from "ai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { ProviderTransform } from "../../src/provider/transform"
import { parseJsonRecord } from "../../src/util/json-record"

function model(id: string, interleaved: Provider.Model["capabilities"]["interleaved"] = false): Provider.Model {
  return {
    id: ModelID.make(id),
    providerID: ProviderID.make("review-gateway"),
    api: { id, url: "https://gateway.example/v1", npm: "@ai-sdk/openai-compatible" },
    name: id,
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, image: false, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved,
    },
    limit: { context: 1_000_000, output: 384_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
  }
}

describe("Gemini gateway thought signature wire contract", () => {
  test.each([false, true])("replays SDK response metadata with streaming=%s", async (streaming) => {
    const target = model("gemini-3.8-flash")
    const requests: Array<Record<string, any>> = []
    const call = {
      id: "call-read",
      type: "function",
      function: { name: "read", arguments: '{"path":"file.ts"}' },
      extra_content: { google: { thought_signature: "opaque-signature" } },
    }
    const provider = createOpenAICompatible({
      name: target.providerID,
      baseURL: target.api.url,
      apiKey: "test-key",
      fetch: async (_url, init) => {
        requests.push(parseJsonRecord(init?.body)!)
        const first = requests.length === 1
        if (streaming && first) {
          const chunks = [
            {
              choices: [
                { index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, ...call }] }, finish_reason: null },
              ],
            },
            { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
          ]
          return new Response(
            chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
            {
              headers: { "content-type": "text/event-stream" },
            },
          )
        }
        return Response.json({
          id: "completion-test",
          model: target.api.id,
          created: 1,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: first ? null : "OK", ...(first ? { tool_calls: [call] } : {}) },
              finish_reason: first ? "tool_calls" : "stop",
            },
          ],
        })
      },
    })
    const messages: ModelMessage[] = [{ role: "user", content: "Read file.ts" }]
    const options = { model: provider.chatModel(target.api.id), messages, maxRetries: 0 }
    const first = streaming ? streamText(options) : await generateText(options)
    const response = await first.response
    messages.push(...response.messages, {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-read",
          toolName: "read",
          output: { type: "text", value: "file content" },
        },
      ],
    })
    const original = structuredClone(messages)
    const normalized = ProviderTransform.message(messages, target, {})
    const twice = ProviderTransform.message(normalized, target, {})
    await generateText({ ...options, messages: twice })
    const assistant = requests[1].messages.find((message: any) => message.role === "assistant")
    expect(assistant.tool_calls[0].extra_content).toEqual(call.extra_content)
    expect(messages).toEqual(original)
    expect(twice).toEqual(normalized)
  })

  test("only maps the active compatible provider and preserves explicit Google metadata", () => {
    const target = model("gemini-3.8-flash")
    const part = (providerOptions: any) => ({
      type: "tool-call" as const,
      toolCallId: "call-read",
      toolName: "read",
      input: {},
      providerOptions,
    })
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          part({ other: { thoughtSignature: "foreign" } }),
          part({
            [target.providerID]: { thoughtSignature: "gateway", other: "retained" },
            google: { thoughtSignature: "explicit", other: "google" },
          }),
          part({ [target.providerID]: { thoughtSignature: 123 } }),
        ],
      },
    ]
    expect(ProviderTransform.message(messages, target, {})).toEqual(messages)
    const native = { ...target, api: { ...target.api, npm: "@ai-sdk/google" } }
    const gatewayOnly: ModelMessage[] = [
      { role: "assistant", content: [part({ [target.providerID]: { thoughtSignature: "gateway" } })] },
    ]
    expect(ProviderTransform.message(gatewayOnly, native, {})).toEqual(gatewayOnly)
  })
})
