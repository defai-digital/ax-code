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
  test("skips automatic indexing when the native index addon is unavailable", () => {
    nativeIndexSpy = spyOn(NativeAddon, "index").mockReturnValue(undefined)
    countNodesSpy = spyOn(CodeGraphQuery, "countNodes").mockImplementation(() => {
      throw new Error("countNodes should not run without native auto-index support")
    })

    AutoIndex.maybeStart("proj_test" as any)

    expect(countNodesSpy).not.toHaveBeenCalled()
  })
})
