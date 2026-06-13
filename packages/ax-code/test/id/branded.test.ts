import { describe, expect, test } from "bun:test"

import { defineBrandedIdentifier, defineBrandedString } from "../../src/id/branded"

describe("defineBrandedIdentifier", () => {
  const ExampleID = defineBrandedIdentifier("ExampleID", "code_node")

  test("casts existing IDs without changing the value", () => {
    const id: string = ExampleID.make("cnd_existing")
    expect(id).toBe("cnd_existing")
  })

  test("creates ascending IDs with the configured prefix", () => {
    expect(ExampleID.ascending()).toStartWith("cnd_")
    const given: string = ExampleID.ascending("cnd_given")
    expect(given).toBe("cnd_given")
  })

  test("validates the prefix through zod", () => {
    const parsed: string = ExampleID.zod.parse("cnd_valid")
    expect(parsed).toBe("cnd_valid")
    expect(ExampleID.zod.safeParse("rpl_wrong").success).toBe(false)
  })
})

describe("defineBrandedString", () => {
  const ExampleID = defineBrandedString("ExampleID")

  test("casts and validates arbitrary string IDs", () => {
    const id: string = ExampleID.make("custom-id")
    const parsed: string = ExampleID.zod.parse("custom-id")

    expect(id).toBe("custom-id")
    expect(parsed).toBe("custom-id")
    expect(ExampleID.zod.safeParse(123).success).toBe(false)
  })
})
