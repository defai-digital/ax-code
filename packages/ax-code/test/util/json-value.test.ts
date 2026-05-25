import { describe, expect, test } from "bun:test"
import { parseJsonPayload } from "../../src/util/json-value"

describe("util.json-value", () => {
  test("parseJsonPayload parses valid JSON values", () => {
    expect(parseJsonPayload(JSON.stringify({ type: "event" }))).toEqual({ type: "event" })
    expect(parseJsonPayload("  null\n")).toBeNull()
    expect(parseJsonPayload("0")).toBe(0)
  })

  test("parseJsonPayload returns undefined for absent, empty, or malformed payloads", () => {
    expect(parseJsonPayload(undefined)).toBeUndefined()
    expect(parseJsonPayload("")).toBeUndefined()
    expect(parseJsonPayload("   \n")).toBeUndefined()
    expect(parseJsonPayload("{not json")).toBeUndefined()
  })
})
