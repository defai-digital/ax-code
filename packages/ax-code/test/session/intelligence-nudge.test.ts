import { describe, expect, test } from "vitest"
import { IntelligenceNudge } from "../../src/session/intelligence-nudge"

function tool(tool: string, filePath?: string) {
  return {
    type: "tool",
    tool,
    state: {
      status: "completed",
      input: filePath ? { filePath } : {},
    },
  }
}

describe("IntelligenceNudge.evaluate", () => {
  test("inactive for single-file or no mutations", () => {
    expect(IntelligenceNudge.evaluate([{ info: { role: "assistant" }, parts: [tool("edit", "a.ts")] }]).active).toBe(
      false,
    )
    expect(IntelligenceNudge.evaluate([{ info: { role: "assistant" }, parts: [tool("read")] }]).active).toBe(false)
  })

  test("active for multi-file mutations with impact guidance", () => {
    const decision = IntelligenceNudge.evaluate([
      {
        info: { role: "assistant" },
        parts: [tool("edit", "a.ts"), tool("write", "b.ts")],
      },
    ])
    expect(decision.active).toBe(true)
    if (!decision.active) throw new Error("expected active")
    expect(decision.mutatedFiles).toBe(2)
    expect(decision.text).toContain("impact_analyze")
    expect(decision.text).toContain("semantic-diff")
  })
})
