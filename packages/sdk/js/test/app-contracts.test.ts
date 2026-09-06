import { describe, expect, test } from "vitest"
import { WorkMode } from "../src/mode"
import {
  CLI_PROVIDER_IDS,
  AX_TRUST_PROVIDER_OPTION_ID,
  providerConnectCategoriesPresent,
  providerConnectCategory,
  providerConnectCategoryLabel,
  providerConnectCategorySortKey,
  providersInConnectCategory,
} from "../src/provider-connect"

describe("application contracts", () => {
  test("routes shared work modes", () => {
    expect(WorkMode.cycle("agent")).toBe("council")
    expect(WorkMode.routeInput("council", "review auth")).toEqual({
      kind: "command",
      command: "council",
      arguments: "review auth",
    })
    expect(WorkMode.routeInput("arena", "  /help")).toEqual({ kind: "prompt", text: "/help" })
  })

  test("classifies provider connection choices", () => {
    expect(CLI_PROVIDER_IDS).toContain("grok-build-cli")
    expect(providerConnectCategory("ax-engine")).toBe("ax-engine")
    expect(providerConnectCategory("lmstudio")).toBe("local")
    expect(providerConnectCategory("local-llm")).toBe("local")
    expect(providerConnectCategory("nebius")).toBe("private-gpu")
    expect(providerConnectCategory("custom-private-gpu")).toBe("private-gpu")
    expect(providerConnectCategory("codex-cli")).toBe("cli")
    expect(providerConnectCategory("openai")).toBe("api")
    expect(providerConnectCategoryLabel("ax-engine")).toBe("AX-Engine runtime")
    expect(providerConnectCategoryLabel("ollama")).toBe("Local LLM runtime")
    expect(providerConnectCategoriesPresent(["openai", "ollama", "nebius"])).toEqual(["api", "local", "private-gpu"])
    expect(
      providerConnectCategoriesPresent([
        "openai",
        "lmstudio",
        "ax-engine",
        "nebius",
        "codex-cli",
        "ax-trust-defai-digital",
      ]),
    ).toEqual(["api", "cli", "ax-engine", "local", "private-gpu", "ax-trust"])
  })

  test("classifies saved AX Trust gateways without renaming arbitrary provider IDs", () => {
    const overrides = { "company-gateway": "ax-trust" as const }
    expect(providerConnectCategory(AX_TRUST_PROVIDER_OPTION_ID)).toBe("ax-trust")
    expect(providerConnectCategory("ax-trust-defai-digital")).toBe("ax-trust")
    expect(providerConnectCategory("ax-trustworthy")).toBe("api")
    expect(providerConnectCategory("company-gateway")).toBe("api")
    expect(providerConnectCategoryLabel("company-gateway", overrides)).toBe("AX Trust")
    expect(providerConnectCategorySortKey("company-gateway", overrides)).toBeGreaterThan(
      providerConnectCategorySortKey("runpod"),
    )
    expect(providerConnectCategoriesPresent(["company-gateway", "runpod", "openai"], overrides)).toEqual([
      "api",
      "private-gpu",
      "ax-trust",
    ])
    expect(providersInConnectCategory([{ id: "company-gateway" }, { id: "openai" }], "ax-trust", overrides)).toEqual([
      { id: "company-gateway" },
    ])
  })
})
