import { describe, expect, test } from "vitest"
import { generateText, type ModelMessage } from "ai"
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

async function wireMessages(target: Provider.Model, messages: ModelMessage[]) {
  let request: Record<string, any> | undefined
  const provider = createOpenAICompatible({
    name: target.providerID,
    baseURL: target.api.url,
    apiKey: "test-key",
    fetch: async (_url, init) => {
      request = parseJsonRecord(init?.body)
      return Response.json({
        id: "completion-test",
        model: target.api.id,
        created: 1,
        choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
      })
    },
  })
  await generateText({ model: provider.chatModel(target.api.id), messages, maxOutputTokens: 64, maxRetries: 0 })
  return request!.messages as Array<Record<string, any>>
}

describe("DeepSeek request wire contract", () => {
  test("required tool choice recognizes upstream Flash behind an unrelated alias", () => {
    const target = { ...model("deepseek-flash"), id: ModelID.make("gateway-alias") }
    const original = {
      thinking: { type: "enabled" },
      reasoningEffort: "high",
      reasoning_effort: "max",
      custom: "retained",
    }
    expect(ProviderTransform.sanitizeOptions(target, original, "required")).toEqual({
      thinking: { type: "disabled" },
      custom: "retained",
    })
    expect(original.thinking.type).toBe("enabled")
  })

  test.each(["deepseek-r1", "qwen3.8-flash"])(
    "required tool choice does not inject a DeepSeek thinking switch into %s",
    (id) => {
      const original = { reasoningEffort: "high" }
      expect(ProviderTransform.sanitizeOptions(model(id), original, "required")).toEqual(original)
    },
  )

  test.each(["groq", "openrouter"])("required tool choice preserves %s transport policy", (providerID) => {
    const target = { ...model("deepseek-v4-pro"), providerID: ProviderID.make(providerID) }
    expect(ProviderTransform.sanitizeOptions(target, { reasoningEffort: "high" }, "required")).toEqual({})
  })

  test.each(["deepseek-flash", "deepseek-v4-pro"])(
    "%s sends empty reasoning_content without interleaved metadata",
    async (id) => {
      const target = model(id)
      const messages: ModelMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: [{ type: "text", text: "Hello" }] },
        { role: "user", content: "Continue" },
      ]
      const sent = await wireMessages(target, ProviderTransform.message(messages, target, {}))
      expect(sent[1]).toHaveProperty("reasoning_content", "")
    },
  )

  test("retains existing reasoning metadata through repeated normalization", async () => {
    const target = model("deepseek-v4-pro", { field: "reasoning_content" })
    const messages: ModelMessage[] = [
      { role: "user", content: "Inspect the file" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Read before editing." },
          { type: "tool-call", toolCallId: "call-read", toolName: "read", input: { path: "file.ts" } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-read",
            toolName: "read",
            output: { type: "text", value: "file content" },
          },
        ],
      },
    ]
    const once = ProviderTransform.message(messages, target, {})
    const twice = ProviderTransform.message(once, target, {})
    const sent = await wireMessages(target, twice)
    expect(sent[1].reasoning_content).toBe("Read before editing.")
    expect(sent[1].tool_calls[0].id).toBe("call-read")
    expect(twice).toEqual(once)
  })

  test("does not erase reasoning already carried in provider metadata", async () => {
    const target = model("deepseek-flash")
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Result" }],
        providerOptions: { openaiCompatible: { reasoning_content: "Preserved history." } },
      },
      { role: "user", content: "Continue" },
    ]
    const sent = await wireMessages(target, ProviderTransform.message(messages, target, {}))
    expect(sent[0].reasoning_content).toBe("Preserved history.")
  })

  test.each([false, { field: "reasoning_content" } as const])(
    "preserves reasoning across tool and user turns with interleaved=%j",
    async (interleaved) => {
      const target = model("deepseek-flash", interleaved)
      const messages: ModelMessage[] = [
        { role: "user", content: "Inspect the file" },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Read before editing." },
            { type: "tool-call", toolCallId: "call-read", toolName: "read", input: { path: "file.ts" } },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-read",
              toolName: "read",
              output: { type: "text", value: "file content" },
            },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "The file is valid." },
            { type: "text", text: "No change needed." },
          ],
        },
        { role: "user", content: "Summarize" },
      ]
      const once = ProviderTransform.message(messages, target, {})
      const sent = await wireMessages(target, ProviderTransform.message(once, target, {}))
      expect(
        sent.filter((message) => message.role === "assistant").map((message) => message.reasoning_content),
      ).toEqual(["Read before editing.", "The file is valid."])
      expect(sent[2].tool_call_id).toBe("call-read")
    },
  )

  test("sends an explicit empty field for empty reasoning and string assistant content", async () => {
    const target = model("deepseek-v4-pro")
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "" },
          { type: "text", text: "Hello" },
        ],
      },
      { role: "user", content: "Continue" },
      { role: "assistant", content: "Done" },
      { role: "user", content: "Again" },
    ]
    const sent = await wireMessages(target, ProviderTransform.message(messages, target, {}))
    expect(sent[0]).toHaveProperty("reasoning_content", "")
    expect(sent[2]).toHaveProperty("reasoning_content", "")
  })

  test("does not add reasoning metadata to routes that reject it", async () => {
    const target = { ...model("deepseek-r1-distill-llama-70b"), providerID: ProviderID.make("groq") }
    const sent = await wireMessages(
      target,
      ProviderTransform.message(
        [
          { role: "assistant", content: [{ type: "text", text: "Hello" }] },
          { role: "user", content: "Continue" },
        ],
        target,
        {},
      ),
    )
    expect(sent[0]).not.toHaveProperty("reasoning_content")
  })
})
