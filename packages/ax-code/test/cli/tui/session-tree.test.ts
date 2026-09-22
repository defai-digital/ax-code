import { describe, expect, test, vi } from "vitest"
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

test("bounds retained subtree entries and node references across many roots", () => {
  const nodes = Array.from({ length: 512 }, (_, i) => ({
    id: `node-${i}`,
    parentID: i ? `node-${i - 1}` : undefined,
  }))
  const writes = vi.spyOn(Map.prototype, "set")
  let retained: Map<string, Set<string>>
  try {
    const index = createSessionTreeIndex(nodes)
    for (let i = 0; i < 128; i++) index.subtree(`node-${i}`)
    const cacheWrite = writes.mock.calls.findIndex(([key, value]) => key === "node-0" && value instanceof Set)
    retained = writes.mock.contexts[cacheWrite] as Map<string, Set<string>>
  } finally {
    writes.mockRestore()
  }
  expect(retained!.size).toBeLessThanOrEqual(64)
  expect([...retained!.values()].reduce((sum, ids) => sum + ids.size, 0)).toBeLessThanOrEqual(16_384)
})

test("evicted and oversized subtrees still return complete independent results", () => {
  const index = createSessionTreeIndex(sessions)
  index.subtree("root").clear()
  for (let i = 0; i < 100; i++) index.subtree(`unknown-${i}`)
  expect([...index.subtree("root")]).toEqual(["root", "child", "grandchild"])
  const large = createSessionTreeIndex(
    Array.from({ length: 17_000 }, (_, i) => ({
      id: `node-${i}`,
      parentID: i ? `node-${i - 1}` : undefined,
    })),
  )
  const first = large.subtree("node-0")
  expect(first.size).toBe(17_000)
  first.clear()
  expect(large.subtree("node-0").size).toBe(17_000)
})
