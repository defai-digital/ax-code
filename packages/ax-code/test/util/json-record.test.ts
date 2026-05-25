import { describe, expect, test } from "bun:test"
import { decodeJsonRecord, parseJsonRecord } from "../../src/util/json-record"

describe("util.json-record", () => {
  test("decodes already-parsed record values", () => {
    expect(decodeJsonRecord({ type: "error" })).toEqual({ type: "error" })
    expect(decodeJsonRecord(null)).toBeUndefined()
    expect(decodeJsonRecord([])).toBeUndefined()
  })

  test("parses JSON strings before record decoding", () => {
    expect(parseJsonRecord(JSON.stringify({ type: "error" }))).toEqual({ type: "error" })
    expect(parseJsonRecord({ type: "error" })).toEqual({ type: "error" })
    expect(parseJsonRecord("[1,2]")).toBeUndefined()
    expect(parseJsonRecord("not json")).toBeUndefined()
  })
})
