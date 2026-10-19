import { describe, expect, test } from "vitest"
import { TuiInfo } from "../../../src/config/tui-schema"

describe("tui.json screen option", () => {
  test("accepts every supported value", () => {
    for (const screen of ["auto", "full", "inline"]) {
      const parsed = TuiInfo.safeParse({ screen })
      expect(parsed.success).toBe(true)
      if (parsed.success) expect(parsed.data.screen).toBe(screen)
    }
  })

  test("is optional", () => {
    const parsed = TuiInfo.safeParse({})
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.screen).toBeUndefined()
  })

  test("rejects unknown values and wrong types", () => {
    for (const screen of ["split-footer", "Inline", "", "auto ", "sideways", 1, true, null, {}]) {
      expect(TuiInfo.safeParse({ screen }).success).toBe(false)
    }
  })

  test("stays strict alongside the other tui options", () => {
    expect(TuiInfo.safeParse({ screen: "inline", theme: "dark", mouse: false }).success).toBe(true)
    expect(TuiInfo.safeParse({ screen: "inline", bogus_option: 1 }).success).toBe(false)
  })
})
