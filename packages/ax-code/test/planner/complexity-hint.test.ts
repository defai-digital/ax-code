import { describe, expect, test } from "bun:test"
import { Planner } from "../../src/planner"
import { isComplex, score } from "../../src/planner/complexity"

describe("planner.complexity hints", () => {
  test('"high" hint forces isComplex true even for short requests', () => {
    expect(isComplex("tweak it")).toBe(false)
    expect(isComplex("tweak it", "high")).toBe(true)
  })

  test('"low" hint forces isComplex false unless multi-file or multi-step', () => {
    const long =
      "Refactor the auth module so that we extract token rotation into a dedicated service and migrate all callers across the project to the new API."
    expect(isComplex(long)).toBe(true)
    expect(isComplex(long, "low")).toBe(true) // multi-file/step keywords still count

    const longSingle =
      "Refactor loginButton.tsx to use the new design tokens by replacing each hardcoded value with the matching named token."
    expect(isComplex(longSingle)).toBe(true)
    expect(isComplex(longSingle, "low")).toBe(false)
  })

  test('"medium" hint preserves keyword-driven decision', () => {
    expect(isComplex("fix typo", "medium")).toBe(false)
    const long =
      "Refactor the auth module so that we extract token rotation into a dedicated service and migrate all callers across the project to the new API."
    expect(isComplex(long, "medium")).toBe(true)
  })

  test("score floor for high hint is 65", () => {
    expect(score("tweak", "high")).toBeGreaterThanOrEqual(65)
  })

  test("score ceiling for low hint is 35", () => {
    const long =
      "Refactor the auth module across all files in the codebase: first extract token rotation, then update every caller, finally add tests, after that document the change."
    expect(score(long)).toBeGreaterThan(35)
    expect(score(long, "low")).toBeLessThanOrEqual(35)
  })

  test("medium hint adds a small bonus", () => {
    const base = score("update the README with installation steps")
    const biased = score("update the README with installation steps", "medium")
    expect(biased).toBeGreaterThanOrEqual(base)
  })

  test("Planner re-exports hint-aware predicates", () => {
    expect(Planner.shouldPlan("ship it", "high")).toBe(true)
    expect(Planner.complexityScore("ship it", "high")).toBeGreaterThanOrEqual(65)
  })
})
