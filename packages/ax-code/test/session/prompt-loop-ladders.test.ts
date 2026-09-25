import { describe, expect, test } from "vitest"
import { LOOP_LADDERS, RECENT_MUTATION_GRACE_TURNS } from "../../src/session/prompt/prompt-loop-config"

/**
 * The relationships between the stop-condition ladders, pinned from the item-4
 * design review (`.internal/reports/2026-09-25-agentic-rework-review/`).
 *
 * These ladders are separate decision functions on purpose, and the reviews
 * rejected collapsing them: the ax-engine guard holds a local latency boundary
 * and carries evidence/grace/synthesis phases the generic ladder cannot express.
 * What the table must not allow is a silent "unification" of the numbers, so the
 * intent behind each gap is asserted here rather than left in prose.
 */
describe("loop ladder relationships", () => {
  test("the generic ladder escalates in order", () => {
    const { nudge, finalNudge, stop } = LOOP_LADDERS.tool_only
    expect(nudge).toBeGreaterThan(1)
    expect(finalNudge).toBeGreaterThan(nudge)
    expect(stop).toBeGreaterThan(finalNudge)
  })

  test("the all-error ladder is deliberately far tighter than the generic one", () => {
    // An all-error turn has no productive form, unlike legitimate deep
    // read-only exploration.
    expect(LOOP_LADDERS.failed_tool.stop).toBeLessThan(LOOP_LADDERS.tool_only.nudge)
    expect(LOOP_LADDERS.failed_tool.nudge).toBeLessThan(LOOP_LADDERS.failed_tool.force)
    expect(LOOP_LADDERS.failed_tool.force).toBeLessThan(LOOP_LADDERS.failed_tool.stop)
  })

  test("the local read-only guard stays tighter than the generic ladder", () => {
    // This is the assertion that fails if someone "synchronises" the two
    // ladders: local read-only exploration must converge long before a cloud
    // provider's 15-turn nudge, because every extra local round costs prefill.
    expect(LOOP_LADDERS.ax_engine_read_only.nudge).toBeLessThan(LOOP_LADDERS.tool_only.nudge)
    expect(LOOP_LADDERS.ax_engine_read_only.force).toBeLessThan(LOOP_LADDERS.tool_only.nudge)
    // ...but it is not a two-turn trap either: it must allow a real evidence
    // window before forcing text (reviewers cited failed path probes).
    expect(LOOP_LADDERS.ax_engine_read_only.force).toBeGreaterThan(1)
  })

  test("the cumulative mutation net is not tighter than one streak", () => {
    // It exists to catch failures interleaved with successes, so it must be at
    // least as generous as a single consecutive-failure streak.
    expect(LOOP_LADDERS.failed_mutation.stop).toBeGreaterThanOrEqual(LOOP_LADDERS.failed_tool.stop)
  })

  test("the recent-mutation grace window is a positive, bounded number of turns", () => {
    expect(RECENT_MUTATION_GRACE_TURNS).toBeGreaterThan(0)
    expect(RECENT_MUTATION_GRACE_TURNS).toBeLessThan(LOOP_LADDERS.tool_only.nudge)
  })
})
