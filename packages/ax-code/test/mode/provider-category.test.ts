import { describe, expect, test } from "vitest"
import { CLI_PROVIDER_DEFINITIONS } from "../../src/provider/cli/config"
import {
  CATALOG_PRIVATE_GPU_PROVIDER_IDS as PRESET_CATALOG_IDS,
  DEDICATED_PRIVATE_GPU_PROVIDER_IDS as PRESET_DEDICATED_IDS,
} from "../../src/provider/private-gpu/presets"
import {
  CATALOG_PRIVATE_GPU_PROVIDER_IDS,
  CLI_PLAN_PROVIDER_IDS,
  DEDICATED_PRIVATE_GPU_PROVIDER_IDS,
  defaultProviderConnectCategory,
  LOCAL_LLM_PROVIDER_IDS,
  LOCAL_RUNTIME_PROVIDER_IDS,
  PRIVATE_GPU_CLOUD_PROVIDER_IDS,
  providerConnectCategoriesPresent,
  providerConnectCategory,
  providerConnectCategoryLabel,
  providerConnectCategorySortKey,
  providerConnectTypeOptionDescription,
  providersInConnectCategory,
} from "../../src/mode/provider-category"

describe("provider connect category", () => {
  test("classifies AX Engine, local LLM, private GPU, CLI, and API providers", () => {
    expect(providerConnectCategory("ax-engine")).toBe("ax-engine")
    expect(providerConnectCategory("ollama")).toBe("local")
    expect(providerConnectCategory("lmstudio")).toBe("local")
    expect(providerConnectCategory("local-llm")).toBe("local")
    expect(providerConnectCategory("alibaba-pai")).toBe("private-gpu")
    expect(providerConnectCategory("nebius")).toBe("private-gpu")
    expect(providerConnectCategory("grok-build-cli")).toBe("cli")
    expect(providerConnectCategory("openai")).toBe("api")
    expect(providerConnectCategory("huggingface")).toBe("api")
    expect(providerConnectCategory("huggingface-endpoints")).toBe("private-gpu")
    expect(providerConnectCategory("ax-trust-defai-digital")).toBe("ax-trust")
  })

  test("uses the same labels as the connect dialog", () => {
    expect(providerConnectCategoryLabel("ax-engine")).toBe("AX-Engine runtime")
    expect(providerConnectCategoryLabel("ollama")).toBe("Local LLM runtime")
    expect(providerConnectCategoryLabel("runpod")).toBe("Private GPU cloud")
    expect(providerConnectCategoryLabel("claude-code")).toBe("CLI Provider")
    expect(providerConnectCategoryLabel("openai")).toBe("API Cloud Provider")
    expect(providerConnectCategoryLabel("ax-trust-defai-digital")).toBe("AX Trust")
  })

  test("sorts API, CLI, AX Engine, local LLMs, private GPU, then AX Trust", () => {
    expect(providerConnectCategorySortKey("openai")).toBeLessThan(providerConnectCategorySortKey("grok-build-cli"))
    expect(providerConnectCategorySortKey("grok-build-cli")).toBeLessThan(providerConnectCategorySortKey("ax-engine"))
    expect(providerConnectCategorySortKey("ax-engine")).toBeLessThan(providerConnectCategorySortKey("ollama"))
    expect(providerConnectCategorySortKey("ollama")).toBeLessThan(providerConnectCategorySortKey("nebius"))
    expect(providerConnectCategorySortKey("nebius")).toBeLessThan(
      providerConnectCategorySortKey("ax-trust-defai-digital"),
    )
  })

  test("lists only types present in a provider set, in product order", () => {
    expect(providerConnectCategoriesPresent(["openai", "ollama", "grok-build-cli"])).toEqual(["api", "cli", "local"])
    expect(defaultProviderConnectCategory(["openai", "ollama", "ax-engine"])).toBe("api")
    expect(defaultProviderConnectCategory(["ollama", "ax-engine", "grok-build-cli"])).toBe("cli")
    expect(defaultProviderConnectCategory([])).toBeUndefined()
  })

  test("filters providers by connect type", () => {
    const providers = [{ id: "ax-engine" }, { id: "ollama" }, { id: "openai" }, { id: "nebius" }]
    expect(providersInConnectCategory(providers, "ax-engine").map((item) => item.id)).toEqual(["ax-engine"])
    expect(providersInConnectCategory(providers, "local").map((item) => item.id)).toEqual(["ollama"])
    expect(providersInConnectCategory(providers, "api").map((item) => item.id)).toEqual(["openai"])
    expect(providerConnectTypeOptionDescription(1)).toBe("1 provider")
    expect(providerConnectTypeOptionDescription(3)).toBe("3 providers")
  })

  test("stays aligned with CLI definitions and private GPU presets", () => {
    expect([...CLI_PLAN_PROVIDER_IDS].sort()).toEqual(Object.keys(CLI_PROVIDER_DEFINITIONS).sort())
    expect([...DEDICATED_PRIVATE_GPU_PROVIDER_IDS].sort()).toEqual([...PRESET_DEDICATED_IDS].sort())
    expect([...CATALOG_PRIVATE_GPU_PROVIDER_IDS].sort()).toEqual(
      PRESET_CATALOG_IDS.filter((id) => id !== "huggingface").sort(),
    )
    expect(PRIVATE_GPU_CLOUD_PROVIDER_IDS).not.toContain("huggingface")
    expect([...LOCAL_LLM_PROVIDER_IDS]).toEqual(["ollama", "lmstudio", "ax-studio", "local-llm"])
    expect([...LOCAL_RUNTIME_PROVIDER_IDS]).toEqual(["ax-engine", ...LOCAL_LLM_PROVIDER_IDS])
  })
})
