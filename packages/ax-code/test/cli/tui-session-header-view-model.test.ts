import { describe, expect, test } from "bun:test"
import { collapseSessionBreadcrumbs, sessionBreadcrumbs } from "../../src/cli/cmd/tui/routes/session/header-view-model"

describe("tui session header view model", () => {
  test("orders breadcrumbs from root to current session", () => {
    expect(
      sessionBreadcrumbs(
        [
          { id: "root", title: "Root", parentID: null },
          { id: "child", title: "Child", parentID: "root" },
          { id: "grandchild", title: "Grandchild", parentID: "child" },
        ],
        "grandchild",
      ),
    ).toEqual([
      { kind: "session", id: "root", label: "Root", current: false },
      { kind: "session", id: "child", label: "Child", current: false },
      { kind: "session", id: "grandchild", label: "Grandchild", current: true },
    ])
  })

  test("falls back to a short session label when title is missing", () => {
    expect(sessionBreadcrumbs([{ id: "ses_abcdef123456", parentID: null }], "ses_abcdef123456")).toEqual([
      { kind: "session", id: "ses_abcdef123456", label: "Session 123456", current: true },
    ])
  })

  test("collapses middle ancestors on narrow layouts", () => {
    expect(
      collapseSessionBreadcrumbs(
        [
          { kind: "session", id: "root", label: "Root", current: false },
          { kind: "session", id: "a", label: "A", current: false },
          { kind: "session", id: "b", label: "B", current: false },
          { kind: "session", id: "c", label: "C", current: false },
          { kind: "session", id: "d", label: "D", current: true },
        ],
        { narrow: true },
      ),
    ).toEqual([
      { kind: "session", id: "root", label: "Root", current: false },
      { kind: "ellipsis", id: "ellipsis", label: "...", current: false },
      { kind: "session", id: "c", label: "C", current: false },
      { kind: "session", id: "d", label: "D", current: true },
    ])
  })
})
