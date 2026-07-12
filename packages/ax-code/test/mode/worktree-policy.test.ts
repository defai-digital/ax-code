import { describe, expect, test } from "vitest"
import { WorktreePolicy } from "../../src/mode/worktree-policy"

function agent(name: string, writer: boolean) {
  return {
    name,
    permission: writer
      ? [{ permission: "*", pattern: "*", action: "allow" as const }]
      : [
          { permission: "*", pattern: "*", action: "deny" as const },
          { permission: "read", pattern: "*", action: "allow" as const },
        ],
  }
}

describe("WorktreePolicy.evaluate", () => {
  test("allows multi-writer under worktree isolation", () => {
    const d = WorktreePolicy.evaluate({
      agents: [agent("build", true), agent("debug", true)],
      isolation: "worktree",
    })
    expect(d.ok).toBe(true)
    if (!d.ok) throw new Error("expected ok")
    expect(d.mode).toBe("worktree")
    expect(d.writers).toHaveLength(2)
  })

  test("rejects multi-writer on shared workspace", () => {
    const d = WorktreePolicy.evaluate({
      agents: [agent("build", true), agent("debug", true)],
      isolation: "shared",
    })
    expect(d.ok).toBe(false)
    if (d.ok) throw new Error("expected fail")
    expect(d.reason).toBe("multi_writer_needs_worktree")
  })

  test("allows all-explore on shared", () => {
    const d = WorktreePolicy.evaluate({
      agents: [agent("explore", false), agent("explore", false)],
      isolation: "shared",
    })
    expect(d.ok).toBe(true)
  })

  test("requiredWorktrees counts writers only for worktree mode", () => {
    expect(WorktreePolicy.requiredWorktrees(3, "worktree")).toBe(3)
    expect(WorktreePolicy.requiredWorktrees(3, "shared")).toBe(0)
  })
})
