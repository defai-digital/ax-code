import { afterEach, describe, expect, test, vi } from "vitest"

const native = vi.hoisted(() => ({
  encodeUnicode: vi.fn((frame: string) => ({
    frame,
    data: Array.from(frame, (char) => ({ char, width: char === "界" ? 2 : 1 })),
  })),
  freeUnicode: vi.fn(),
}))

vi.mock("@defai-digital/ax-tui", () => {
  class Renderable {
    ctx: { widthMethod: "unicode" | "wcwidth" }
    width = 0
    height = 0
    visible = true
    x = 0
    y = 0

    constructor(ctx: { widthMethod: "unicode" | "wcwidth" }) {
      this.ctx = ctx
    }

    requestRender() {}
    protected destroySelf() {}
  }

  return {
    Renderable,
    parseColor: (value: unknown) => value,
    resolveRenderLib: () => native,
  }
})

import { SpinnerRenderable } from "../spinner/src/index"

const ctx = { widthMethod: "unicode" as const }

describe("SpinnerRenderable frames getter must not expose the live frame array", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test("mutating the returned array leaves the internal frames untouched", () => {
    const spinner = new SpinnerRenderable(ctx as never, { frames: ["a", "b"], autoplay: false })
    const exposed = spinner.frames
    exposed.push("zzz")
    exposed[0] = "mutated"
    expect(spinner.frames).toEqual(["a", "b"])
  })

  test("emptying the returned array cannot corrupt the running frame index", () => {
    vi.useFakeTimers()
    const spinner = new SpinnerRenderable(ctx as never, { frames: ["a", "b"], interval: 50, autoplay: true })
    spinner.frames.length = 0
    vi.advanceTimersByTime(150)
    expect(Number.isInteger(spinner.currentFrameIndex)).toBe(true)
    expect(spinner.currentFrameIndex).toBeGreaterThanOrEqual(0)
    expect(spinner.currentFrameIndex).toBeLessThan(2)
    spinner.stop()
  })
})
