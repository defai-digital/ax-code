import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const native = vi.hoisted(() => ({
  encodeUnicode: vi.fn((frame: string) => ({
    frame,
    data: Array.from(frame, (char) => ({ char, width: char === "界" ? 2 : 1 })),
  })),
  freeUnicode: vi.fn(),
}))

vi.mock("@ax-code/opentui-core", () => {
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

import { SpinnerRenderable } from "../../../../opentui-spinner/src/index"

const ctx = { widthMethod: "unicode" as const }

describe("SpinnerRenderable frame lifecycle", () => {
  beforeEach(() => {
    native.encodeUnicode.mockClear()
    native.freeUnicode.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("recomputes display width after switching named presets", () => {
    const spinner = new SpinnerRenderable(ctx as never, { name: "dots", autoplay: false })
    expect(spinner.width).toBe(1)

    spinner.name = "aesthetic"

    expect(spinner.width).toBe(7)
    expect(spinner.currentFrameIndex).toBe(0)
  })

  test("restarts a running timer with the selected preset interval", () => {
    vi.useFakeTimers()
    const spinner = new SpinnerRenderable(ctx as never, { name: "dots" })

    vi.advanceTimersByTime(160)
    expect(spinner.currentFrameIndex).toBe(2)

    spinner.name = "line"
    expect(spinner.interval).toBe(130)
    expect(spinner.currentFrameIndex).toBe(0)

    vi.advanceTimersByTime(129)
    expect(spinner.currentFrameIndex).toBe(0)
    vi.advanceTimersByTime(1)
    expect(spinner.currentFrameIndex).toBe(1)

    spinner.stop()
  })

  test("deduplicates native handles and frees each unique handle once", () => {
    const spinner = new SpinnerRenderable(ctx as never, {
      frames: ["界", "界", "x"],
      autoplay: false,
    })

    expect(spinner.width).toBe(2)
    expect(native.encodeUnicode).toHaveBeenCalledTimes(2)

    spinner.frames = ["y"]

    expect(native.freeUnicode).toHaveBeenCalledTimes(2)
    expect(spinner.currentFrameIndex).toBe(0)
  })

  test("supports custom frames that collide with Object prototype keys", () => {
    const spinner = new SpinnerRenderable(ctx as never, { name: "dots", autoplay: false })
    native.encodeUnicode.mockClear()

    spinner.frames = ["toString", "__proto__"]

    expect(spinner.name).toBeUndefined()
    expect(native.encodeUnicode).toHaveBeenCalledTimes(2)
    expect(native.encodeUnicode).toHaveBeenCalledWith("toString", "unicode")
    expect(native.encodeUnicode).toHaveBeenCalledWith("__proto__", "unicode")
    expect(spinner.width).toBe(9)
  })
})
