import { describe, expect, test } from "vitest"
import {
  dialogModelCatalogDescription,
  dialogModelInShortcutList,
  dialogModelOptionDisabled,
  dialogModelPickerCategory,
} from "../../../src/cli/cmd/tui/component/dialog-model-options"

function model(toolcall: boolean, options: Record<string, unknown> = {}, text = true) {
  return {
    id: "model",
    capabilities: { toolcall, output: { text } },
    options,
  }
}

describe("dialog model options", () => {
  test("disables non-toolcall models for regular providers", () => {
    expect(dialogModelOptionDisabled("groq", "text-only", model(false))).toBe(true)
    expect(dialogModelOptionDisabled("groq", "tool-model", model(true))).toBe(false)
  })

  test("keeps CLI provider non-toolcall models selectable", () => {
    expect(dialogModelOptionDisabled("qoder-cli", "qwen3-coder-next", model(false))).toBe(false)
    expect(dialogModelOptionDisabled("kimi-cli", "kimi-cli", model(false))).toBe(false)
  })

  test("disables unavailable and explicitly hidden models", () => {
    expect(dialogModelOptionDisabled("groq", "missing", undefined)).toBe(true)
    expect(dialogModelOptionDisabled("opencode", "gpt-nano", model(true))).toBe(true)
  })

  test("disables image-only models", () => {
    expect(dialogModelOptionDisabled("alibaba-token-plan", "qwen-image-2.0", model(false, {}, false))).toBe(true)
  })

  test("keeps recent and favorite models in the provider catalog", () => {
    const opus = { providerID: "anthropic", modelID: "claude-opus-5" }
    expect(dialogModelInShortcutList([opus], opus)).toBe(true)
    expect(dialogModelInShortcutList([], opus)).toBe(false)
    expect(dialogModelCatalogDescription({ recent: true })).toBe("(Recent)")
    expect(dialogModelCatalogDescription({ favorite: true, recent: true })).toBe("(Favorite)")
    expect(dialogModelCatalogDescription({ blockReason: "Not downloaded", recent: true })).toBe("Not downloaded")
  })

  test("groups the model picker by provider, not by family", () => {
    expect(
      dialogModelPickerCategory({
        providerName: "Anthropic (Claude Code)",
        connected: true,
      }),
    ).toBe("Anthropic (Claude Code)")
    expect(
      dialogModelPickerCategory({
        providerName: "Anthropic (Claude Code)",
        connected: true,
        scopedToProvider: true,
      }),
    ).toBeUndefined()
    expect(
      dialogModelPickerCategory({
        providerName: "Anthropic (Claude Code)",
        connected: false,
      }),
    ).toBeUndefined()
  })

  test("disables local models blocked by memory requirements", () => {
    expect(
      dialogModelOptionDisabled(
        "ax-engine",
        "qwen3.6-35b-a3b-4bit",
        model(true, { minMemoryBytes: Number.MAX_SAFE_INTEGER }),
      ),
    ).toBe(true)
  })
})
