import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { AutoIndex } from "../../src/code-intelligence/auto-index"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { NativeAddon } from "../../src/native/addon"

let nativeIndexSpy: ReturnType<typeof spyOn> | undefined
let countNodesSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  nativeIndexSpy?.mockRestore()
  nativeIndexSpy = undefined
  countNodesSpy?.mockRestore()
  countNodesSpy = undefined
})

describe("AutoIndex.maybeStart", () => {
  test("runs with fallback concurrency when the native index addon is unavailable", () => {
    nativeIndexSpy = spyOn(NativeAddon, "index").mockReturnValue(undefined)
    countNodesSpy = spyOn(CodeGraphQuery, "countNodes").mockReturnValue(0)

    AutoIndex.maybeStart("proj_test" as any)

    expect(countNodesSpy).toHaveBeenCalled()
  })
})
