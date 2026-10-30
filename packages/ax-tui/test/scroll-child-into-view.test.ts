import { expect, test, vi } from "vitest"
import { ScrollBoxRenderable } from "../src/renderables/ScrollBox.js"

function scrollBoxWithChild(child: { x: number; y: number; width: number; height: number }) {
  const scrollBy = vi.fn()
  const instance = {
    content: { findDescendantById: () => child },
    viewport: { x: 0, y: 0, width: 10, height: 5 },
    scrollBy,
  }
  return { scrollBy, instance }
}

test("scrollChildIntoView aligns an equal-sized child sitting on the viewport edge", () => {
  const { scrollBy, instance } = scrollBoxWithChild({ x: 0, y: 5, width: 10, height: 5 })

  ScrollBoxRenderable.prototype.scrollChildIntoView.call(instance as never, "child")

  expect(scrollBy).toHaveBeenCalledWith({ x: 0, y: 5 })
})

test("scrollChildIntoView aligns a taller child by its start when its end is visible", () => {
  const { scrollBy, instance } = scrollBoxWithChild({ x: 0, y: -3, width: 10, height: 7 })

  ScrollBoxRenderable.prototype.scrollChildIntoView.call(instance as never, "child")

  expect(scrollBy).toHaveBeenCalledWith({ x: 0, y: -3 })
})

test("scrollChildIntoView leaves a fully visible child untouched", () => {
  const { scrollBy, instance } = scrollBoxWithChild({ x: 1, y: 1, width: 4, height: 2 })

  ScrollBoxRenderable.prototype.scrollChildIntoView.call(instance as never, "child")

  expect(scrollBy).not.toHaveBeenCalled()
})
