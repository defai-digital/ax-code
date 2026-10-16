import { describe, expect, test } from "vitest"
import { WriteIsolation } from "../../src/session/write-isolation"

function agent(name: string, rules: Array<{ permission: string; pattern: string; action: "allow" | "deny" | "ask" }>) {
  return { name, permission: rules }
}

describe("WriteIsolation.classifyAgentWriteClass", () => {
  test("explore is always read-only", () => {
    expect(
      WriteIsolation.classifyAgentWriteClass(agent("explore", [{ permission: "edit", pattern: "*", action: "allow" }])),
    ).toBe("read-only")
  })

  test("scout is always read-only", () => {
    expect(
      WriteIsolation.classifyAgentWriteClass(agent("scout", [{ permission: "bash", pattern: "*", action: "allow" }])),
    ).toBe("read-only")
  })

  test("deny-all with selective read tools is read-only", () => {
    const klass = WriteIsolation.classifyAgentWriteClass(
      agent("research", [
        { permission: "*", pattern: "*", action: "deny" },
        { permission: "read", pattern: "*", action: "allow" },
        { permission: "grep", pattern: "*", action: "allow" },
      ]),
    )
    expect(klass).toBe("read-only")
  })

  test("default allow agents are writers", () => {
    expect(
      WriteIsolation.classifyAgentWriteClass(agent("build", [{ permission: "*", pattern: "*", action: "allow" }])),
    ).toBe("writer")
  })
})

describe("WriteIsolation.evaluateParallelAgents", () => {
  test("allows all-explore parallel digs", () => {
    const decision = WriteIsolation.evaluateParallelAgents([
      agent("explore", [{ permission: "*", pattern: "*", action: "deny" }]),
      agent("explore", [{ permission: "*", pattern: "*", action: "deny" }]),
    ])
    expect(decision.ok).toBe(true)
    if (!decision.ok) throw new Error("expected ok")
    expect(decision.writers).toEqual([])
    expect(decision.readers).toEqual(["explore", "explore"])
  })

  test("allows a single writer with readers", () => {
    const decision = WriteIsolation.evaluateParallelAgents([
      agent("explore", [{ permission: "*", pattern: "*", action: "deny" }]),
      agent("build", [{ permission: "*", pattern: "*", action: "allow" }]),
    ])
    expect(decision.ok).toBe(true)
    if (!decision.ok) throw new Error("expected ok")
    expect(decision.writers).toEqual(["build"])
  })

  test("rejects multi-writer fan-out", () => {
    const decision = WriteIsolation.evaluateParallelAgents([
      agent("build", [{ permission: "*", pattern: "*", action: "allow" }]),
      agent("debug", [{ permission: "*", pattern: "*", action: "allow" }]),
    ])
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error("expected rejection")
    expect(decision.reason).toBe("multi_writer")
    expect(decision.message).toContain("concurrent writers")
  })

  test("rejects multi-writer fan-out even with allowWorktree when readers are present", () => {
    // allowWorktree lifts the multi-writer rejection only. Other call-site
    // gates (e.g. cross-provider ensemble, the worktree_isolation flag
    // being off) are not the policy layer's concern; this test only locks
    // the policy's own contract.
    const decision = WriteIsolation.evaluateParallelAgents(
      [
        agent("build", [{ permission: "*", pattern: "*", action: "allow" }]),
        agent("debug", [{ permission: "*", pattern: "*", action: "allow" }]),
        agent("explore", [{ permission: "*", pattern: "*", action: "deny" }]),
      ],
      { allowWorktree: true },
    )
    // Three agents: two writers + one reader. Worktree mode accepts the
    // multi-writer set; readers are dropped from the worktree set because
    // they share the main tree (the policy returns `readers: []` so the
    // call site doesn't accidentally route them through worktrees).
    expect(decision.ok).toBe(true)
    if (!decision.ok) throw new Error("expected ok with allowWorktree")
    expect(decision.mode).toBe("worktree")
    expect(decision.writers).toEqual(["build", "debug"])
    expect(decision.readers).toEqual([])
  })

  test("worktree opt-in returns mode: shared for single-writer and reader-only sets", () => {
    const singleWriter = WriteIsolation.evaluateParallelAgents(
      [agent("build", [{ permission: "*", pattern: "*", action: "allow" }])],
      { allowWorktree: true },
    )
    expect(singleWriter.ok).toBe(true)
    if (!singleWriter.ok) throw new Error("expected ok")
    expect(singleWriter.mode).toBe("shared")
    expect(singleWriter.writers).toEqual(["build"])

    const readersOnly = WriteIsolation.evaluateParallelAgents(
      [
        agent("explore", [{ permission: "*", pattern: "*", action: "deny" }]),
        agent("scout", [{ permission: "*", pattern: "*", action: "deny" }]),
      ],
      { allowWorktree: true },
    )
    expect(readersOnly.ok).toBe(true)
    if (!readersOnly.ok) throw new Error("expected ok")
    expect(readersOnly.mode).toBe("shared")
    expect(readersOnly.readers).toEqual(["explore", "scout"])
  })

  test("default off keeps multi-writer rejection byte-identical to the pre-ADR-231 contract", () => {
    // No `options` argument at all: behaviour must be unchanged.
    const noOptions = WriteIsolation.evaluateParallelAgents([
      agent("build", [{ permission: "*", pattern: "*", action: "allow" }]),
      agent("debug", [{ permission: "*", pattern: "*", action: "allow" }]),
    ])
    expect(noOptions.ok).toBe(false)
    // Explicit allowWorktree: false: same shape.
    const explicit = WriteIsolation.evaluateParallelAgents(
      [
        agent("build", [{ permission: "*", pattern: "*", action: "allow" }]),
        agent("debug", [{ permission: "*", pattern: "*", action: "allow" }]),
      ],
      { allowWorktree: false },
    )
    expect(explicit.ok).toBe(false)
  })
})
