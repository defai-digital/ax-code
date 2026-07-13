import { describe, expect, test } from "vitest"
import { EnsemblePreflight } from "../../src/mode/preflight"

describe("EnsemblePreflight", () => {
  test("arenaDisabledMessage includes enable path and provider count", () => {
    const msg = EnsemblePreflight.arenaDisabledMessage({
      providers: { count: 1, ids: ["zai-coding-plan"] },
      projectConfigHint: "/proj/ax-code.json",
    })
    expect(msg).toContain("enableIfDisabled")
    expect(msg).toContain("**1**")
    expect(msg).toContain("≥2")
    expect(msg).toContain("council")
    expect(msg).toContain("/proj/ax-code.json")
  })

  test("suggestTool routes quality review to council", () => {
    expect(EnsemblePreflight.suggestTool("rate good and worse code quality")).toBe("council")
    expect(EnsemblePreflight.suggestTool("security audit of auth")).toBe("council")
  })

  test("suggestTool routes approach compare to arena_plan", () => {
    expect(EnsemblePreflight.suggestTool("compare approaches for migrating sessions")).toBe("arena_plan")
  })

  test("suggestTool routes implement competition to arena_implement", () => {
    expect(EnsemblePreflight.suggestTool("arena best-of-n implement the fix")).toBe("arena_implement")
  })

  test("insufficient providers message lists count", () => {
    const msg = EnsemblePreflight.arenaInsufficientProvidersMessage({ count: 0, ids: [] })
    expect(msg).toContain("**0**")
    expect(msg).toContain("/connect")
  })

  test("forbidsTaskParallelFirst detects council/arena turns", () => {
    expect(EnsemblePreflight.forbidsTaskParallelFirst("Run multi-provider council review")).toBe(true)
    expect(EnsemblePreflight.forbidsTaskParallelFirst("use the arena tool")).toBe(true)
    expect(EnsemblePreflight.forbidsTaskParallelFirst("explore the auth module only")).toBe(false)
  })
})
