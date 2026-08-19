import { describe, expect, test } from "vitest"
import { DEFAULT_SETUP_PROVIDER_IDS } from "../../src/provider/default-setup-providers"
import { ModelsDev } from "../../src/provider/models"
import { ProviderTransform } from "../../src/provider/transform"
import { shouldShowProviderInList } from "../../src/server/routes/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { Provider } from "../../src/provider/provider"

describe("cloud API providers: DeepSeek + Meta Muse Spark", () => {
  test("deepseek and meta are native setup/login providers", () => {
    expect(DEFAULT_SETUP_PROVIDER_IDS).toContain("deepseek")
    expect(DEFAULT_SETUP_PROVIDER_IDS).toContain("meta")
    expect(DEFAULT_SETUP_PROVIDER_IDS).toContain("zai")
    expect(DEFAULT_SETUP_PROVIDER_IDS).toContain("minimax-coding-plan")
    expect(DEFAULT_SETUP_PROVIDER_IDS).toContain("minimax-cn-coding-plan")
    expect(
      shouldShowProviderInList({
        key: "deepseek",
        disabled: new Set(),
      }),
    ).toBe(true)
    expect(
      shouldShowProviderInList({
        key: "meta",
        disabled: new Set(),
      }),
    ).toBe(true)
  })

  test("catalog exposes DeepSeek cloud models and DEEPSEEK_API_KEY", async () => {
    const all = await ModelsDev.get()
    const deepseek = all["deepseek"]
    expect(deepseek).toBeDefined()
    expect(deepseek?.env).toContain("DEEPSEEK_API_KEY")
    expect(deepseek?.api).toMatch(/api\.deepseek\.com/)
    expect(deepseek?.npm).toBe("@ai-sdk/openai-compatible")
    expect(deepseek?.models["deepseek-v4-pro"]).toBeDefined()
    expect(deepseek?.models["deepseek-v4-flash"]).toBeDefined()
    expect(deepseek?.models["deepseek-v4-pro"]?.tool_call).toBe(true)
  })

  test("catalog exposes Meta Muse Spark models and MODEL_API_KEY aliases", async () => {
    const all = await ModelsDev.get()
    const meta = all["meta"]
    expect(meta).toBeDefined()
    // Meta docs use MODEL_API_KEY; models.dev ships META_MODEL_API_KEY — both accepted.
    expect(meta?.env).toEqual(expect.arrayContaining(["META_MODEL_API_KEY", "MODEL_API_KEY"]))
    expect(meta?.api).toMatch(/api\.meta\.ai/)
    expect(meta?.npm).toBe("@ai-sdk/openai")
    expect(meta?.models["muse-spark-1.2"]).toBeDefined()
    expect(meta?.models["muse-spark-1.1"]).toBeDefined()
    expect(meta?.models["muse-spark-1.2"]?.tool_call).toBe(true)
    expect(meta?.models["muse-spark-1.2"]?.limit?.context).toBeGreaterThanOrEqual(1_000_000)
  })

  test("Muse Spark models publish reasoningEffort variants with encrypted reasoning include", () => {
    const model = {
      id: ModelID.make("muse-spark-1.2"),
      providerID: ProviderID.make("meta"),
      name: "Muse Spark 1.2",
      family: "muse",
      api: {
        id: "muse-spark-1.2",
        url: "https://api.meta.ai/v1",
        npm: "@ai-sdk/openai",
      },
      status: "active" as const,
      headers: {},
      options: {},
      limit: { context: 1_048_576, output: 131_072 },
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: true, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false as const,
      },
      release_date: "2026-08-05",
    } satisfies Provider.Model

    const variants = ProviderTransform.variants(model)
    expect(Object.keys(variants)).toEqual(expect.arrayContaining(["high", "xhigh", "medium"]))
    expect(variants.high).toMatchObject({
      reasoningEffort: "high",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    })
  })
})
