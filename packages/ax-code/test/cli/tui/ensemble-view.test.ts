import { describe, expect, test } from "vitest"
import {
  arenaView,
  councilView,
  type EnsembleTone,
} from "../../../src/cli/cmd/tui/routes/session/tool-renderers/ensemble-view"

function expectAscii(value: string) {
  expect(value).toMatch(/^[\x00-\x7F]*$/)
}

function expectAllAscii(values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === "string") expectAscii(value)
  }
}

describe("councilView", () => {
  test("maps a complete run to tone ok and count-sorted chips", () => {
    const view = councilView({
      status: "ok",
      totalMembers: 5,
      successfulMembers: 5,
      consensusCount: 2,
      majorityCount: 1,
      minorityCount: 0,
      singletonCount: 1,
    })
    expect(view.tone).toBe<EnsembleTone>("ok")
    expect(view.statusLabel).toBe("Complete")
    expect(view.membersLabel).toBe("5/5 members")
    expect(view.chips.map((chip) => [chip.label, chip.count])).toEqual([
      ["consensus", 2],
      ["majority", 1],
      ["singleton", 1],
    ])
    expect(view.chips.find((chip) => chip.label === "consensus")?.tone).toBe("ok")
    expect(view.chips.find((chip) => chip.label === "singleton")?.tone).toBe("muted")
  })

  test("reports incomplete runs without implying agreement", () => {
    const view = councilView({ status: "incomplete", totalMembers: 5, successfulMembers: 2 })
    expect(view.tone).toBe("warn")
    expect(view.statusLabel).toBe("Incomplete")
    expect(view.membersLabel).toBe("2/5 members")
  })

  test("degrades disabled, rejected, and empty-member statuses", () => {
    expect(councilView({ status: "disabled" })).toMatchObject({
      tone: "muted",
      statusLabel: "Disabled",
      membersLabel: null,
      chips: [],
    })
    expect(councilView({ status: "context_rejected" })).toMatchObject({
      tone: "error",
      statusLabel: "Context too large",
    })
    expect(councilView({ status: "budget_rejected" }).tone).toBe("error")
    expect(councilView({ status: "no_members" }).tone).toBe("error")
    expect(councilView({ status: "insufficient_members" })).toMatchObject({
      tone: "error",
      statusLabel: "Need ≥2 members",
    })
  })

  test("relabels a lone singleton as a single answer", () => {
    const view = councilView({ status: "ok", singletonCount: 3 })
    expect(view.chips).toEqual([{ label: "single answer", count: 3, tone: "muted" }])
  })

  test("puts selection errors and budget reasons in notes, deduped", () => {
    const view = councilView({
      status: "incomplete",
      successfulMembers: 1,
      totalMembers: 3,
      selectionErrors: ["skipped x", "skipped x", ""],
      budgetReasons: ["cap reached"],
    })
    expect(view.notes).toEqual(["skipped x", "cap reached"])
  })

  test("keeps the debate label only when rounds ran and surfaces failures", () => {
    expect(councilView({ status: "ok", debateRoundsRun: 2 }).debateLabel).toBe("2 debate rounds")
    expect(councilView({ status: "ok", debateRoundsRun: 0 }).debateLabel).toBeNull()
    expect(councilView({ status: "ok", debateStopReason: "convergence" }).notes).toEqual([])
    expect(councilView({ status: "ok", debateStopReason: "input_budget_rejected" }).notes).toEqual([
      "input_budget_rejected",
    ])
  })

  test("caps the roster and marks the remainder", () => {
    const memberIds = Array.from({ length: 12 }, (_, index) => `provider/model-${index}`)
    const view = councilView({ status: "ok", memberIds })
    expect(view.roster).toHaveLength(6)
    expect(view.roster.slice(0, 5)).toEqual(["model-0", "model-1", "model-2", "model-3", "model-4"])
    expect(view.roster.at(-1)).toBe("+7 more")
  })

  test("is defensive about non-object and unknown metadata", () => {
    for (const value of [null, undefined, "nope", 42, [], {}]) {
      const view = councilView(value)
      expect(view).toMatchObject({ kind: "council", tone: "muted", statusLabel: "Unknown", chips: [], roster: [] })
    }
    expect(councilView({ status: "future_status" }).tone).toBe("muted")
    expect(councilView({ status: "ok", consensusCount: -3 }).chips).toEqual([])
  })

  test("emits ASCII-only strings", () => {
    const view = councilView({
      status: "incomplete",
      totalMembers: 4,
      successfulMembers: 2,
      consensusCount: 1,
      minorityCount: 1,
      memberIds: ["provider/model-a", "provider/model-b"],
      selectionErrors: ["skipped: no key"],
      budgetReasons: ["cap"],
      debateRoundsRun: 1,
    })
    expectAllAscii([
      view.statusLabel,
      view.membersLabel,
      view.debateLabel,
      ...view.roster,
      ...view.notes,
      ...view.chips.flatMap((chip) => [chip.label, String(chip.count)]),
    ])
  })
})

describe("arenaView", () => {
  test("labels a verified implement run and a ranked plan run distinctly", () => {
    const plan = arenaView({ status: "ok", mode: "plan", strategy: "verify_first", rankedIds: ["a", "b", "c"] })
    expect(plan).toMatchObject({
      tone: "ok",
      statusLabel: "Ranked",
      modeLabel: "Plan",
      strategyLabel: "Verify first",
      rankedLabel: "3 contestants",
    })
    expect(plan.ranked).toEqual(["a", "b", "c"])

    const implement = arenaView({ status: "ok", mode: "implement", strategy: "diversity", worktrees: ["/w1", "/w2"] })
    expect(implement.statusLabel).toBe("Verified")
    expect(implement.modeLabel).toBe("Implement")
    expect(implement.strategyLabel).toBe("Diversity")
    expect(implement.notes).toEqual(["2 worktrees"])
  })

  test("maps failure and preflight statuses to distinct tones", () => {
    expect(arenaView({ status: "no_successful_candidate" })).toMatchObject({ tone: "error" })
    expect(arenaView({ status: "no_verified_candidate" })).toMatchObject({ tone: "warn" })
    expect(arenaView({ status: "disabled" })).toMatchObject({ tone: "muted", statusLabel: "Disabled" })
    expect(arenaView({ status: "not_git" })).toMatchObject({ tone: "error", statusLabel: "Requires a git repo" })
    expect(arenaView({ status: "no_base_commit" }).tone).toBe("error")
    expect(arenaView({ status: "dirty_worktree" }).statusLabel).toBe("Worktree not clean")
  })

  test("notes member errors, selection errors, and budget reasons", () => {
    const view = arenaView({
      status: "incomplete",
      selectionErrors: ["skipped x"],
      errorCount: 2,
      budgetReasons: ["cap"],
    })
    expect(view.notes).toEqual(["skipped x", "2 member errors", "cap"])
  })

  test("caps ranked ids but reports the true contestant count", () => {
    const rankedIds = Array.from({ length: 8 }, (_, index) => `provider/model-${index}`)
    const view = arenaView({ status: "ok", rankedIds })
    // The display cap must not inflate the count or inject a numbered sentinel.
    expect(view.ranked).toEqual(["model-0", "model-1", "model-2", "model-3", "model-4"])
    expect(view.rankedOverflow).toBe(3)
    expect(view.rankedLabel).toBe("8 contestants")
  })

  test("reports no overflow when every contestant fits", () => {
    const view = arenaView({ status: "ok", rankedIds: ["a", "b"] })
    expect(view.ranked).toEqual(["a", "b"])
    expect(view.rankedOverflow).toBe(0)
    expect(view.rankedLabel).toBe("2 contestants")
  })

  test("is defensive about non-object metadata and emits ASCII only", () => {
    for (const value of [null, undefined, "nope", 1, [], {}]) {
      const view = arenaView(value)
      expect(view).toMatchObject({ kind: "arena", tone: "muted", statusLabel: "Unknown", ranked: [] })
      expectAllAscii([
        view.statusLabel,
        view.modeLabel,
        view.strategyLabel,
        view.rankedLabel,
        ...view.ranked,
        ...view.notes,
      ])
    }
  })
})

describe("ensemble member identity", () => {
  test("preserves distinct providers and long names that share a display label", () => {
    const ids = ["first/model", "second/model", `provider/${"a".repeat(40)}1`, `provider/${"a".repeat(40)}2`]
    const council = councilView({ status: "ok", memberIds: ids })
    const arena = arenaView({ status: "ok", rankedIds: ids })
    expect(council.roster).toHaveLength(4)
    expect(arena.ranked).toHaveLength(4)
    expect(arena.rankedLabel).toBe("4 contestants")
    expect(arena.rankedOverflow).toBe(0)
  })

  test("deduplicates identical full IDs before counting and applying the cap", () => {
    const ids = ["first/model", "first/model", "second/model"]
    expect(councilView({ status: "ok", memberIds: ids }).roster).toHaveLength(2)
    const arena = arenaView({ status: "ok", rankedIds: ids })
    expect(arena.ranked).toHaveLength(2)
    expect(arena.rankedLabel).toBe("2 contestants")
  })
})
