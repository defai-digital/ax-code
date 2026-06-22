import { describe, expect, test } from "vitest"
import { Storage } from "../../src/storage/storage"

describe("Storage.parseMigrationMarker", () => {
  test("accepts only complete non-negative integer markers", () => {
    expect(Storage.parseMigrationMarker("0", 2)).toEqual({ value: 0, status: "ok" })
    expect(Storage.parseMigrationMarker(" 2 ", 2)).toEqual({ value: 2, status: "ok" })
    expect(Storage.parseMigrationMarker("1junk", 2)).toEqual({ value: 0, status: "not_numeric" })
    expect(Storage.parseMigrationMarker("1.5", 2)).toEqual({ value: 0, status: "not_numeric" })
    expect(Storage.parseMigrationMarker("-1", 2)).toEqual({ value: 0, status: "not_numeric" })
    expect(Storage.parseMigrationMarker("", 2)).toEqual({ value: 0, status: "not_numeric" })
  })

  test("clamps complete integer markers outside the migration range", () => {
    expect(Storage.parseMigrationMarker("3", 2)).toEqual({ value: 2, status: "out_of_range" })
    expect(Storage.parseMigrationMarker("999999999999999999999999", 2)).toEqual({
      value: 2,
      status: "out_of_range",
    })
  })
})
