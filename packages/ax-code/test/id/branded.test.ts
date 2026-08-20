import { describe, expect, test } from "vitest"

import { defineBrandedIdentifier, defineBrandedString } from "../../src/id/branded"
import { Identifier } from "../../src/id/id"
import { Identifier as UtilIdentifier } from "@ax-code/util/identifier"

describe("defineBrandedIdentifier", () => {
  const ExampleID = defineBrandedIdentifier("ExampleID", "code_node")

  test("casts existing IDs without changing the value", () => {
    const id: string = ExampleID.make("cnd_existing")
    expect(id).toBe("cnd_existing")
  })

  test("creates ascending IDs with the configured prefix", () => {
    expect(ExampleID.ascending()).toMatch(/^cnd_z[0-9a-f]{14}[0-9A-Za-z]{11}$/)
    const given: string = ExampleID.ascending("cnd_given")
    expect(given).toBe("cnd_given")
  })

  test("validates the prefix through zod", () => {
    const parsed: string = ExampleID.zod.parse("cnd_valid")
    expect(parsed).toBe("cnd_valid")
    expect(ExampleID.zod.safeParse("rpl_wrong").success).toBe(false)
    expect(ExampleID.zod.safeParse("cndish").success).toBe(false)
    expect(() => ExampleID.ascending("cndish")).toThrow("does not start with cnd_")
  })
})

describe("Identifier sortable encoding", () => {
  test("stays monotonic across the legacy timestamp wrap, clock rollback, and counter spill", () => {
    const legacyWrap = 2 ** 36
    const nextWrap = (Math.floor(Date.now() / legacyWrap) + 1) * legacyWrap
    const beforeWrap = Identifier.create("message", false, nextWrap - 1)
    const afterWrap = Identifier.create("message", false, nextWrap)

    expect(afterWrap > beforeWrap).toBe(true)
    expect(Identifier.timestamp(beforeWrap)).toBe(nextWrap - 1)
    expect(Identifier.timestamp(afterWrap)).toBe(nextWrap)

    const rollbackBase = nextWrap + 1_000
    const beforeRollback = Identifier.create("message", false, rollbackBase)
    const afterRollback = Identifier.create("message", false, rollbackBase - 500)
    expect(afterRollback > beforeRollback).toBe(true)
    expect(Identifier.timestamp(afterRollback)).toBe(rollbackBase)

    const spillBase = nextWrap + 2_000
    const ids = Array.from({ length: 4_096 }, () => Identifier.create("message", false, spillBase))
    expect(ids.at(-1)! > ids[0]!).toBe(true)
    expect(Identifier.timestamp(ids.at(-1)!)).toBe(spillBase + 1)
  })

  test("decodes legacy 48-bit identifiers", () => {
    const timestamp = 123_456
    const encoded = (BigInt(timestamp) * BigInt(0x1000) + BigInt(1)).toString(16).padStart(12, "0")
    expect(Identifier.timestamp(`msg_${encoded}${"A".repeat(14)}`)).toBe(timestamp)
  })

  test("sorts widened identifiers correctly against every legacy payload", () => {
    const newestLegacyAscending = `msg_${"f".repeat(12)}${"z".repeat(14)}`
    const oldestLegacyDescending = `ses_${"0".repeat(12)}${"0".repeat(14)}`

    expect(Identifier.create("message", false) > newestLegacyAscending).toBe(true)
    expect(Identifier.create("session", true) < oldestLegacyDescending).toBe(true)
  })

  test("widens the shared utility sort key without changing its length", () => {
    const legacyWrap = 2 ** 36
    const nextWrap = (Math.floor(Date.now() / legacyWrap) + 2) * legacyWrap
    const before = UtilIdentifier.create(false, nextWrap - 1)
    const after = UtilIdentifier.create(false, nextWrap)

    expect(before).toHaveLength(26)
    expect(after).toHaveLength(26)
    expect(after > before).toBe(true)
    expect(after[0]).toBe("z")
    expect(UtilIdentifier.create(true)[0]).toBe("-")
  })

  test("rejects invalid explicit timestamps", () => {
    expect(() => Identifier.create("message", false, -1)).toThrow("Invalid identifier timestamp")
    expect(() => Identifier.create("message", false, 2 ** 44)).toThrow("Invalid identifier timestamp")
    expect(() => UtilIdentifier.create(false, Number.NaN)).toThrow("Invalid identifier timestamp")
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
