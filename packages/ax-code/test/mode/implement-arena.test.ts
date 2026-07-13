import { describe, expect, test } from "vitest"
import { ImplementArena } from "../../src/mode/implement-arena"

describe("ImplementArena", () => {
  test("ranks pass above fail", () => {
    const ranked = ImplementArena.rank(
      [
        {
          id: "a/m",
          providerID: "a",
          modelID: "m",
          completed: true,
          verification: "fail",
          changedFiles: 1,
          riskScore: 1,
          patchFingerprint: "x",
        },
        {
          id: "b/n",
          providerID: "b",
          modelID: "n",
          completed: true,
          verification: "pass",
          changedFiles: 1,
          riskScore: 5,
          patchFingerprint: "y",
          worktreeDirectory: "/tmp/wt",
          worktreeBranch: "ax-code/arena",
        },
      ],
      "verify_first",
    )
    expect(ranked[0]!.id).toBe("b/n")
    expect(ranked[0]!.worktreeDirectory).toBe("/tmp/wt")
    expect(ranked[0]!.worktreeBranch).toBe("ax-code/arena")
  })

  test("renderMarkdown includes worktree paths", () => {
    const ranked = ImplementArena.rank([
      {
        id: "p/m",
        providerID: "p",
        modelID: "m",
        completed: true,
        verification: "pass",
        changedFiles: 1,
        worktreeDirectory: "/wt/1",
        baseCommit: "base123",
        commit: "commit456",
        summary: "done",
      },
    ])
    const md = ImplementArena.renderMarkdown({
      task: "fix foo",
      ranked,
      strategy: "verify_first",
    })
    expect(md).toContain("Implement arena")
    expect(md).toContain("/wt/1")
    expect(md).toContain("fix foo")
    expect(md).toContain("commit456")
    expect(md).toContain("base123..commit456")
  })

  test("cannot rank incomplete or empty-patch contestants as verified passers", () => {
    const ranked = ImplementArena.rank([
      {
        id: "incomplete",
        providerID: "a",
        modelID: "m",
        completed: false,
        verification: "pass",
        changedFiles: 1,
      },
      {
        id: "empty",
        providerID: "b",
        modelID: "n",
        completed: true,
        verification: "pass",
        changedFiles: 0,
      },
      {
        id: "unknown-patch",
        providerID: "c",
        modelID: "o",
        completed: true,
        verification: "pass",
      },
    ])

    expect(ranked.every((candidate) => candidate.verification === "fail")).toBe(true)
    expect(ImplementArena.renderMarkdown({ task: "fix it", ranked, strategy: "verify_first" })).toContain(
      "No verified winner",
    )
  })

  test("isolationForContestants uses worktree when N>1", () => {
    expect(ImplementArena.isolationForContestants(1)).toBe("shared")
    expect(ImplementArena.isolationForContestants(3)).toBe("worktree")
  })
})
