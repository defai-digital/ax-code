import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { createColors } from "../../src/cli/cmd/tui/ui/spinner"

describe("tui spinner", () => {
  test("restarts the bidirectional fade cycle after a full loop", () => {
    const spinner = createColors({
      width: 4,
      holdStart: 2,
      holdEnd: 1,
      colors: [RGBA.fromHex("#ffffff"), RGBA.fromHex("#cccccc")],
      defaultColor: RGBA.fromValues(0, 0, 0, 1),
      enableFading: true,
      minAlpha: 0.2,
    })

    const cycleLength = 4 + 1 + 3 + 2
    const firstFrame = spinner(0, 0, cycleLength, 4) as RGBA
    const wrappedFrame = spinner(cycleLength, 0, cycleLength, 4) as RGBA

    expect(wrappedFrame.a).toBe(firstFrame.a)
  })

  test("does not mutate a shared RGBA default color", () => {
    const shared = RGBA.fromValues(0, 0, 0, 0.75)
    const spinner = createColors({
      width: 4,
      holdStart: 2,
      holdEnd: 1,
      colors: [RGBA.fromHex("#ffffff")],
      defaultColor: shared,
    })

    spinner(3, 3, 0, 4)
    expect(shared.a).toBe(0.75)
  })

  test("accepts numeric default colors", () => {
    const spinner = createColors({
      width: 1,
      holdStart: 1,
      holdEnd: 1,
      colors: [RGBA.fromHex("#ffffff")],
      defaultColor: 0xff0000 as any,
    })

    expect(() => spinner(0, 0, 0, 1)).not.toThrow()
  })
})
