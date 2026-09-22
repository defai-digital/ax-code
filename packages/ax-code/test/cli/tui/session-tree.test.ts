import { describe, expect, test } from "vitest"
import { createSessionTreeIndex } from "../../../src/cli/tui/util/session-tree"
import {
  hasActiveSubagentInSessionTree,
  footerSubagentStatusView,
} from "../../../src/cli/tui/routes/session/footer-view-model"

const sessions = [
  { id: "root" },
  { id: "child", parentID: "root" },
  { id: "grandchild", parentID: "child" },
  { id: "other" },
]

describe("session subtree", () => {
  test("includes descendants but never a sibling or ancestor", () => {
    const index = createSessionTreeIndex(sessions)
    expect([...index.subtree("root")]).toEqual(["root", "child", "grandchild"])
    expect([...index.subtree("child")]).toEqual(["child", "grandchild"])
    expect([...index.subtree(undefined)]).toEqual([])
  })

  test("supports an unloaded root and terminates cycles and duplicate nodes", () => {
    expect([...createSessionTreeIndex([{ id: "child", parentID: "missing" }]).subtree("missing")]).toEqual([
      "missing",
      "child",
    ])
    const index = createSessionTreeIndex([
      { id: "a", parentID: "b" },
      { id: "b", parentID: "a" },
      { id: "b", parentID: "a" },
    ])
    expect([...index.subtree("a")]).toEqual(["a", "b"])
  })

  test("a busy grandchild keeps recap and Finished unsettled and appears in the footer count", () => {
    const input = {
      sessions,
      statuses: { root: { type: "idle" as const }, grandchild: { type: "busy" as const } },
      parentSessionID: "root",
    }
    expect(hasActiveSubagentInSessionTree(input)).toBe(true)
    expect(footerSubagentStatusView(input)?.running).toBe(1)
    expect(hasActiveSubagentInSessionTree({ ...input, parentSessionID: "other" })).toBe(false)
  })
})

test("repeated subtree reads return equal but independent sets", () => {
  const index = createSessionTreeIndex([
    { id: "root" },
    { id: "child", parentID: "root" },
    { id: "grandchild", parentID: "child" },
  ])
  const first = index.subtree("root")
  first.delete("root")
  const second = index.subtree("root")
  expect([...second].sort()).toEqual(["child", "grandchild", "root"])
  expect(second).not.toBe(first)
})
