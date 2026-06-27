import { describe, expect, test, vi } from "vitest"
import {
  blurRenderable,
  findRenderableChild,
  focusRenderable,
  isRenderableAlive,
  renderableChildren,
} from "../../../src/cli/cmd/tui/util/renderable-safety"

describe("tui renderable safety", () => {
  test("treats missing and destroyed renderables as unavailable", () => {
    expect(isRenderableAlive(undefined)).toBe(false)
    expect(isRenderableAlive(null)).toBe(false)
    expect(isRenderableAlive({ isDestroyed: true })).toBe(false)
    expect(isRenderableAlive({ isDestroyed: false })).toBe(true)
    expect(isRenderableAlive({})).toBe(true)
  })

  test("does not focus or blur destroyed renderables", () => {
    const focus = vi.fn()
    const blur = vi.fn()
    const renderable = { isDestroyed: true, focus, blur }

    expect(focusRenderable(renderable, { name: "destroyed-focus" })).toBe(false)
    expect(blurRenderable(renderable, { name: "destroyed-blur" })).toBe(false)

    expect(focus).not.toHaveBeenCalled()
    expect(blur).not.toHaveBeenCalled()
  })

  test("reports focus and blur failures without throwing", () => {
    const logger = { warn: vi.fn() }
    const focusError = new Error("focus failed")
    const blurError = new Error("blur failed")

    expect(
      focusRenderable(
        {
          id: "renderable-1",
          focus() {
            throw focusError
          },
        },
        { name: "focus", logger },
      ),
    ).toBe(false)

    expect(
      blurRenderable(
        {
          id: "renderable-2",
          blur() {
            throw blurError
          },
        },
        { name: "blur", logger },
      ),
    ).toBe(false)

    expect(logger.warn).toHaveBeenCalledWith("tui renderable focus failed", {
      safetyName: "focus",
      error: focusError,
      renderableID: "renderable-1",
    })
    expect(logger.warn).toHaveBeenCalledWith("tui renderable blur failed", {
      safetyName: "blur",
      error: blurError,
      renderableID: "renderable-2",
    })
  })

  test("returns only live children and catches getChildren failures", () => {
    const logger = { warn: vi.fn() }
    const liveChild = { id: "live" }
    const destroyedChild = { id: "destroyed", isDestroyed: true }

    expect(
      renderableChildren(
        {
          id: "parent",
          getChildren: () => [liveChild, destroyedChild],
        },
        { name: "children", logger },
      ),
    ).toEqual([liveChild])

    expect(
      findRenderableChild(
        {
          getChildren: () => [liveChild],
        },
        (child) => child.id === "live",
        { name: "find-child", logger },
      ),
    ).toBe(liveChild)

    const error = new Error("children failed")
    expect(
      renderableChildren(
        {
          id: "broken-parent",
          getChildren() {
            throw error
          },
        },
        { name: "broken-children", logger },
      ),
    ).toEqual([])

    expect(logger.warn).toHaveBeenCalledWith("tui renderable children lookup failed", {
      safetyName: "broken-children",
      error,
      renderableID: "broken-parent",
    })
  })
})
