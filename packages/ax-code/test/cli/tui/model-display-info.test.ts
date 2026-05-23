import { describe, expect, test } from "bun:test"
import { modelDisplayInfo, supportsWebSearch } from "../../../src/cli/cmd/tui/component/model-vision-label"

describe("modelDisplayInfo", () => {
  test("adds web search marker for CLI providers with built-in web search", () => {
    for (const providerID of ["claude-code", "codex-cli", "gemini-cli"]) {
      const display = modelDisplayInfo(providerID, {
        providerID,
        name: providerID,
        capabilities: { input: { image: false } },
      })

      expect(display.label).toContain("🌐")
      expect(display.webSearch).toBe(true)
    }
  })

  test("preserves vision marker alongside web search marker", () => {
    const display = modelDisplayInfo("claude-code", {
      providerID: "claude-code",
      name: "Claude Code default",
      capabilities: { input: { image: true } },
    })

    expect(display.label).toBe("Claude Code default 👀 🌐")
    expect(display.vision).toBe(true)
    expect(display.webSearch).toBe(true)
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
