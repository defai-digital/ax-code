import { describe, expect, test } from "vitest"
import { ToolResultBudget } from "../../src/session/tool-result-budget"
import { Truncate } from "../../src/tool/truncate"

const KB = 1024

describe("ToolResultBudget.resolveBudgetBytes", () => {
  test("derives 35% of the context window at ~4 bytes per token", () => {
    // 64k-token model: 64_000 * 4 * 0.35 = 89_600 bytes
    expect(ToolResultBudget.resolveBudgetBytes({ contextTokens: 64_000 })).toBe(89_600)
  })

  test("clamps small windows to the 32 KB floor", () => {
    expect(ToolResultBudget.resolveBudgetBytes({ contextTokens: 1_000 })).toBe(32 * KB)
    expect(ToolResultBudget.resolveBudgetBytes({ contextTokens: 0 })).toBe(32 * KB)
    expect(ToolResultBudget.resolveBudgetBytes({})).toBe(32 * KB)
  })

  test("clamps large windows to the 400 KB ceiling", () => {
    // 1M-token model would derive 1.4 MB
    expect(ToolResultBudget.resolveBudgetBytes({ contextTokens: 1_000_000 })).toBe(400 * KB)
  })

  test("an explicit positive override wins over the derived budget", () => {
    expect(ToolResultBudget.resolveBudgetBytes({ contextTokens: 1_000_000, overrideBytes: 64 * KB })).toBe(64 * KB)
  })

  test("the override is floored at the preview floor because results cannot shrink below it", () => {
    expect(ToolResultBudget.resolveBudgetBytes({ contextTokens: 64_000, overrideBytes: 100 })).toBe(
      ToolResultBudget.PREVIEW_FLOOR_BYTES,
    )
  })

  test("non-positive or non-finite overrides are ignored", () => {
    expect(ToolResultBudget.resolveBudgetBytes({ contextTokens: 64_000, overrideBytes: 0 })).toBe(89_600)
    expect(ToolResultBudget.resolveBudgetBytes({ contextTokens: 64_000, overrideBytes: -5 })).toBe(89_600)
    expect(ToolResultBudget.resolveBudgetBytes({ contextTokens: 64_000, overrideBytes: Number.NaN })).toBe(89_600)
  })
})

describe("ToolResultBudget.plan", () => {
  test("under budget is a no-op", () => {
    const plan = ToolResultBudget.plan({
      results: [{ bytes: 10 * KB }, { bytes: 5 * KB }],
      budgetBytes: 32 * KB,
    })
    expect(plan.spill).toEqual([])
    expect(plan.overBudget).toBe(false)
    expect(plan.projectedBytes).toBe(15 * KB)
  })

  test("exactly at budget is a no-op", () => {
    const plan = ToolResultBudget.plan({
      results: [{ bytes: 16 * KB }, { bytes: 16 * KB }],
      budgetBytes: 32 * KB,
    })
    expect(plan.spill).toEqual([])
    expect(plan.overBudget).toBe(false)
  })

  test("selects the largest results first, smallest kept intact", () => {
    const plan = ToolResultBudget.plan({
      results: [{ bytes: 4 * KB }, { bytes: 30 * KB }, { bytes: 12 * KB }, { bytes: 6 * KB }],
      budgetBytes: 25 * KB,
      previewFloorBytes: 2 * KB,
    })
    // Total 52 KB. Spilling the 30 KB result projects it to ~2.25 KB,
    // leaving ~24.25 KB: fits, so the other results stay intact.
    expect(plan.spill).toEqual([1])
    expect(plan.overBudget).toBe(false)
  })

  test("keeps spilling largest-first until the projected total fits", () => {
    const plan = ToolResultBudget.plan({
      results: [{ bytes: 20 * KB }, { bytes: 25 * KB }, { bytes: 18 * KB }],
      budgetBytes: 30 * KB,
      previewFloorBytes: 2 * KB,
    })
    // Total 63 KB. Spill 25 KB -> 63 - 25 + 2.25 = 40.25 KB, still over.
    // Spill 20 KB -> 40.25 - 20 + 2.25 = 22.5 KB: fits. The 18 KB result stays.
    expect(plan.spill).toEqual([1, 0])
    expect(plan.overBudget).toBe(false)
  })

  test("never selects error results even when they are the largest", () => {
    const plan = ToolResultBudget.plan({
      results: [{ bytes: 2 * KB }, { bytes: 40 * KB, error: true }, { bytes: 10 * KB }],
      budgetBytes: 16 * KB,
      previewFloorBytes: 2 * KB,
    })
    // Errors are untouchable, so only the 10 KB result can spill; the 2 KB
    // result is at the floor and cannot shrink either.
    expect(plan.spill).toEqual([2])
    // 2 + 40 + 2.25 = 44.25 KB is still over budget, but errors stay intact.
    expect(plan.overBudget).toBe(true)
  })

  test("never selects results at or below the preview floor", () => {
    const plan = ToolResultBudget.plan({
      results: [{ bytes: 2 * KB }, { bytes: 3 * KB }, { bytes: 30 * KB }],
      budgetBytes: 10 * KB,
      previewFloorBytes: 2 * KB,
    })
    // Only the 30 KB result can meaningfully shrink; the 2 KB result is
    // already at the floor and must not be selected.
    expect(plan.spill).toEqual([2])
  })

  test("does not spill a result whose preview plus note would grow it", () => {
    const plan = ToolResultBudget.plan({
      results: [{ bytes: 20_000 }, { bytes: ToolResultBudget.PREVIEW_FLOOR_BYTES + 1 }],
      budgetBytes: 2_500,
      previewFloorBytes: ToolResultBudget.PREVIEW_FLOOR_BYTES,
    })
    // Spilling the 2,049-byte result cannot even cover the preview floor plus
    // the note allowance, so only the 20,000-byte result is a useful candidate.
    expect(plan.spill).toEqual([0])
    expect(plan.projectedBytes).toBe(
      ToolResultBudget.PREVIEW_FLOOR_BYTES + ToolResultBudget.SPILL_NOTE_ALLOWANCE_BYTES + 2_049,
    )
    expect(plan.overBudget).toBe(true)
  })

  test("the spill note allowance covers the note Truncate.output actually appends", async () => {
    const text = Array.from({ length: 1024 }, (_, index) => `line ${index} ${"x".repeat(8)}`).join("\n")
    const result = await Truncate.output(text, { maxBytes: ToolResultBudget.PREVIEW_FLOOR_BYTES }, {
      permission: [],
    } as never)
    expect(result.truncated).toBe(true)
    const marker = result.content.indexOf("\n\n...")
    expect(marker).toBeGreaterThanOrEqual(0)
    expect(Buffer.byteLength(result.content.slice(marker), "utf-8")).toBeLessThanOrEqual(
      ToolResultBudget.SPILL_NOTE_ALLOWANCE_BYTES,
    )
  })

  test("reports overBudget when even spilling everything cannot fit", () => {
    const plan = ToolResultBudget.plan({
      results: [{ bytes: 50 * KB }, { bytes: 40 * KB }],
      budgetBytes: 20 * KB,
      previewFloorBytes: 2 * KB,
    })
    // 90 - 50 + 2.25 - 40 + 2.25 = 4.5 KB... but budget is 20 KB so it fits;
    // use errors to force a genuinely unfixable total instead.
    expect(plan.overBudget).toBe(false)
    const unfixable = ToolResultBudget.plan({
      results: [{ bytes: 50 * KB }, { bytes: 40 * KB, error: true }],
      budgetBytes: 20 * KB,
      previewFloorBytes: 2 * KB,
    })
    expect(unfixable.spill).toEqual([0])
    expect(unfixable.overBudget).toBe(true)
  })

  test("breaks ties deterministically by index", () => {
    const plan = ToolResultBudget.plan({
      results: [{ bytes: 20 * KB }, { bytes: 20 * KB }, { bytes: 20 * KB }],
      budgetBytes: 25 * KB,
      previewFloorBytes: 2 * KB,
    })
    // 60 KB total; each spill frees ~17.75 KB. Two spills bring it to
    // ~24.5 KB which fits the 25 KB budget, so exactly the first two
    // (by index) are selected — never a different pair on a re-run.
    expect(plan.spill).toEqual([0, 1])
    expect(plan.overBudget).toBe(false)
  })

  test("empty result list is a no-op", () => {
    const plan = ToolResultBudget.plan({ results: [], budgetBytes: 32 * KB })
    expect(plan.spill).toEqual([])
    expect(plan.projectedBytes).toBe(0)
    expect(plan.overBudget).toBe(false)
  })

  test("negative byte entries are clamped to zero", () => {
    const plan = ToolResultBudget.plan({
      results: [{ bytes: -100 }, { bytes: 5 * KB }],
      budgetBytes: 32 * KB,
    })
    expect(plan.projectedBytes).toBe(5 * KB)
    expect(plan.spill).toEqual([])
  })
})
