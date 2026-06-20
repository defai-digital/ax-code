import { describe, expect, test } from "vitest"
import { decodeCliJsonObject, parseCliJsonObject } from "../../../src/provider/cli/json"

describe("provider CLI JSON decoding", () => {
  test("decodeCliJsonObject decodes already-parsed objects", () => {
    expect(decodeCliJsonObject({ type: "result", result: "OK" })).toEqual({
      type: "result",
      result: "OK",
    })
    expect(decodeCliJsonObject(["not", "object"])).toBeUndefined()
    expect(decodeCliJsonObject(null)).toBeUndefined()
  })

  test("parseCliJsonObject parses raw JSON before object decoding", () => {
    expect(parseCliJsonObject(JSON.stringify({ type: "result", result: "OK" }))).toEqual({
      type: "result",
      result: "OK",
    })
    expect(parseCliJsonObject("[]")).toBeUndefined()
    expect(parseCliJsonObject("{not json")).toBeUndefined()
  })
})
