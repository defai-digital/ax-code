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
  test("classifies local, private GPU, CLI, and API providers", () => {
    expect(providerConnectCategory("ax-engine")).toBe("local")
    expect(providerConnectCategory("ollama")).toBe("local")
    expect(providerConnectCategory("alibaba-pai")).toBe("private-gpu")
    expect(providerConnectCategory("nebius")).toBe("private-gpu")
    expect(providerConnectCategory("grok-build-cli")).toBe("cli")
    expect(providerConnectCategory("xai")).toBe("api")
    expect(providerConnectCategory("huggingface")).toBe("api")
    expect(providerConnectCategory("huggingface-endpoints")).toBe("private-gpu")
  })

  test("uses the same labels as the connect dialog", () => {
    expect(providerConnectCategoryLabel("ollama")).toBe("Local runtime")
    expect(providerConnectCategoryLabel("runpod")).toBe("Private GPU cloud")
    expect(providerConnectCategoryLabel("claude-code")).toBe("CLI plan")
    expect(providerConnectCategoryLabel("openai")).toBe("API plan")
  })

  test("sorts local, then private GPU, then CLI, then API", () => {
    expect(providerConnectCategorySortKey("ax-engine")).toBeLessThan(providerConnectCategorySortKey("nebius"))
    expect(providerConnectCategorySortKey("nebius")).toBeLessThan(providerConnectCategorySortKey("grok-build-cli"))
    expect(providerConnectCategorySortKey("grok-build-cli")).toBeLessThan(providerConnectCategorySortKey("openai"))
  })

  test("lists only types present in a provider set, in product order", () => {
    expect(providerConnectCategoriesPresent(["openai", "ollama", "grok-build-cli"])).toEqual(["local", "cli", "api"])
    expect(defaultProviderConnectCategory(["openai", "ollama"])).toBe("local")
    expect(defaultProviderConnectCategory([])).toBeUndefined()
  })

  test("filters providers by connect type", () => {
    const providers = [{ id: "ollama" }, { id: "openai" }, { id: "nebius" }]
    expect(providersInConnectCategory(providers, "local").map((item) => item.id)).toEqual(["ollama"])
    expect(providersInConnectCategory(providers, "api").map((item) => item.id)).toEqual(["openai"])
    expect(providerConnectTypeOptionDescription("api", 1)).toBe("1 provider · Hosted API key")
    expect(providerConnectTypeOptionDescription("cli", 3)).toBe("3 providers · Installed CLI subscription")
  })

  test("stays aligned with CLI definitions and private GPU presets", () => {
    expect([...CLI_PLAN_PROVIDER_IDS].sort()).toEqual(Object.keys(CLI_PROVIDER_DEFINITIONS).sort())
    expect([...DEDICATED_PRIVATE_GPU_PROVIDER_IDS].sort()).toEqual([...PRESET_DEDICATED_IDS].sort())
    expect([...CATALOG_PRIVATE_GPU_PROVIDER_IDS].sort()).toEqual(
      PRESET_CATALOG_IDS.filter((id) => id !== "huggingface").sort(),
    )
    expect(PRIVATE_GPU_CLOUD_PROVIDER_IDS).not.toContain("huggingface")
    expect([...LOCAL_RUNTIME_PROVIDER_IDS]).toEqual(["ax-engine", "ax-studio", "ollama"])
  })
})
