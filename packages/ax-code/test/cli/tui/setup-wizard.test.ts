import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

const WIZARD_SRC = readFileSync(
  path.resolve(import.meta.dirname, "../../../src/cli/tui/component/setup-wizard.tsx"),
  "utf8",
)

describe("setup wizard language step", () => {
  test("skipping the language step advances to the next step instead of closing", () => {
    const skipBranch = WIZARD_SRC.match(/if \(value === "skip"\) \{([\s\S]*?)\n\s*\}/)?.[1]
    expect(skipBranch).toBeDefined()
    // Same effect as choosing a language without changing it: mark the step
    // done so the wizard advances, never close the whole wizard.
    expect(skipBranch).toContain('kv.set("setup_language_done_v1", true)')
    expect(skipBranch).not.toContain("dialog.clear()")
  })

  test("the provider step renders once setup_language_done_v1 is set", () => {
    expect(WIZARD_SRC).toContain('<Show when={kv.get("setup_language_done_v1", false)}>')
  })

  test("the final step keeps its own close behavior", () => {
    // Only the final step closes the dialog; the language-step skip no longer does.
    expect((WIZARD_SRC.match(/dialog\.clear\(\)/g) ?? []).length).toBe(1)
  })
})
