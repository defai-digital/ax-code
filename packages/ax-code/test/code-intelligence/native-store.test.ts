import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { NativeAddon } from "../../src/native/addon"

const nativeStoreModule = "../../src/code-intelligence/native-store.ts" + "?native-store-unit"
const { NativeStore } = (await import(nativeStoreModule)) as typeof import("../../src/code-intelligence/native-store")
let nativeIndexSpy: ReturnType<typeof spyOn<typeof NativeAddon, "index">> | undefined

afterEach(() => {
  nativeIndexSpy?.mockRestore()
  nativeIndexSpy = undefined
})

describe("code-intelligence.native-store", () => {
  test("parseNativeStoreJson decodes valid native JSON", () => {
    expect(
      NativeStore.parseNativeStoreJson<Array<{ id: string }>>(`  ${JSON.stringify([{ id: "node-1" }])}\n`, []),
    ).toEqual([{ id: "node-1" }])
  })

  test("parseNativeStoreJson returns fallback for malformed native JSON", () => {
    const fallback = [{ id: "fallback" }]
    expect(NativeStore.parseNativeStoreJson("{not json", fallback)).toBe(fallback)
    expect(NativeStore.parseNativeStoreJson("", fallback)).toBe(fallback)
  })

  test("close swallows unprintable native close failures", async () => {
    const closeFailure = {
      toString() {
        throw new Error("cannot print")
      },
    }
    class TestIndexStore {
      insertNodes() {}
      close() {
        throw closeFailure
      }
    }
    nativeIndexSpy = spyOn(NativeAddon, "index")
    nativeIndexSpy.mockReturnValue({
      IndexStore: TestIndexStore,
    } as unknown as ReturnType<typeof NativeAddon.index>)

    const isolatedModule = "../../src/code-intelligence/native-store.ts" + "?native-store-close-unprintable"
    const { NativeStore: IsolatedNativeStore } = (await import(isolatedModule)) as typeof import(
      "../../src/code-intelligence/native-store"
    )

    IsolatedNativeStore.insertNodes([])

    expect(() => IsolatedNativeStore.close()).not.toThrow()
  })
})
