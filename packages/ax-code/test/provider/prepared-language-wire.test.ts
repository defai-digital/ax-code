import { expect, test } from "vitest"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { prepareLanguageModel } from "../../src/provider/request-compiler"
import type { Provider } from "../../src/provider/provider"

test.each(["doGenerate", "doStream"] as const)(
  "%s compiles final auxiliary requests before the SDK sends them",
  async (method) => {
    const model = {
      id: "custom-alias",
      providerID: "gateway",
      api: { id: "deepseek-flash", npm: "@ai-sdk/openai-compatible", url: "https://gateway.example/v1" },
      capabilities: { toolcall: true, reasoning: true },
      limit: { context: 32000, output: 4000 },
      options: {},
      headers: {},
    } as Provider.Model
    let body: any
    const sdk = createOpenAICompatible({
      name: "gateway",
      baseURL: model.api.url,
      apiKey: "test",
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body))
        throw new Error("captured")
      },
    })
    const language = prepareLanguageModel(sdk.chatModel(model.api.id), model, {})
    await expect(
      language[method]({
        prompt: [{ role: "user", content: [{ type: "text", text: "Read" }] }],
        maxOutputTokens: 8000,
        toolChoice: { type: "required" },
        tools: [
          { type: "function", name: "read", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
        ],
        providerOptions: {
          gateway: { thinking: { type: "enabled" }, reasoning_effort: "max", protocolProfile: "deepseek-v4" },
        },
      }),
    ).rejects.toThrow("captured")
    expect(body.thinking).toEqual({ type: "disabled" })
    expect(body.max_tokens).toBe(4000)
    expect(body.tool_choice).toBe("required")
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.protocolProfile).toBeUndefined()
  },
)
