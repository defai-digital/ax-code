import { describe, expect, test } from "vitest"
import { Budget } from "../../src/mode/budget"

describe("Budget.check", () => {
  test("caps members to max", () => {
    const r = Budget.check({
      kind: "council",
      requestedMembers: 10,
      budget: { maxMembers: 3, maxContestants: 3, timeoutMs: 1000 },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error("expected ok")
    expect(r.allowedMembers).toBe(3)
    expect(r.reasons.some((x) => x.startsWith("capped:"))).toBe(true)
  })

  test("fails arena when fewer than 2 after usd budget", () => {
    const r = Budget.check({
      kind: "arena",
      requestedMembers: 3,
      budget: {
        maxMembers: 3,
        maxContestants: 3,
        timeoutMs: 1000,
        maxEstimatedUsd: 0.01,
        estimatedUsdPerMember: 0.02,
      },
    })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error("expected fail")
    expect(r.reason).toBe("usd_budget")
  })

  test("reduces members under usd budget when still viable", () => {
    const r = Budget.check({
      kind: "council",
      requestedMembers: 4,
      budget: {
        maxMembers: 4,
        maxContestants: 4,
        timeoutMs: 1000,
        maxEstimatedUsd: 0.05,
        estimatedUsdPerMember: 0.02,
      },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error("expected ok")
    expect(r.allowedMembers).toBe(2)
  })

  test("accounts for every planned call per member", () => {
    const r = Budget.check({
      kind: "council",
      requestedMembers: 3,
      callsPerMember: 3,
      budget: {
        maxMembers: 3,
        maxContestants: 3,
        timeoutMs: 1000,
        maxEstimatedUsd: 6,
        estimatedUsdPerMember: 1,
      },
    })

    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error("expected ok")
    expect(r.allowedMembers).toBe(2)
    expect(r.estimatedUsd).toBe(6)
    expect(r.reasons).toContain("calls_per_member:3")
  })

  test("does not undercount members at an exact decimal budget boundary", () => {
    const r = Budget.check({
      kind: "council",
      requestedMembers: 3,
      budget: {
        maxMembers: 3,
        maxContestants: 3,
        timeoutMs: 1000,
        maxEstimatedUsd: 0.3,
        estimatedUsdPerMember: 0.1,
      },
    })

    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error("expected ok")
    expect(r.allowedMembers).toBe(3)
  })

  test("flat calls are priced once and subtracted from the member headroom (ADR-101)", () => {
    const r = Budget.check({
      kind: "arena",
      requestedMembers: 3,
      callsPerMember: 2,
      flatCalls: 1,
      budget: {
        maxMembers: 3,
        maxContestants: 3,
        timeoutMs: 1000,
        maxEstimatedUsd: 0.07,
        estimatedUsdPerMember: 0.01,
      },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error("expected ok")
    // (0.07 − 0.01 judge) / 0.02 = 3 members fit; estimate = 3×0.02 + 0.01
    expect(r.allowedMembers).toBe(3)
    expect(r.estimatedUsd).toBeCloseTo(0.07, 4)
    expect(r.reasons).toContain("flat_calls:1")
  })

  test("flat calls tighten the USD fit and can force a rejection", () => {
    const viable = Budget.check({
      kind: "arena",
      requestedMembers: 3,
      callsPerMember: 2,
      flatCalls: 1,
      budget: {
        maxMembers: 3,
        maxContestants: 3,
        timeoutMs: 1000,
        maxEstimatedUsd: 0.05,
        estimatedUsdPerMember: 0.01,
      },
    })
    // (0.05 − 0.01) / 0.02 = 2 members fit — still viable
    expect(viable.ok).toBe(true)
    if (!viable.ok) throw new Error("expected ok")
    expect(viable.allowedMembers).toBe(2)

    const tight = Budget.check({
      kind: "arena",
      requestedMembers: 3,
      callsPerMember: 2,
      flatCalls: 1,
      budget: {
        maxMembers: 3,
        maxContestants: 3,
        timeoutMs: 1000,
        maxEstimatedUsd: 0.03,
        estimatedUsdPerMember: 0.01,
      },
    })
    // (0.03 − 0.01) / 0.02 = 1 → arena needs ≥2 → rejected
    expect(tight.ok).toBe(false)
    if (tight.ok) throw new Error("expected fail")
    expect(tight.reason).toBe("usd_budget")
  })
})
