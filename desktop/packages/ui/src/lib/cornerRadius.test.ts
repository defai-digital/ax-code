import { describe, expect, it } from "vitest"

import {
  DEFAULT_CORNER_RADIUS,
  MAX_CORNER_RADIUS,
  applyCornerRadius,
  normalizeCornerRadius,
  resolveCornerRadiusTokens,
} from "./cornerRadius"

describe("corner radius preferences", () => {
  it("keeps the default design-system radii at the default setting", () => {
    expect(resolveCornerRadiusTokens(DEFAULT_CORNER_RADIUS)).toEqual({
      base: 10,
      sm: 4,
      md: 8,
      lg: 10,
      xl: 12,
    })
  })

  it("clamps invalid and out-of-range values", () => {
    expect(normalizeCornerRadius(Number.NaN)).toBe(DEFAULT_CORNER_RADIUS)
    expect(normalizeCornerRadius(-10)).toBe(0)
    expect(normalizeCornerRadius(99)).toBe(MAX_CORNER_RADIUS)
  })

  it("applies all radius tokens to the supplied root", () => {
    const root = document.createElement("div")
    applyCornerRadius(0, root)

    expect(root.style.getPropertyValue("--radius")).toBe("0px")
    expect(root.style.getPropertyValue("--radius-sm")).toBe("0px")
    expect(root.style.getPropertyValue("--radius-md")).toBe("0px")
    expect(root.style.getPropertyValue("--radius-lg")).toBe("0px")
    expect(root.style.getPropertyValue("--radius-xl")).toBe("0px")
  })
})
