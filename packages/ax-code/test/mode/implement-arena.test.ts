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
          riskScore: 1,
          patchFingerprint: "x",
        },
        {
          id: "b/n",
          providerID: "b",
          modelID: "n",
          completed: true,
          verification: "pass",
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
        worktreeDirectory: "/wt/1",
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
  })

  test("isolationForContestants uses worktree when N>1", () => {
    expect(ImplementArena.isolationForContestants(1)).toBe("shared")
    expect(ImplementArena.isolationForContestants(3)).toBe("worktree")
  })
})
