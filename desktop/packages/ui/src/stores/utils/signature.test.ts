import { describe, expect, test } from "vitest"

import { buildRecordSignature } from "./signature"

describe("buildRecordSignature", () => {
  test("serializes selected fields consistently", () => {
    expect(
      buildRecordSignature(
        [
          { name: "one", enabled: true },
          { name: "two", enabled: false },
        ],
        (record) => [record.name, record.enabled],
      ),
    ).toBe("one|true||two|false")
  })

  test("normalizes nullish fields to empty slots", () => {
    expect(buildRecordSignature([{ name: "one", scope: null, description: undefined }], (record) => [
      record.name,
      record.scope,
      record.description,
    ])).toBe("one||")
  })
})
