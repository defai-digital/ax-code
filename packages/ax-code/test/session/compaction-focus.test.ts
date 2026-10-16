import { describe, expect, test } from "vitest"
import { SessionCompaction } from "../../src/session/compaction"

const { COMPACTION_FOCUS_MAX_CHARS, buildCompactionPrompt, renderCompactionFocus } = SessionCompaction

describe("renderCompactionFocus", () => {
  test("quotes the user focus as data, not an instruction channel", () => {
    const text = renderCompactionFocus("keep the API migration notes")
    expect(text).toContain("Prioritise preserving details relevant to")
    expect(text).toContain('"keep the API migration notes"')
  })

  test("trims and caps the focus at the ADR-215 limit", () => {
    const padded = `  ${"a".repeat(COMPACTION_FOCUS_MAX_CHARS + 50)}  `
    const text = renderCompactionFocus(padded)
    expect(text).toContain(`"${"a".repeat(COMPACTION_FOCUS_MAX_CHARS)}"`)
  })

  test("escapes embedded double quotes so the quoted block stays one string", () => {
    expect(renderCompactionFocus('say "hi"')).toContain('\\"hi\\"')
  })

  test("empty focus renders nothing", () => {
    expect(renderCompactionFocus("   ")).toBe("")
  })
})

describe("buildCompactionPrompt", () => {
  const defaultPrompt = "Provide a detailed prompt for continuing our conversation above."
  const context = ["plugin context line"]

  test("omitted focus is byte-identical to the pre-ADR-215 prompt", () => {
    const before = [defaultPrompt, ...context].join("\n\n")
    expect(buildCompactionPrompt({ defaultPrompt, context })).toBe(before)
    expect(buildCompactionPrompt({ defaultPrompt, context, focus: undefined })).toBe(before)
  })

  test("focus is inserted between the default prompt and plugin context", () => {
    const prompt = buildCompactionPrompt({ defaultPrompt, context, focus: "keep error traces" })
    expect(prompt).toBe([defaultPrompt, renderCompactionFocus("keep error traces"), ...context].join("\n\n"))
  })

  test("a plugin prompt fully replaces the default; focus does not leak into it", () => {
    const pluginPrompt = "custom compaction instructions"
    expect(buildCompactionPrompt({ pluginPrompt, defaultPrompt, context, focus: "ignored" })).toBe(pluginPrompt)
  })
})
