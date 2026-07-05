import { describe, expect, it } from "vitest"

import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  MAX_TERMINAL_DIMENSION,
  parseTerminalDimension,
  resolveTerminalDimensions,
} from "./terminal-dimensions.js"

describe("terminal dimensions", () => {
  it("uses default dimensions when create/restart payload omits size", () => {
    expect(resolveTerminalDimensions({})).toEqual({
      ok: true,
      cols: DEFAULT_TERMINAL_COLS,
      rows: DEFAULT_TERMINAL_ROWS,
    })
  })

  it("accepts integer numbers and integer strings", () => {
    expect(resolveTerminalDimensions({ cols: 120, rows: " 30 " })).toEqual({
      ok: true,
      cols: 120,
      rows: 30,
    })
  })

  it("requires both dimensions for resize payloads", () => {
    expect(resolveTerminalDimensions({ cols: 80 }, { requireBoth: true })).toEqual({
      ok: false,
      error: "cols and rows are required",
    })
  })

  it("rejects non-integer, zero, negative, blank, and excessive dimensions", () => {
    expect(parseTerminalDimension(80.5, "cols")).toEqual({ ok: false, error: "cols must be an integer" })
    expect(parseTerminalDimension(" ", "rows")).toEqual({ ok: false, error: "rows must be an integer" })
    expect(parseTerminalDimension(0, "cols")).toEqual({
      ok: false,
      error: `cols must be between 1 and ${MAX_TERMINAL_DIMENSION}`,
    })
    expect(parseTerminalDimension(-1, "rows")).toEqual({
      ok: false,
      error: `rows must be between 1 and ${MAX_TERMINAL_DIMENSION}`,
    })
    expect(parseTerminalDimension(MAX_TERMINAL_DIMENSION + 1, "cols")).toEqual({
      ok: false,
      error: `cols must be between 1 and ${MAX_TERMINAL_DIMENSION}`,
    })
  })
})
