import { describe, expect, test } from "vitest"
import { navigationLayout } from "../../../src/cli/cmd/tui/navigation/navigation-layout"
import { orderRootSessions, sessionNavigationEntries } from "../../../src/cli/cmd/tui/component/session-list-data"
import { computeSessionMainPaneWidth } from "../../../src/cli/cmd/tui/routes/session/layout"

const sessions = [
  { id: "root", time: { updated: 2 } },
  { id: "pinned", time: { updated: 1 } },
  { id: "child", parentID: "root", time: { updated: 4 } },
  { id: "deep", parentID: "child", time: { updated: 5 } },
]

describe("session navigation layout and entries", () => {
  test.each([50, 80, 120, 145, 146, 160, 200])("accounts for both docks at %i columns", (width) => {
    const layout = navigationLayout(width, true)
    expect(layout.railWidth).toBe(width >= 146 ? 24 : 0)
    expect(layout.contentWidth + layout.railWidth).toBe(width)
    const main = computeSessionMainPaneWidth({
      terminalWidth: layout.contentWidth,
      sidebarVisible: layout.contentWidth > 120,
    })
    expect(main).toBeGreaterThanOrEqual(width >= 146 ? 80 : 46)
    expect(navigationLayout(width, false)).toEqual({ railWidth: 0, contentWidth: width })
  })
  test("docked and dialog entries share root pin order and loaded descendants", () => {
    const roots = orderRootSessions(sessions, ["pinned"])
    const collapsed = sessionNavigationEntries(sessions, ["pinned"], new Set())
    expect(collapsed.map((row) => row.session.id)).toEqual(roots.map((session) => session.id))
    const expanded = sessionNavigationEntries(sessions, ["pinned"], "all")
    expect(expanded.map((row) => [row.session.id, row.depth])).toEqual([
      ["pinned", 0],
      ["root", 0],
      ["child", 1],
      ["deep", 2],
    ])
    expect(sessionNavigationEntries(sessions, [], new Set(["root"])).map((row) => row.session.id)).toEqual([
      "root",
      "child",
      "pinned",
    ])
  })
  test("keeps an orphan and its descendants reachable in the scoped workspace", () => {
    const orphan = [
      { id: "child", parentID: "other-workspace", time: { updated: 4 } },
      { id: "deep", parentID: "child", time: { updated: 5 } },
    ]
    expect(sessionNavigationEntries(orphan, [], "all").map((row) => [row.session.id, row.depth])).toEqual([
      ["child", 0],
      ["deep", 1],
    ])
  })
  test("cycles without a known root do not hang or invent a root session", () => {
    const cycle = [
      { id: "a", parentID: "b", time: { updated: 1 } },
      { id: "b", parentID: "a", time: { updated: 1 } },
    ]
    expect(sessionNavigationEntries(cycle, [], "all")).toEqual([])
  })
})
