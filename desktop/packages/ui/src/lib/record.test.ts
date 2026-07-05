import { describe, expect, test } from "vitest"

import { isPlainRecord, isRecord } from "./record"

describe("record guards", () => {
  test("treats objects and arrays as records", () => {
    expect(isRecord({ key: "value" })).toBe(true)
    expect(isRecord(["value"])).toBe(true)
  })

  test("treats only non-array objects as plain records", () => {
    expect(isPlainRecord({ key: "value" })).toBe(true)
    expect(isPlainRecord(["value"])).toBe(false)
  })

  test("rejects null and primitives", () => {
    expect(isRecord(null)).toBe(false)
    expect(isRecord("value")).toBe(false)
    expect(isPlainRecord(null)).toBe(false)
    expect(isPlainRecord("value")).toBe(false)
  })
})
