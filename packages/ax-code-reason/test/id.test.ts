import { describe, expect, test } from "vitest"
import { DebugPatternID, EmbeddingCacheID, RefactorPlanID } from "../src/id"

describe("reasoning-engine identifiers", () => {
  test("generates branded IDs with stable entity prefixes", () => {
    expect(RefactorPlanID.ascending()).toMatch(/^rpl_/)
    expect(EmbeddingCacheID.descending()).toMatch(/^ebc_/)
    expect(DebugPatternID.ascending()).toMatch(/^dpt_/)
  })

  test("validates caller-supplied IDs instead of silently rebranding them", () => {
    expect(RefactorPlanID.ascending("rpl_existing")).toBe("rpl_existing")
    expect(() => RefactorPlanID.ascending("wrong_existing")).toThrow("does not start with rpl_")
    expect(() => RefactorPlanID.descending("ebc_wrong-kind")).toThrow("does not start with rpl_")
  })

  test("exposes the same validation at schema boundaries", () => {
    expect(RefactorPlanID.zod.safeParse("rpl_valid").success).toBe(true)
    expect(RefactorPlanID.zod.safeParse("ebc_wrong").success).toBe(false)
  })
})
