import { describe, expect, test } from "bun:test"

import { parseIntegerEnv } from "../../../src/cli/cmd/tui/util/env"

describe("tui env utilities", () => {
  test("parses decimal integer environment values", () => {
    expect(parseIntegerEnv({ env: { VALUE: "25" }, name: "VALUE", fallback: 750, min: 0 })).toBe(25)
    expect(parseIntegerEnv({ env: { VALUE: " 25 " }, name: "VALUE", fallback: 750, min: 0 })).toBe(25)
  })

  test("rejects non-decimal integer environment values", () => {
    for (const value of ["1e3", "0x10", "12.5", "Infinity", "9007199254740993"]) {
      expect(parseIntegerEnv({ env: { VALUE: value }, name: "VALUE", fallback: 750, min: 0 })).toBe(750)
    }
  })

  test("rejects values below the configured minimum", () => {
    expect(parseIntegerEnv({ env: { VALUE: "-1" }, name: "VALUE", fallback: 750, min: 0 })).toBe(750)
  })
})
