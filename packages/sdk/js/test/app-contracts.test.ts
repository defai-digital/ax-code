import { describe, expect, test } from "vitest"
import { WorkMode } from "../src/mode"
import {
  CLI_PROVIDER_IDS,
  providerConnectCategoriesPresent,
  providerConnectCategory,
  providerConnectCategoryLabel,
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
    expect(providerConnectCategory("ax-engine")).toBe("local")
    expect(providerConnectCategory("nebius")).toBe("private-gpu")
    expect(providerConnectCategory("codex-cli")).toBe("cli")
    expect(providerConnectCategory("openai")).toBe("api")
    expect(providerConnectCategoryLabel("ollama")).toBe("Local runtime")
    expect(providerConnectCategoriesPresent(["openai", "ollama", "nebius"])).toEqual(["local", "private-gpu", "api"])
  })
})
