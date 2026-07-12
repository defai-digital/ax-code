import { describe, expect, test } from "vitest"
import { Hybrid } from "../../src/mode/hybrid"

describe("Hybrid.recommendPlacement", () => {
  test("uses local when available and preferred", () => {
    const r = Hybrid.recommendPlacement({ localAvailable: true })
    expect(r.placement).toBe("local")
    expect(r.reasons).toContain("local_available_prefer_local")
  })

  test("escalates high complexity to cloud", () => {
    const r = Hybrid.recommendPlacement({
      localAvailable: true,
      complexity: "high",
      escalateOnHighComplexity: true,
    })
    expect(r.placement).toBe("cloud")
    expect(r.reasons).toContain("high_complexity_escalate_cloud")
  })

  test("keeps medium complexity local when preferred", () => {
    const r = Hybrid.recommendPlacement({
      localAvailable: true,
      complexity: "medium",
    })
    expect(r.placement).toBe("local")
  })

  test("privacy forces local when available", () => {
    const r = Hybrid.recommendPlacement({
      localAvailable: true,
      privacyRequired: true,
      complexity: "high",
    })
    expect(r.placement).toBe("local")
    expect(r.reasons).toContain("privacy_required_local")
  })

  test("privacy falls back to cloud when local missing", () => {
    const r = Hybrid.recommendPlacement({
      localAvailable: false,
      privacyRequired: true,
    })
    expect(r.placement).toBe("cloud")
    expect(r.reasons).toContain("privacy_required_but_local_unavailable")
  })

  test("cloud when local unavailable", () => {
    const r = Hybrid.recommendPlacement({ localAvailable: false })
    expect(r.placement).toBe("cloud")
  })

  test("preferLocalWhenAvailable false forces cloud", () => {
    const r = Hybrid.recommendPlacement({
      localAvailable: true,
      preferLocalWhenAvailable: false,
    })
    expect(r.placement).toBe("cloud")
  })
})
