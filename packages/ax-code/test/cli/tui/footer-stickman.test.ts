import { describe, expect, test } from "vitest"
import { FOOTER_STICKMAN_FRAMES, FOOTER_STICKMAN_INTERVAL_MS } from "../../../src/cli/cmd/tui/component/footer-stickman"

describe("footer stickman indicator", () => {
  test("steps a 5x8 matchstick man through walk/punch/kick poses", () => {
    // A braille cell is 2x4: 5 columns become 3 cells, 8 rows become 2 lines.
    expect(FOOTER_STICKMAN_FRAMES).toHaveLength(6)
    for (const frame of FOOTER_STICKMAN_FRAMES) {
      expect([...frame.top]).toHaveLength(3)
      expect([...frame.bottom]).toHaveLength(3)
    }

    // Two walk poses (repeated for a two-step cycle) plus a punch and a kick.
    const distinct = new Set(FOOTER_STICKMAN_FRAMES.map((frame) => `${frame.top}\n${frame.bottom}`))
    expect(distinct.size).toBe(4)

    // First walk pose, then the punch and kick poses that end the loop.
    expect(FOOTER_STICKMAN_FRAMES[0]).toEqual({ top: "⢘⡟⡀", bottom: "⣀⠧⠀" })
    expect(FOOTER_STICKMAN_FRAMES[4]).toEqual({ top: "⢘⢟⡀", bottom: "⡠⠣⡀" })
    expect(FOOTER_STICKMAN_FRAMES[5]).toEqual({ top: "⢘⢟⠀", bottom: "⡰⢃⡀" })

    expect(Number.isFinite(FOOTER_STICKMAN_INTERVAL_MS)).toBe(true)
    expect(FOOTER_STICKMAN_INTERVAL_MS).toBeGreaterThan(0)
  })
})
