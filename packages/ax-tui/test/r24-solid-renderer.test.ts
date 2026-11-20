import { expect, test } from "vitest"
import { onCleanup } from "solid-js"
import { createRenderer } from "../solid/source/src/renderer/universal"

test("render() disposes the root owner when the initial render throws", () => {
  // The element is never touched when code() throws before insert, so the
  // renderer options can stay stubbed for this path.
  const renderer = createRenderer({} as never)
  let cleaned = false
  expect(() =>
    renderer.render(() => {
      onCleanup(() => {
        cleaned = true
      })
      throw new Error("boom")
    }, {} as never),
  ).toThrow("boom")
  expect(cleaned).toBe(true)
})

test("a throwing cleanup during dispose does not mask the original render error", () => {
  const renderer = createRenderer({} as never)
  expect(() =>
    renderer.render(() => {
      onCleanup(() => {
        throw new Error("cleanup boom")
      })
      throw new Error("original boom")
    }, {} as never),
  ).toThrow("original boom")
})
