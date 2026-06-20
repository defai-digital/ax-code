import path from "path"
import { describe, expect, test } from "vitest"

const DEBUG_WORKFLOW_PROMPTS = [
  "src/session/prompt/default.txt",
  "src/session/prompt/anthropic.txt",
  "src/session/prompt/gemini.txt",
  "src/session/prompt/beast.txt",
  "src/agent/prompt/debug.txt",
  "src/agent/prompt/react.txt",
]

const OVERCONFIDENT_FRAME_CLAIMS = [
  /every frame/i,
  /real graph symbol/i,
  /real symbol in the graph/i,
  /real symbol in the code graph/i,
  /resolved call chain/i,
]

function promptPath(relativePath: string) {
  return path.join(import.meta.dirname, "../..", relativePath)
}

describe("runtime debug prompt guidance", () => {
  for (const relativePath of DEBUG_WORKFLOW_PROMPTS) {
    test(`${relativePath} keeps debug verification explicit`, async () => {
      const text = await Bun.file(promptPath(relativePath)).text()

      for (const claim of OVERCONFIDENT_FRAME_CLAIMS) {
        expect(text).not.toMatch(claim)
      }
      expect(text).toContain("unresolved")
      expect(text).toContain("debug_plan_instrumentation")
      expect(text).toMatch(/temporary\s+instrumentation/i)
      expect(text).toContain("verify_project")
      expect(text).toContain('workflow: "debug"')
      expect(text).toContain("debug_apply_verification")
      expect(text).toMatch(/whole\s+verification set/)
    })
  }

  test("beast prompt does not call absent DRE tools mandatory", async () => {
    const text = await Bun.file(promptPath("src/session/prompt/beast.txt")).text()

    expect(text).toContain("When these tools are present in the active tool list")
    expect(text).toContain("Do not call DRE tools that are absent from the active tool list")
  })
})
