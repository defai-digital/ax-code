import { describe, expect, test } from "bun:test"
import z from "zod"
import { decodeNativeJsonValue, parseNativeJson, parseNativeJsonArray } from "../../src/util/native-json"

describe("util.native-json", () => {
  const Item = z.object({
    path: z.string(),
  })

  test("decodes already-parsed native JSON values with the caller schema", () => {
    expect(decodeNativeJsonValue({ path: "src/app.ts" }, Item, "Invalid native item")).toEqual({
      path: "src/app.ts",
    })
    expect(() => decodeNativeJsonValue({ path: 1 }, Item, "Invalid native item")).toThrow("Invalid native item")
  })

  test("parses raw native JSON before schema decoding", () => {
    expect(parseNativeJson(JSON.stringify({ path: "src/app.ts" }), Item, "Invalid native item")).toEqual({
      path: "src/app.ts",
    })
    expect(() => parseNativeJson("{not json", Item, "Invalid native item")).toThrow(SyntaxError)
  })

  test("parses native JSON arrays with item schemas", () => {
    expect(
      parseNativeJsonArray(JSON.stringify([{ path: "a.ts" }, { path: "b.ts" }]), Item, "Invalid native items"),
    ).toEqual([{ path: "a.ts" }, { path: "b.ts" }])
    expect(() => parseNativeJsonArray(JSON.stringify([{ path: 1 }]), Item, "Invalid native items")).toThrow(
      "Invalid native items",
    )
  })
})
