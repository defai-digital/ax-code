import { describe, expect, test } from "vitest"
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import type { Provider } from "../../src/provider/provider"
import { compileModelRequest, ModelRequestError } from "../../src/provider/request-compiler"
import { resolveProtocolProfile } from "../../src/provider/protocol-profile"

function model(id: string): Provider.Model {
  return {
    id,
    providerID: "gateway",
    name: "Display Name",
    api: { id, url: "https://gateway.example/v1", npm: "@ai-sdk/openai-compatible" },
    capabilities: {
      reasoning: true,
      toolcall: true,
      temperature: true,
      attachment: false,
      input: { text: true },
      output: { text: true },
      interleaved: false,
    },
    limit: { context: 32000, output: 4000 },
    options: {},
    headers: {},
    status: "active",
    release_date: "",
  } as Provider.Model
}
const request: LanguageModelV3CallOptions = {
  prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
  tools: [
    { type: "function", name: "read", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
  ],
  toolChoice: { type: "required" },
  maxOutputTokens: 8000,
}

describe("final request compiler", () => {
  test.each(["deepseek-flash", "qwen3.8-flash", "glm-5.3", "gemini-3.8-flash", "kimi-k3"])(
    "is immutable and idempotent for %s, including aliases and display names",
    (id) => {
      const current = model(id)
      const input = structuredClone(request)
      const prepared = compileModelRequest(current, input)
      expect(compileModelRequest(current, prepared.params).params).toEqual(prepared.params)
      expect(input).toEqual(request)
      expect(prepared.params.maxOutputTokens).toBe(4000)
      expect(
        compileModelRequest({ ...current, id: "alias", name: "Gemini 2.5 migration guide" } as Provider.Model, input)
          .params,
      ).toEqual(prepared.params)
    },
  )

  test.each([
    "glm-5.3",
    "glm-5.3-flash",
    "glm-5.3-flashx",
    "glm-5.3-flashx-legal",
    "glm-5.3-free",
    "z-ai/glm-5.3:free",
    // Later GLM 5.x releases share the 5.3 request contract.
    "glm-5.4",
    "glm-5.4-flash",
    "z-ai/glm-5.4-flash",
    "glm-5.10",
    "GLM-5.4",
  ])("resolves %s to the glm5 reasoning family", (id) => {
    expect(resolveProtocolProfile(model(id)).reasoningFamily).toBe("glm5")
  })

  test.each(["glm-5.2", "glm-5.1", "glm-5", "glm-5.3-highspeed", "glm-5.3-flashy", "glm-6.0", "glm-4.7-flash"])(
    "does not treat %s as glm5",
    (id) => {
      expect(resolveProtocolProfile(model(id)).reasoningFamily).toBeUndefined()
    },
  )

  test("accepts the legacy glm5.3 protocolProfile override", () => {
    const current = model("my-deployment")
    current.options = { protocolProfile: "glm5.3" }
    expect(resolveProtocolProfile(current).reasoningFamily).toBe("glm5")
  })

  test.each([{ type: "required" }, { type: "tool", toolName: "read" }] as const)(
    "forced tool %j cannot reintroduce thinking on DeepSeek",
    (toolChoice) => {
      const prepared = compileModelRequest(model("deepseek-flash"), {
        ...request,
        toolChoice,
        providerOptions: { gateway: { thinking: { type: "enabled" }, reasoning_effort: "high" } },
      })
      expect(prepared.params.providerOptions?.gateway).toEqual({ thinking: { type: "disabled" } })
    },
  )

  test("rejects unsupported tool use before transport and validates output budgets", () => {
    const target = model("unqualified")
    target.capabilities.toolcall = false
    expect(() => compileModelRequest(target, request)).toThrow(ModelRequestError)
    for (const maxOutputTokens of [0, -1, NaN, Infinity, 1.5])
      expect(() => compileModelRequest(model("valid"), { ...request, maxOutputTokens })).toThrow(ModelRequestError)
  })

  test("profiles allow explicit deployment dialects and never infer them from display names", () => {
    const target = model("deployment-123")
    target.options.protocolProfile = "deepseek-v4"
    expect(resolveProtocolProfile(target).reasoningFamily).toBe("deepseek-v4")
    expect(
      resolveProtocolProfile({ ...target, options: {}, name: "DeepSeek Flash" } as Provider.Model).reasoningFamily,
    ).toBeUndefined()
    expect(
      compileModelRequest(target, { ...request, providerOptions: { gateway: { protocolProfile: "deepseek-v4" } } })
        .params.providerOptions?.gateway,
    ).not.toHaveProperty("protocolProfile")
  })
})
