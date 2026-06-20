import { describe, expect, test } from "vitest"
import {
  FOOTER_LIVENESS_FRAMES,
  footerLivenessIndicator,
  footerLivenessTextFrame,
} from "../../../src/cli/cmd/tui/component/prompt/liveness-view-model"

describe("prompt footer liveness indicator", () => {
  test("uses native spinner when runtime supports TUI animations", () => {
    expect(footerLivenessIndicator({ tick: 0, userEnabled: true, runtime: "source" })).toEqual({
      type: "native-spinner",
    })
  })

  test("uses moving text frames in compiled runtime when animations are enabled", () => {
    expect(footerLivenessIndicator({ tick: 0, userEnabled: true, runtime: "compiled" })).toEqual({
      type: "text",
      frame: FOOTER_LIVENESS_FRAMES[0],
    })
    expect(footerLivenessIndicator({ tick: 1, userEnabled: true, runtime: "compiled" })).toEqual({
      type: "text",
      frame: FOOTER_LIVENESS_FRAMES[1],
    })
  })

  test("uses static text when the user disables animations", () => {
    expect(footerLivenessIndicator({ tick: 2, userEnabled: false, runtime: "source" })).toEqual({
      type: "text",
      frame: "[...]",
    })
  })

  test("formats a safe fallback frame for native-spinner indicators", () => {
    expect(footerLivenessTextFrame({ type: "native-spinner" })).toBe("[...]")
    expect(footerLivenessTextFrame({ type: "text", frame: "[/]" })).toBe("[/]")
  })

  test("falls back to the first moving frame for invalid ticks", () => {
    expect(footerLivenessIndicator({ tick: Number.NaN, userEnabled: true, runtime: "compiled" })).toEqual({
      type: "text",
      frame: FOOTER_LIVENESS_FRAMES[0],
    })
    expect(footerLivenessIndicator({ tick: Number.POSITIVE_INFINITY, userEnabled: true, runtime: "compiled" })).toEqual(
      {
        type: "text",
        frame: FOOTER_LIVENESS_FRAMES[0],
      },
    )
  })
})
