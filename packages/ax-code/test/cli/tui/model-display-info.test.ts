import { describe, expect, test } from "vitest"
import { modelDisplayInfo, supportsWebSearch } from "../../../src/cli/cmd/tui/component/model-vision-label"

describe("modelDisplayInfo", () => {
  test("adds web search marker for CLI providers with built-in web search", () => {
    for (const providerID of [
      "claude-code",
      "codex-cli",
      "gemini-cli",
      "grok-build-cli",
      "qoder-cli",
      "antigravity-cli",
    ]) {
      const display = modelDisplayInfo(providerID, {
        providerID,
        name: providerID,
        capabilities: { input: { image: false } },
      })

      expect(display.label).toContain("🌐")
      expect(display.webSearch).toBe(true)
    }
  })

  test("shows vision marker for CLI providers with image input", () => {
    for (const providerID of ["claude-code", "codex-cli", "gemini-cli", "grok-build-cli", "qoder-cli"]) {
      const display = modelDisplayInfo(providerID, {
        providerID,
        name: `${providerID} default`,
        capabilities: { input: { image: true } },
      })

      expect(display.label).toContain("👀")
      expect(display.vision).toBe(true)
    }
  })

  test("does not duplicate markers already present in the model name", () => {
    const display = modelDisplayInfo("claude-code", {
      providerID: "claude-code",
      name: "Claude Code default 🌐",
      capabilities: { input: { image: true } },
    })

    expect(display.label).toBe("Claude Code default 👀 🌐")
    expect(display.searchText).toBe("Claude Code default")
  })

  test("marks server-side live search models", () => {
    expect(
      supportsWebSearch({
        providerID: "xai",
        api: { id: "grok-4.3", npm: "@ai-sdk/xai" },
      }),
    ).toBe(true)
    expect(
      supportsWebSearch({
        providerID: "alibaba-coding-plan",
        api: { id: "qwen3-coder-plus", npm: "@ai-sdk/openai-compatible" },
      }),
    ).toBe(true)
  })

  test("does not mark models without direct web search support", () => {
    const display = modelDisplayInfo("plain", {
      providerID: "plain",
      name: "Plain Model",
      capabilities: { input: { image: false } },
    })

    expect(display.label).toBe("Plain Model")
    expect(display.webSearch).toBe(false)
  })
})
