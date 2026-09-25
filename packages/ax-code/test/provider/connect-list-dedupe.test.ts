import { describe, expect, test } from "vitest"
import {
  dedupeApiCloudVendorVariants,
  normalizeConnectVendorName,
} from "../../src/provider/default-setup-providers"
import { ModelsDev } from "../../src/provider/models"
import { shouldShowProviderInList } from "../../src/server/routes/provider"
import { providerConnectCategory } from "../../src/mode/provider-category"

function record(id: string, name: string, modelCount = 1): ModelsDev.Provider {
  return {
    id,
    name,
    env: [],
    npm: "@ai-sdk/openai-compatible",
    models: Object.fromEntries(
      Array.from({ length: modelCount }, (_, index) => [`${id}-model-${index}`, {} as ModelsDev.Model]),
    ),
  }
}

describe("normalizeConnectVendorName", () => {
  test.each([
    ["Alibaba Coding Plan (China)", "alibaba"],
    ["Alibaba Token Plan", "alibaba"],
    ["MiniMax (minimax.io)", "minimax"],
    ["MiniMax (minimax.cn)", "minimax"],
    ["MiniMax Token Plan (China)", "minimax"],
    ["Vertex (Anthropic)", "vertex"],
    ["Vertex", "vertex"],
    ["Tencent TokenHub", "tencent"],
    ["Tencent Coding Plan (China)", "tencent"],
    ["Tencent Token Plan", "tencent"],
    ["StepFun Step Plan (Global)", "stepfun"],
    ["StepFun (China)", "stepfun"],
    ["Xiaomi Token Plan (Europe)", "xiaomi"],
    ["Z.AI Coding Plan", "z.ai"],
    ["SiliconFlow (China)", "siliconflow"],
    ["Perplexity Agent", "perplexity agent"],
    ["Perplexity", "perplexity"],
    ["OpenCode Zen", "opencode zen"],
    ["OpenCode Go", "opencode go"],
    ["Meta", "meta"],
    ["Llama", "llama"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeConnectVendorName(input)).toBe(expected)
  })

  test("is idempotent", () => {
    const once = normalizeConnectVendorName("MiniMax Token Plan (China)")
    expect(normalizeConnectVendorName(once)).toBe(once)
    expect(once).toBe("minimax")
  })
})

describe("dedupeApiCloudVendorVariants", () => {
  test("collapses region variants to the plain base row", () => {
    const providers = {
      siliconflow: record("siliconflow", "SiliconFlow"),
      "siliconflow-cn": record("siliconflow-cn", "SiliconFlow (China)"),
    }
    expect(dedupeApiCloudVendorVariants(providers)).toEqual(["siliconflow"])
  })

  test("prefers the curated member as representative", () => {
    const providers = {
      minimax: record("minimax", "MiniMax (minimax.io)"),
      "minimax-coding-plan": record("minimax-coding-plan", "MiniMax Token Plan"),
      "minimax-cn-coding-plan": record("minimax-cn-coding-plan", "MiniMax Token Plan (China)"),
    }
    expect(dedupeApiCloudVendorVariants(providers)).toEqual(["minimax-coding-plan"])
  })

  test("prefers a non-China variant over a China variant when no plain base exists", () => {
    const providers = {
      stepfun: record("stepfun", "StepFun (China)"),
      "stepfun-ai": record("stepfun-ai", "StepFun (Global)"),
      "stepfun-step-plan": record("stepfun-step-plan", "StepFun Step Plan (China)"),
      "stepfun-ai-step-plan": record("stepfun-ai-step-plan", "StepFun Step Plan (Global)"),
    }
    expect(dedupeApiCloudVendorVariants(providers)).toEqual(["stepfun-ai"])
  })

  test("never drops ids in the keep set", () => {
    const providers = {
      siliconflow: record("siliconflow", "SiliconFlow"),
      "siliconflow-cn": record("siliconflow-cn", "SiliconFlow (China)"),
      zai: record("zai", "Z.AI"),
      "zai-coding-plan": record("zai-coding-plan", "Z.AI Coding Plan"),
    }
    const kept = dedupeApiCloudVendorVariants(providers, new Set(["siliconflow-cn"]))
    expect(kept).toEqual(expect.arrayContaining(["siliconflow", "siliconflow-cn", "zai"]))
    expect(kept).not.toContain("zai-coding-plan")
  })

  test("keeps single-member groups and never drops non-api records", () => {
    const providers = {
      perplexity: record("perplexity", "Perplexity"),
      "perplexity-agent": record("perplexity-agent", "Perplexity Agent"),
      ollama: record("ollama", "Ollama Cloud"),
      "claude-code": record("claude-code", "Claude Code", 0),
      nebius: record("nebius", "Nebius"),
      "ax-engine": record("ax-engine", "AX Engine"),
    }
    const kept = dedupeApiCloudVendorVariants(providers)
    // perplexity/perplexity-agent normalize apart and both survive.
    expect(kept).toEqual(
      expect.arrayContaining(["perplexity", "perplexity-agent", "ollama", "claude-code", "nebius", "ax-engine"]),
    )
  })

  test("names normalizing to empty never share a bucket", () => {
    const providers = {
      "vendor-one": record("vendor-one", "(China)"),
      "vendor-two": record("vendor-two", "(Global)"),
    }
    expect(dedupeApiCloudVendorVariants(providers)).toEqual(["vendor-one", "vendor-two"])
  })

  test("is deterministic across runs", () => {
    const providers = {
      "tencent-token-plan": record("tencent-token-plan", "Tencent Token Plan"),
      "tencent-coding-plan": record("tencent-coding-plan", "Tencent Coding Plan (China)"),
      "tencent-tokenhub": record("tencent-tokenhub", "Tencent TokenHub"),
    }
    const first = dedupeApiCloudVendorVariants(providers)
    expect(dedupeApiCloudVendorVariants(providers)).toEqual(first)
    expect(first).toEqual(["tencent-token-plan"])
  })
})

describe("connect list vendor dedupe against the bundled catalog", () => {
  test("default-visible api providers have one row per normalized vendor", async () => {
    const all = await ModelsDev.get()
    const visible: Record<string, ModelsDev.Provider> = {}
    for (const [id, provider] of Object.entries(all)) {
      if (shouldShowProviderInList({ key: id, provider, disabled: new Set(), axEngineSupported: true })) {
        visible[id] = provider
      }
    }
    const kept = dedupeApiCloudVendorVariants(visible)
    const keptSet = new Set(kept)
    const apiKept = kept.filter((id) => providerConnectCategory(id) === "api")
    console.log(`KEPT_API_ROWS ${apiKept.length} (was ${Object.keys(visible).length} visible providers total)`)

    const byVendor = new Map<string, string[]>()
    for (const id of apiKept) {
      const key = normalizeConnectVendorName(visible[id].name)
      byVendor.set(key, [...(byVendor.get(key) ?? []), id])
    }
    const duplicates = [...byVendor.entries()].filter(([, members]) => members.length > 1)
    expect(duplicates).toEqual([])

    // Collapsed clusters keep the expected representative.
    expect(keptSet.has("siliconflow")).toBe(true)
    expect(keptSet.has("siliconflow-cn")).toBe(false)
    expect(keptSet.has("zhipuai")).toBe(true)
    expect(keptSet.has("zhipuai-coding-plan")).toBe(false)
    expect(keptSet.has("minimax-coding-plan")).toBe(true)
    expect(keptSet.has("minimax")).toBe(false)
    expect(keptSet.has("xiaomi")).toBe(true)
    expect(keptSet.has("google-vertex")).toBe(true)
    expect(keptSet.has("google-vertex-anthropic")).toBe(false)
    expect(keptSet.has("zai")).toBe(true)
    expect(keptSet.has("zai-coding-plan")).toBe(false)
    expect(keptSet.has("alibaba-coding-plan")).toBe(true)
    expect(keptSet.has("alibaba-token-plan")).toBe(false)
    expect(keptSet.has("stepfun-ai")).toBe(true)
    expect(keptSet.has("umans-ai")).toBe(true)

    // Explicit non-merge pairs both survive.
    expect(keptSet.has("perplexity")).toBe(true)
    expect(keptSet.has("perplexity-agent")).toBe(true)
    expect(keptSet.has("meta")).toBe(true)
    expect(keptSet.has("llama")).toBe(true)
    expect(keptSet.has("opencode")).toBe(true)
    expect(keptSet.has("opencode-go")).toBe(true)

    // The collapse actually shrinks the list.
    expect(apiKept.length).toBeLessThan(Object.keys(visible).length)
  })
})
