import { describe, expect, test } from "vitest"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { Provider } from "../../src/provider/provider"
import { ProviderTransform as T } from "../../src/provider/transform"
import { ReasoningPolicy } from "../../src/control-plane/reasoning-policy"
import { parseJsonStrict } from "../../src/util/json-value"

function model(id: string, providerID = "custom-gateway", npm = "@ai-sdk/openai-compatible") {
  return {
    id,
    providerID,
    api: { id, npm, url: "https://gateway.example/v1" },
    capabilities: { reasoning: true, toolcall: true, interleaved: false },
    limit: { context: 1_000_000, output: 131_072 },
    options: {},
  } as Provider.Model
}

async function wire(m: Provider.Model, options: Record<string, any>, prompt: any[] = []) {
  let body: any
  const sdk = createOpenAICompatible({
    name: m.providerID,
    baseURL: m.api.url,
    apiKey: "test",
    fetch: async (_url, init) => {
      body = parseJsonStrict(String(init?.body))
      throw new Error("captured")
    },
  })
  await expect(
    sdk.chatModel(m.api.id).doGenerate({
      prompt: T.message(prompt, m, options) as any,
      maxOutputTokens: 4096,
      providerOptions: T.providerOptions(m, T.sanitizeOptions(m, options)),
    }),
  ).rejects.toThrow("captured")
  return body
}

describe("current-family effort contracts", () => {
  test.each(["qwen3.8-max", "qwen3.8-flash"])(
    "serializes %s canonical effort without a budget conflict",
    async (id) => {
      for (const provider of ["custom-gateway", "alibaba-token-plan"]) {
        const m = model(id, provider)
        const variants = T.variants(m)
        expect(variants.xhigh).toEqual({ reasoningEffort: "xhigh" })
        expect(variants.high).toEqual(variants.xhigh)
        const body = await wire(m, {
          ...T.options({ model: m, sessionID: "test" }),
          thinking_budget: 8192,
          ...variants.xhigh,
        })
        expect(body.reasoning_effort).toBe("xhigh")
        expect(body.thinking_budget).toBeUndefined()
      }
    },
  )

  test.each(["glm-5.3", "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-flash"])(
    "serializes %s max effort",
    async (id) => {
      const m = model(id)
      const body = await wire(m, T.variants(m).max)
      expect(body.reasoning_effort).toBe("max")
      expect(T.variants(m).low).toEqual({ reasoningEffort: "low" })
    },
  )

  test("GLM autonomous and recovery requests retain max rather than reducing the upstream default", () => {
    const m = model("glm-5.3")
    m.variants = T.variants(m)
    for (const input of [{ autonomous: true }, { failureCount: 2 }]) {
      expect(ReasoningPolicy.decide({ model: m, agent: { name: "build" }, messages: [], ...input }).options).toEqual({
        reasoningEffort: "max",
      })
    }
  })

  test("explicit Qwen thinking budget prevents automatic effort selection", () => {
    const m = model("qwen3.8-max")
    m.variants = T.variants(m)
    m.options = { thinking_budget: 2048 }
    expect(
      ReasoningPolicy.decide({ model: m, agent: { name: "build" }, messages: [], autonomous: true }).options,
    ).toEqual({})
    expect(T.sanitizeOptions(m, m.options)).toEqual({ thinking_budget: 2048 })
  })

  test("snake-case effort survives the installed SDK", async () => {
    const body = await wire(model("deepseek-v4-pro"), { reasoning_effort: "max" })
    expect(body.reasoning_effort).toBe("max")
  })

  test("disabled Qwen thinking removes effort, budget and preservation", () => {
    expect(
      T.sanitizeOptions(model("qwen3.8-max"), {
        enable_thinking: false,
        reasoningEffort: "xhigh",
        thinking_budget: 4096,
        preserve_thinking: true,
      }),
    ).toEqual({ enable_thinking: false })
  })

  test.each(["mtplx", "omlx"])("%s does not inherit cloud GLM reasoning defaults", (providerID) => {
    const m = model("glm-5.3", providerID)
    expect(T.variants(m)).toEqual({})
    expect(T.options({ model: m, sessionID: "test", longAgent: true })).toEqual({})
  })

  test("custom deployments can opt out without leaking the local knob", async () => {
    const m = model("glm-5.3")
    m.options = { nativeReasoning: false }
    expect(T.variants(m)).toEqual({})
    expect(T.options({ model: m, sessionID: "test", longAgent: true })).toEqual({})
    expect(await wire(m, m.options)).not.toHaveProperty("nativeReasoning")
  })

  test.each(["https://openrouter.ai/api/v1", "https://api.groq.com/openai/v1"])(
    "a renamed constrained gateway at %s retains its dialect",
    (url) => {
      const m = model("glm-5.3")
      m.api.url = url
      expect(T.variants(m)).toEqual({})
    },
  )

  test.each(["qwen3.8-max", "qwen3.8-flash"])("%s required tools disable thinking for one request", (id) => {
    const m = model(id)
    const options = { ...T.variants(m).xhigh, thinking_budget: 8192, preserve_thinking: true }
    expect(T.sanitizeOptions(m, options, "required")).toEqual({ enable_thinking: false })
    expect(T.sanitizeOptions(m, options, "auto")).toEqual({ reasoningEffort: "xhigh", preserve_thinking: true })
    expect(options.thinking_budget).toBe(8192)
  })

  test.each(["qwen3.8-max", "glm-5.3", "deepseek-v4-pro", "MiniMax-M3"])(
    "%s auxiliary overrides remove incompatible merged controls",
    (id) => {
      const m = model(id)
      const options = T.sanitizeOptions(
        m,
        T.applySmallOverrides(m, {
          reasoningEffort: "max",
          reasoning_effort: "max",
          thinking_budget: 100000,
          thinking: { type: "adaptive", budgetTokens: 12000, clear_thinking: false },
          enable_thinking: true,
          preserve_thinking: true,
        }),
      )
      if (id === "glm-5.3") {
        expect(options.reasoningEffort).toBe("low")
        expect(options.thinking).toEqual({ type: "enabled" })
      } else expect(options.reasoningEffort).toBeUndefined()
      if (id === "qwen3.8-max") {
        expect(options.thinking_budget).toBeUndefined()
        expect(options.preserve_thinking).toBeUndefined()
      }
    },
  )

  test.each(["zai-org/GLM-5.3", "deepseek-ai/DeepSeek-V4-Flash", "Qwen/Qwen3.8-Flash", "MiniMaxAI/MiniMax-M3"])(
    "%s repository IDs do not imply native Chat contracts",
    (id) => {
      const m = model(id)
      expect(T.variants(m).max).toBeUndefined()
      expect(T.variants(m).xhigh).toBeUndefined()
      expect(T.options({ model: m, sessionID: "test" }).reasoning_split).toBeUndefined()
    },
  )
  test.each([
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  ])("DashScope at %s does not inherit another vendor dialect", (url) => {
    const m = model("glm-5.3")
    m.api.url = url
    expect(T.variants(m)).toEqual({})
    expect(
      T.options({ model: m, sessionID: "test", longAgent: true, providerOptions: { preserveThinking: true } }),
    ).toEqual({})
  })
  test("Qwen Token Plan keeps a bounded fallback budget when no effort is selected", async () => {
    const m = model("qwen3.8-max", "alibaba-token-plan")
    const body = await wire(m, T.options({ model: m, sessionID: "test" }))
    expect(body.thinking_budget).toBe(16384)
    expect(body.reasoning_effort).toBeUndefined()
  })
  test("DeepSeek explicit xdeep resolves to max", () => {
    const m = model("deepseek-v4-pro")
    m.variants = T.variants(m)
    expect(
      ReasoningPolicy.decide({ model: m, agent: { name: "build" }, messages: [], requestedDepth: "xdeep" }).options,
    ).toEqual({ reasoningEffort: "max" })
  })

  test.each(["glm-5.3", "deepseek-v4-pro"])("%s ordinary turns keep the provider effort default", (id) => {
    const m = model(id)
    m.variants = T.variants(m)
    expect(
      ReasoningPolicy.decide({ model: m, agent: { name: "build" }, messages: [{ role: "user", content: "Hello" }] })
        .options,
    ).toEqual({})
  })

  test.each(["MiniMax-M2.7", "MiniMax-M3"])("%s small overrides retain split reasoning", (id) => {
    expect(T.applySmallOverrides(model(id), { reasoning_split: false }).reasoning_split).toBe(true)
  })

  test("explicit negative metadata and native DeepSeek SDK do not advertise unsupported effort", () => {
    const m = model("deepseek-flash")
    m.capabilities.reasoning = false
    expect(T.variants(m)).toEqual({})
    expect(T.smallOptions(m)).toEqual({})
    expect(T.variants(model("deepseek-v4-pro", "deepseek", "@ai-sdk/deepseek"))).toEqual({})
  })

  test.each(["groq", "openrouter", "alibaba-pai", "custom-private-gpu", "ax-engine", "local-llm"])(
    "does not add current-family controls to %s",
    (provider) => {
      const m = model("glm-5.3", provider)
      expect(T.variants(m)).toEqual({})
      expect(T.smallOptions(m).reasoningEffort).toBeUndefined()
    },
  )

  test.each(["glm-5.30", "deepseek-v4-proxy", "qwen3.8-max-preview", "MiniMax-M30"])(
    "does not infer a current profile from %s",
    (id) => {
      const m = model(id)
      expect(T.options({ model: m, sessionID: "test" }).reasoning_split).toBeUndefined()
      expect(T.variants(m).max).toBeUndefined()
    },
  )
})

describe("reasoning continuity", () => {
  const reasoning = "Inspect the data.\nThen use the returned value exactly."
  const history: any[] = [
    { role: "user", content: [{ type: "text", text: "Look up alpha" }] },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: reasoning },
        { type: "tool-call", toolCallId: "lookup-1", toolName: "lookup", input: { key: "alpha" } },
      ],
    },
    {
      role: "tool",
      content: [
        { type: "tool-result", toolCallId: "lookup-1", toolName: "lookup", output: { type: "json", value: 731 } },
      ],
    },
  ]

  test.each(["qwen3.8-max", "glm-5.3", "deepseek-v4-pro", "MiniMax-M2.7", "MiniMax-M3"])(
    "%s keeps exact reasoning and tool identity on the SDK wire",
    async (id) => {
      const m = model(id)
      const options = T.options({
        model: m,
        sessionID: "test",
        longAgent: true,
        providerOptions: { preserveThinking: true },
      })
      const body = await wire(m, options, history)
      expect(body.messages[1].reasoning_content).toBe(reasoning)
      expect(body.messages[1].content).not.toContain("<mm:think>")
      expect(body.messages[1].tool_calls[0].id).toBe("lookup-1")
      expect(body.messages[2].tool_call_id).toBe("lookup-1")
      if (id.startsWith("MiniMax")) expect(body.reasoning_split).toBe(true)
      if (id === "glm-5.3") expect(body.thinking).toEqual({ type: "enabled", clear_thinking: false })
    },
  )

  test.each(["MiniMax-M2.7", "MiniMax-M3"])(
    "%s declared interleaved reasoning survives repeated normalization",
    async (id) => {
      const m = model(id)
      m.capabilities.interleaved = { field: "reasoning_content" }
      const options = T.options({ model: m, sessionID: "test" })
      const normalized = T.message(history, m, options)
      const body = await wire(m, options, normalized)
      expect(body.messages[1].reasoning_content).toBe(reasoning)
      expect(body.messages[1].content).not.toContain("<think>")
    },
  )

  test("GLM preservation has an independent opt-out", () => {
    const m = model("glm-5.3")
    expect(
      T.options({ model: m, sessionID: "test", longAgent: true, providerOptions: { preserveThinking: false } })
        .thinking,
    ).toBeUndefined()
  })

  test("MiniMax explicit unsplit mode replays native think tags", async () => {
    const body = await wire(model("MiniMax-M3"), { reasoning_split: false }, history)
    expect(body.messages[1].reasoning_content).toBeUndefined()
    expect(body.messages[1].content).toContain(`<think>${reasoning}</think>`)
  })

  test.each([
    ["glm-5.3", { reasoningEffort: "low", thinking: { type: "enabled" } }],
    ["deepseek-v4-pro", { thinking: { type: "disabled" } }],
    ["qwen3.8-max", { enable_thinking: false }],
    ["MiniMax-M3", { thinking: { type: "disabled" }, reasoning_split: true }],
    ["MiniMax-M2.7", { reasoning_split: true }],
  ])("%s auxiliary options respect the actual thinking switch", (id, expected) => {
    expect(T.smallOptions(model(id as string))).toEqual(expected)
  })

  test("DeepSeek required tools still disable thinking after effort selection", () => {
    const m = model("deepseek-v4-pro")
    expect(T.sanitizeOptions(m, { ...T.variants(m).max, thinking: { type: "enabled" } }, "required")).toEqual({
      thinking: { type: "disabled" },
    })
  })
})
