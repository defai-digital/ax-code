import { describe, expect, test } from "bun:test"

const nativeStoreModule = "../../src/code-intelligence/native-store.ts" + "?native-store-unit"
const { NativeStore } = (await import(nativeStoreModule)) as typeof import("../../src/code-intelligence/native-store")

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
})
