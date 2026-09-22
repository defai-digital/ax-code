import { describe, expect, test, vi } from "vitest"
import {
  activeNavigationSessions,
  confirmNavigationClear,
  NAVIGATION_CLEAR_MESSAGE,
  projectLabel,
  navigationClearedAt,
  navigationFilter,
  visibleAfterNavigationClear,
} from "../../../src/cli/tui/navigation/navigation-model"
import { NAVIGATION_CONTENT_MIN_WIDTH, navigationLayout } from "../../../src/cli/tui/navigation/navigation-layout"

const sessions = [
  { id: "root", time: { updated: 1 } },
  { id: "child", parentID: "root", time: { updated: 2 } },
  { id: "deep", parentID: "child", time: { updated: 3 } },
  { id: "idle", time: { updated: 4 } },
  { id: "current", time: { updated: 5 } },
]
const base = { sessions, statuses: {}, permissions: {}, questions: {}, observed: true }

describe("navigation scope and active filter", () => {
  test("keeps an active grandchild's whole tree and the current idle tree", () => {
    expect(
      activeNavigationSessions({ ...base, statuses: { deep: { type: "retry" } }, currentID: "current" }).map(
        (s) => s.id,
      ),
    ).toEqual(["root", "child", "deep", "current"])
  })
  test("attention counts as active without an accompanying busy status", () => {
    expect(
      activeNavigationSessions({ ...base, questions: { deep: [{ id: "q", sessionID: "deep" }] } }).map((s) => s.id),
    ).toEqual(["root", "child", "deep"])
  })
  test("unknown and idle do not become active; disconnected data stays browsable", () => {
    expect(activeNavigationSessions(base)).toEqual([])
    expect(activeNavigationSessions({ ...base, observed: false })).toEqual(sessions)
  })
  test("a viewed child keeps its parent tree, including when its parent is unloaded", () => {
    expect(activeNavigationSessions({ ...base, currentID: "deep" }).map((s) => s.id)).toEqual(["root", "child", "deep"])
    expect(
      activeNavigationSessions({ ...base, sessions: sessions.slice(1), currentID: "deep" }).map((s) => s.id),
    ).toEqual(["child", "deep"])
  })
  test.each([
    ["/code/ax-code/", "ax-code"],
    ["C:\\code\\ax-code\\", "ax-code"],
    ["/", "/"],
    [undefined, "Workspace unavailable"],
  ])("labels project %s without assuming the host path separator", (directory, expected) =>
    expect(projectLabel(directory)).toBe(expected),
  )
  test("missing or invalid stored filters fall back to active", () => {
    expect(navigationFilter("active")).toBe("active")
    expect(navigationFilter({ active: true })).toBe("active")
    expect(navigationFilter(undefined)).toBe("active")
    expect(navigationFilter("recent")).toBe("recent")
  })
})

describe("navigation rail clear", () => {
  test("ignores malformed cutoffs", () => {
    expect(navigationClearedAt("10")).toBe(0)
    expect(navigationClearedAt(-1)).toBe(0)
    expect(navigationClearedAt(Number.NaN)).toBe(0)
    expect(visibleAfterNavigationClear({ ...base, clearedAt: "10" }).map((session) => session.id)).toEqual(
      sessions.map((session) => session.id),
    )
  })
  test("hides older rows and keeps the current tree", () => {
    expect(
      visibleAfterNavigationClear({ ...base, clearedAt: 4, currentID: "current" }).map((session) => session.id),
    ).toEqual(["current"])
    expect(
      visibleAfterNavigationClear({ ...base, clearedAt: 10, currentID: "deep" }).map((session) => session.id),
    ).toEqual(["root", "child", "deep"])
  })
  test("keeps pinned trees and observed working sessions after a clear", () => {
    expect(
      visibleAfterNavigationClear({ ...base, clearedAt: 10, pinned: ["idle"] }).map((session) => session.id),
    ).toEqual(["idle"])
    expect(
      visibleAfterNavigationClear({
        ...base,
        clearedAt: 10,
        statuses: { deep: { type: "busy" } },
        observed: true,
      }).map((session) => session.id),
    ).toEqual(["root", "child", "deep"])
  })
  test("does not resurrect the full cached list while disconnected", () => {
    expect(
      visibleAfterNavigationClear({ ...base, clearedAt: 10, currentID: "current", observed: false }).map(
        (session) => session.id,
      ),
    ).toEqual(["current"])
  })
  test("applies the cutoff only after confirmation", async () => {
    const apply = vi.fn()
    expect(await confirmNavigationClear({ ask: async () => undefined, apply, now: 99 })).toBe(false)
    expect(await confirmNavigationClear({ ask: async () => false, apply, now: 99 })).toBe(false)
    expect(apply).not.toHaveBeenCalled()
    expect(await confirmNavigationClear({ ask: async () => true, apply, now: 99 })).toBe(true)
    expect(apply).toHaveBeenCalledExactlyOnceWith(99)
    expect(NAVIGATION_CLEAR_MESSAGE).toContain("clear the navigation bar history")
    expect(NAVIGATION_CLEAR_MESSAGE).toContain("Are you sure")
  })
})

describe("preferred navigation width", () => {
  test.each([26, 28, 30, 32, 34, 36, 38])("preserves the content minimum with preferred width %i", (preferred) => {
    for (const width of [145, 146, 147, 150, 152, 158, 160, 200]) {
      const layout = navigationLayout(width, true, preferred)
      expect(layout.railWidth).toBe(width < 146 ? 0 : Math.min(preferred, width - NAVIGATION_CONTENT_MIN_WIDTH))
      expect(layout.contentWidth).toBeGreaterThanOrEqual(NAVIGATION_CONTENT_MIN_WIDTH)
    }
    expect(navigationLayout(200, false, preferred)).toEqual({ railWidth: 0, contentWidth: 200 })
  })
  test.each([null, "36", NaN, Infinity, -30, 500, 25])("ignores malformed persisted width %s", (value) => {
    expect(navigationLayout(160, true, value).railWidth).toBe(28)
  })
})

describe("current navigation path", () => {
  test("adds only ancestors, retains manual expansion, and leaves inputs unchanged", async () => {
    const { navigationExpandedAncestors } = await import("../../../src/cli/tui/navigation/navigation-model")
    const expanded = new Set(["unrelated"])
    expect([...navigationExpandedAncestors(sessions, "deep", expanded)]).toEqual(["unrelated", "child", "root"])
    expect([...expanded]).toEqual(["unrelated"])
    expect([...navigationExpandedAncestors(sessions, "missing", expanded)]).toEqual(["unrelated"])
  })
  test("terminates on malformed cyclic parents and tolerates unloaded parents", async () => {
    const { navigationExpandedAncestors } = await import("../../../src/cli/tui/navigation/navigation-model")
    expect(
      navigationExpandedAncestors(
        [
          { id: "a", parentID: "b" },
          { id: "b", parentID: "a" },
        ],
        "a",
        new Set(),
      ).size,
    ).toBe(2)
    expect(navigationExpandedAncestors([{ id: "a", parentID: "missing" }], "a", new Set()).size).toBe(0)
  })
})
