import { describe, expect, test } from "vitest"
import {
  activeNavigationSessions,
  projectLabel,
  navigationFilter,
} from "../../../src/cli/cmd/tui/navigation/navigation-model"
import { navigationLayout } from "../../../src/cli/cmd/tui/navigation/navigation-layout"

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
  test("invalid stored filters fall back to recent", () => {
    expect(navigationFilter("active")).toBe("active")
    expect(navigationFilter({ active: true })).toBe("recent")
  })
})

describe("preferred navigation width", () => {
  test.each([24, 30, 36])("preserves the content minimum with preferred width %i", (preferred) => {
    for (const width of [145, 146, 147, 150, 152, 158, 160, 200]) {
      const layout = navigationLayout(width, true, preferred)
      expect(layout.railWidth).toBe(width < 146 ? 0 : Math.min(preferred, width - 122))
      expect(layout.contentWidth).toBeGreaterThanOrEqual(122)
    }
    expect(navigationLayout(200, false, preferred)).toEqual({ railWidth: 0, contentWidth: 200 })
  })
  test.each([null, "36", NaN, Infinity, -30, 500, 25])("ignores malformed persisted width %s", (value) => {
    expect(navigationLayout(160, true, value).railWidth).toBe(24)
  })
})
