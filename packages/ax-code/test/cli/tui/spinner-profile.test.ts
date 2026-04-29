import { describe, expect, test } from "bun:test"
import { shouldUseTuiAnimations } from "../../../src/cli/cmd/tui/component/spinner-profile"

describe("TUI spinner profile", () => {
  test("disables animated OpenTUI spinners in compiled runtime", () => {
    expect(shouldUseTuiAnimations({ userEnabled: true, runtime: "compiled" })).toBe(false)
  })

  test("preserves animated spinners outside compiled runtime when enabled", () => {
    expect(shouldUseTuiAnimations({ userEnabled: true, runtime: "source" })).toBe(true)
    expect(shouldUseTuiAnimations({ userEnabled: true, runtime: "bun-bundled" })).toBe(true)
  })

  test("honors the user animation preference in every runtime", () => {
    expect(shouldUseTuiAnimations({ userEnabled: false, runtime: "source" })).toBe(false)
    expect(shouldUseTuiAnimations({ userEnabled: false, runtime: "compiled" })).toBe(false)
  })
})
