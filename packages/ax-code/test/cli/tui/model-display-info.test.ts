import { describe, expect, test } from "vitest"
import { modelDisplayInfo, supportsWebSearch } from "../../../src/cli/tui/component/model-vision-label"

describe("modelDisplayInfo", () => {
  test("adds web search marker for CLI providers with built-in web search", () => {
    for (const providerID of [
      "claude-code",
      "codex-cli",
      "grok-build-cli",
      "muse-cli",
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
    for (const providerID of ["claude-code", "codex-cli", "grok-build-cli"]) {
      const display = modelDisplayInfo(providerID, {
        providerID,
        name: `${providerID} default`,
        capabilities: { input: { image: true } },
      })

      expect(display.label).toContain("👀")
      expect(display.vision).toBe(true)
    }
  })

  test("does not advertise web search for retired CLI providers", () => {
    expect(supportsWebSearch({ providerID: "gemini-cli" })).toBe(false)
    expect(supportsWebSearch({ providerID: "qoder-cli" })).toBe(false)
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

  test("marks Alibaba server-side search models", () => {
    expect(
      supportsWebSearch({
        providerID: "alibaba-coding-plan",
        api: { id: "qwen3-coder-plus", npm: "@ai-sdk/openai-compatible" },
      }),
    ).toBe(true)
  })

  test("marks a non-CLI gateway model whose provider declares web search", () => {
    const display = modelDisplayInfo("defai-01-ax-trust-com/glm-5.3", {
      id: "glm-5.3",
      providerID: "defai-01-ax-trust-com",
      api: { id: "glm-5.3", npm: "@ai-sdk/openai-compatible" },
      name: "GLM 5.3",
      capabilities: { input: { image: false }, websearch: true },
    })

    expect(display.label).toBe("GLM 5.3 🌐")
    expect(display.webSearch).toBe(true)
  })

  test("does not mark the same gateway model when web search is absent or false", () => {
    const absent = modelDisplayInfo("defai-01-ax-trust-com/glm-5.3", {
      id: "glm-5.3",
      providerID: "defai-01-ax-trust-com",
      api: { id: "glm-5.3", npm: "@ai-sdk/openai-compatible" },
      name: "GLM 5.3",
      capabilities: { input: { image: false } },
    })
    expect(absent.label).toBe("GLM 5.3")
    expect(absent.webSearch).toBe(false)
    expect(supportsWebSearch({ providerID: "defai-01-ax-trust-com", capabilities: { websearch: false } })).toBe(false)
  })

  test("keeps marking CLI models when the snapshot declares no search flag", () => {
    // The bundled snapshot sets websearch:false on every model, so a false
    // declaration must stay additive-only and never veto the allowlist.
    expect(supportsWebSearch({ providerID: "claude-code", capabilities: { websearch: false } })).toBe(true)
    expect(supportsWebSearch({ providerID: "codex-cli", capabilities: { websearch: false } })).toBe(true)
    expect(supportsWebSearch({ providerID: "grok-build-cli" })).toBe(true)
    expect(supportsWebSearch({ providerID: "muse-cli", capabilities: { websearch: false } })).toBe(true)
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
