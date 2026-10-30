import { expect, test, vi } from "vitest"
import { EditBufferRenderable } from "../src/renderables/EditBufferRenderable.js"

type CursorStyleState = {
  _cursorStyle: unknown
  _focused: boolean
  requestRender: () => void
}

function setCursorStyle(instance: CursorStyleState, style: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(EditBufferRenderable.prototype, "cursorStyle")
  if (!descriptor?.set) throw new Error("cursorStyle setter is missing")
  descriptor.set.call(instance, style)
}

test("cursorStyle updates color and cursor when style/blinking are unchanged", () => {
  const requestRender = vi.fn()
  const current = { style: "block", blinking: true, color: { r: 1 }, cursor: "default" }
  const next = { style: "block", blinking: true, color: { r: 0 }, cursor: "pointer" }
  const instance: CursorStyleState = { _cursorStyle: current, _focused: true, requestRender }

  setCursorStyle(instance, next)

  expect(instance._cursorStyle).toBe(next)
  expect(requestRender).toHaveBeenCalledTimes(1)
})

test("cursorStyle keeps the old object when every field is unchanged", () => {
  const requestRender = vi.fn()
  const current = { style: "block", blinking: true }
  const instance: CursorStyleState = { _cursorStyle: current, _focused: true, requestRender }

  setCursorStyle(instance, { style: "block", blinking: true })

  expect(instance._cursorStyle).toBe(current)
  expect(requestRender).not.toHaveBeenCalled()
})

test("cursorStyle updates state without rendering while unfocused", () => {
  const requestRender = vi.fn()
  const current = { style: "block", blinking: true, cursor: "default" }
  const next = { style: "block", blinking: true, cursor: "text" }
  const instance: CursorStyleState = { _cursorStyle: current, _focused: false, requestRender }

  setCursorStyle(instance, next)

  expect(instance._cursorStyle).toBe(next)
  expect(requestRender).not.toHaveBeenCalled()
})
