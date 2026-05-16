import { describe, expect, test } from "bun:test"
import { isNonEmptyRecord, recordCount } from "../../src/util/record"

describe("util.record", () => {
  test("recordCount returns number of keys for plain record objects", () => {
    expect(recordCount({ a: 1, b: 2 })).toBe(2)
  })

  test("recordCount treats non-record values as empty", () => {
    expect(recordCount(undefined)).toBe(0)
    expect(recordCount(null)).toBe(0)
    expect(recordCount([])).toBe(0)
    expect(recordCount("x")).toBe(0)
  })

  test("isNonEmptyRecord reflects recordCount semantics", () => {
    expect(isNonEmptyRecord({})).toBe(false)
    expect(isNonEmptyRecord({ enabled: true })).toBe(true)
    expect(isNonEmptyRecord([])).toBe(false)
  })
})
