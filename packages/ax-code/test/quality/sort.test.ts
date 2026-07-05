import { describe, expect, test } from "vitest"
import { compareStringFields, uniqueBy } from "../../src/quality/sort"

describe("quality sort helpers", () => {
  test("compares ordered string fields", () => {
    const items = [
      { createdAt: "2026-01-01T00:00:00.000Z", id: "b" },
      { createdAt: "2026-01-01T00:00:00.000Z", id: "a" },
      { createdAt: "2025-01-01T00:00:00.000Z", id: "c" },
    ]

    const sorted = [...items].sort((a, b) => compareStringFields(a, b, ["createdAt", "id"]))

    expect(sorted.map((item) => item.id)).toEqual(["c", "a", "b"])
  })

  test("deduplicates by key with the last item winning", () => {
    const items = [
      { id: "a", value: "first" },
      { id: "b", value: "only" },
      { id: "a", value: "last" },
    ]

    expect(uniqueBy(items, (item) => item.id)).toEqual([
      { id: "a", value: "last" },
      { id: "b", value: "only" },
    ])
  })
})
