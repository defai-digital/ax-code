import { describe, expect, test } from "vitest"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import type { Provider } from "../../src/provider/provider"
import { resolveWikiReasoning } from "../../src/wiki/reasoning"
import { cliEffortFromProviderOptions, cliEffortArgs } from "../../src/provider/cli/effort"

function model(npm: string, providerID: string, id: string, extra: Partial<Provider.Model> = {}): Provider.Model {
  return {
    id,
    providerID,
    api: { id, npm, url: "https://gateway.example/v1" },
    capabilities: { reasoning: true },
    options: {},
    variants: {},
    ...extra,
  } as Provider.Model
}

describe("Wiki reasoning preference", () => {
  test.each([
    ["gemini-2.5-flash", { thinkingBudget: 0 }, "off"],
    ["gemini-2.5-pro", { thinkingBudget: 128 }, "low"],
    ["gemini-3.1-pro-preview", { thinkingLevel: "low" }, "low"],
    ["gemini-3.8-flash", { thinkingLevel: "low" }, "low"],
    ["gemini-3-flash-preview", { thinkingLevel: "minimal" }, "low"],
  ])("uses the valid native Google control for %s", (id, thinkingConfig, mode) => {
    expect(
      resolveWikiReasoning(model("@ai-sdk/google", "custom-google", id), {
        thinkingConfig: { thinkingLevel: "minimal" },
      }),
    ).toEqual({ mode, providerOptions: { google: { thinkingConfig } } })
  })

  test.each([
    ["claude-sonnet-4-6", "anthropic", { thinking: { type: "disabled" } }, "off"],
    ["claude-fable-5", "anthropic", { effort: "low" }, "low"],
    ["MiniMax-M3.1-Flash", "minimax", { effort: "low" }, "low"],
  ])("uses valid Anthropic thinking controls for %s", (id, providerID, body, mode) => {
    expect(resolveWikiReasoning(model("@ai-sdk/anthropic", providerID, id), {})).toEqual({
      mode,
      providerOptions: { anthropic: body },
    })
  })

  test("prefers none over low and preserves the native OpenAI namespace", () => {
    const m = model("@ai-sdk/openai", "custom-openai", "gpt-model", {
      variants: {
        low: { reasoningEffort: "low" },
        none: { reasoningEffort: "none" },
      },
    })
    expect(resolveWikiReasoning(m, {})).toEqual({
      mode: "off",
      providerOptions: { openai: { reasoningEffort: "none" } },
    })
  })

  test("does not treat a misleading variant name or hidden reasoning as low effort", () => {
    const m = model("custom-sdk", "custom", "model", {
      variants: {
        none: { reasoningEffort: "high" },
        low: { reasoning: { exclude: true } },
      },
    })
    expect(resolveWikiReasoning(m, {})).toEqual({ mode: "uncontrolled" })
  })

  test("respects explicitly empty variants and identifies non-reasoning models", () => {
    expect(resolveWikiReasoning(model("@ai-sdk/openai", "openai", "new-model"), {})).toEqual({ mode: "uncontrolled" })
    expect(
      resolveWikiReasoning(
        model("custom-sdk", "custom", "model", {
          capabilities: { reasoning: false } as Provider.Model["capabilities"],
        }),
        {},
      ),
    ).toEqual({ mode: "not-required" })
  })

  test("refuses variants whose effort field would be discarded by the selected SDK", () => {
    for (const npm of ["@openrouter/ai-sdk-provider", "@ai-sdk/anthropic", "cli", "custom-sdk"]) {
      const m = model(npm, "custom", "model", { variants: { low: { reasoningEffort: "low" } } })
      expect(resolveWikiReasoning(m, {})).toEqual({ mode: "uncontrolled" })
    }
  })

  test("uses an explicit OpenRouter reasoning variant without OpenAI fields", () => {
    const m = model("@openrouter/ai-sdk-provider", "custom-router", "vendor/model", {
      variants: { low: { reasoning: { effort: "low" } } },
    })
    expect(resolveWikiReasoning(m, {})).toEqual({
      mode: "low",
      providerOptions: { openrouter: { reasoning: { effort: "low" } } },
    })
  })

  test.each(["claude-code", "codex-cli", "grok-build-cli", "muse-cli"])(
    "passes the lowest CLI effort through to %s arguments",
    (providerID) => {
      const m = model("cli", providerID, "model", {
        variants: undefined,
        capabilities: { reasoning: false } as Provider.Model["capabilities"],
      })
      const policy = resolveWikiReasoning(m, {})
      const effort = cliEffortFromProviderOptions(providerID, policy.providerOptions)
      expect(policy.mode).toBe("low")
      expect(["low", "minimal"]).toContain(effort)
      expect(cliEffortArgs(providerID, effort).length).toBeGreaterThan(0)
    },
  )

  test("preserves a dotted compatible provider namespace and a template off switch", async () => {
    const m = model("@ai-sdk/openai-compatible", "custom.gateway", "qwen-model")
    const policy = resolveWikiReasoning(m, { enable_thinking: false })
    let sent: any
    const sdk = createOpenAICompatible({
      name: "custom.gateway",
      baseURL: "https://fixture.example/v1",
      fetch: async (_, init) => {
        sent = JSON.parse(String(init?.body))
        return Response.json({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] })
      },
    })
    await sdk.chatModel("qwen-model").doGenerate({ prompt: [], providerOptions: policy.providerOptions })
    expect(sent.enable_thinking).toBe(false)
    expect(sent.reasoning_effort).toBeUndefined()
  })

  test("does not claim a hosted MiniMax template hint disables reasoning", () => {
    const m = model("@ai-sdk/openai-compatible", "gateway", "MiniMax-M2.7", { variants: undefined })
    expect(resolveWikiReasoning(m, { chat_template_kwargs: { enable_thinking: false } })).toEqual({
      mode: "uncontrolled",
    })
    m.api.url = "http://127.0.0.1:8000/v1"
    expect(resolveWikiReasoning(m, { chat_template_kwargs: { enable_thinking: false } }).mode).toBe("off")
  })

  test("respects dialect opt-out and prefers explicit none to a low default", () => {
    const m = model("@ai-sdk/openai-compatible", "gateway", "model", {
      options: { nativeReasoning: false },
      variants: { low: { reasoningEffort: "low" } },
    })
    expect(resolveWikiReasoning(m, { reasoningEffort: "low" })).toEqual({ mode: "uncontrolled" })
    m.options = {}
    m.variants = { none: { reasoningEffort: "none" } }
    expect(resolveWikiReasoning(m, { reasoningEffort: "low" }).mode).toBe("off")
  })

  test("requests low GPT-OSS effort through a compatible gateway", () => {
    expect(resolveWikiReasoning(model("@ai-sdk/openai-compatible", "gateway", "openai/gpt-oss-120b"), {})).toEqual({
      mode: "low",
      providerOptions: { openaiCompatible: { reasoningEffort: "low" }, gateway: { reasoningEffort: "low" } },
    })
  })

  test("serializes native Google, Anthropic and OpenAI policies on the wire", async () => {
    const capture = (reply: unknown) => {
      const bodies: any[] = []
      return {
        bodies,
        fetch: async (_: unknown, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)))
          return Response.json(reply)
        },
      }
    }
    const google = capture({
      candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
    })
    await createGoogleGenerativeAI({ apiKey: "fixture", fetch: google.fetch })("gemini-3.8-flash").doGenerate({
      prompt: [],
      providerOptions: resolveWikiReasoning(model("@ai-sdk/google", "custom-google", "gemini-3.8-flash"), {})
        .providerOptions,
    })
    expect(google.bodies[0].generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" })

    const anthropic = capture({
      id: "fixture",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    await createAnthropic({ apiKey: "fixture", fetch: anthropic.fetch })("claude-sonnet-4-6").doGenerate({
      prompt: [],
      providerOptions: resolveWikiReasoning(model("@ai-sdk/anthropic", "anthropic", "claude-sonnet-4-6"), {})
        .providerOptions,
    })
    // Older Claude models default to off; this SDK omits disabled thinking.
    expect(anthropic.bodies[0].thinking).toBeUndefined()
    await createAnthropic({ apiKey: "fixture", fetch: anthropic.fetch })("claude-fable-5").doGenerate({
      prompt: [],
      providerOptions: resolveWikiReasoning(model("@ai-sdk/anthropic", "anthropic", "claude-fable-5"), {})
        .providerOptions,
    })
    expect(anthropic.bodies[1].output_config).toEqual({ effort: "low" })

    const openai = capture({
      id: "fixture",
      created: 1,
      model: "gpt-5",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    })
    await createOpenAI({ apiKey: "fixture", fetch: openai.fetch })
      .chat("gpt-5")
      .doGenerate({
        prompt: [],
        providerOptions: resolveWikiReasoning(
          model("@ai-sdk/openai", "openai", "gpt-5", { variants: { low: { reasoningEffort: "low" } } }),
          {},
        ).providerOptions,
      })
    expect(openai.bodies[0].reasoning_effort).toBe("low")
  })
})
