import { describe, expect, test } from "vitest"
import { ensureJsonModeInstruction, messagesContainJsonWord } from "../../src/mode/json-mode-prompt"

describe("json-mode-prompt", () => {
  test("detects the word json case-insensitively", () => {
    expect(messagesContainJsonWord(["return JSON please"])).toBe(true)
    expect(messagesContainJsonWord(["json_object"])).toBe(false)
    expect(messagesContainJsonWord(["structured output only"])).toBe(false)
  })

  test("appends a json instruction when missing", () => {
    const out = ensureJsonModeInstruction("Return structured issues.")
    expect(out).toContain("json")
    expect(out).toMatch(/\bjson\b/)
    expect(out.startsWith("Return structured issues.")).toBe(true)
  })

  test("is idempotent when json is already present", () => {
    const base = "Respond using JSON matching the schema."
    expect(ensureJsonModeInstruction(base)).toBe(base)
  })
})
