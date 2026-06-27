import { describe, expect, test } from "vitest"
import { dialogModelOptionDisabled } from "../../../src/cli/cmd/tui/component/dialog-model-options"

function model(toolcall: boolean, options: Record<string, unknown> = {}) {
  return {
    id: "model",
    capabilities: { toolcall },
    options,
  }
}

describe("dialog model options", () => {
  test("disables non-toolcall models for regular providers", () => {
    expect(dialogModelOptionDisabled("xai", "text-only", model(false))).toBe(true)
    expect(dialogModelOptionDisabled("xai", "tool-model", model(true))).toBe(false)
  })

  test("keeps CLI provider non-toolcall models selectable", () => {
    expect(dialogModelOptionDisabled("qoder-cli", "qwen3-coder-next", model(false))).toBe(false)
    expect(dialogModelOptionDisabled("antigravity-cli", "default", model(false))).toBe(false)
  })

  test("disables unavailable and explicitly hidden models", () => {
    expect(dialogModelOptionDisabled("xai", "missing", undefined)).toBe(true)
    expect(dialogModelOptionDisabled("opencode", "gpt-nano", model(true))).toBe(true)
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
