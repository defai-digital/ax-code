import { execFileSync } from "child_process"
import { afterEach, expect, test } from "vitest"
import { Instance } from "@/project/instance"
import { Worktree } from "@/worktree"
import { tmpdir } from "../fixture/fixture"

// ADR-260: client-chosen branch, start ref, borrowed existing branch and
// operation-ID idempotency for worktree.create.

afterEach(async () => {
  await Instance.disposeAll()
})

const gitOut = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()

const branches = (cwd: string) =>
  gitOut(cwd, ["branch", "--list", "--format=%(refname:short)"]).split("\n").filter(Boolean)

test("creates a caller-named branch from a chosen start ref", async () => {
  await using tmp = await tmpdir({ git: true })
  const base = gitOut(tmp.path, ["rev-parse", "HEAD"])
  execFileSync("git", ["commit", "--allow-empty", "-m", "second"], { cwd: tmp.path, stdio: "pipe" })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const info = await Worktree.create({ name: "feature", branch: "feature/login", startRef: base })
      expect(info.branch).toBe("feature/login")
      expect(gitOut(tmp.path, ["rev-parse", "feature/login"])).toBe(base)
      await Worktree.remove({ directory: info.directory })
      // The runtime created this branch, so removal deletes it.
      expect(branches(tmp.path)).not.toContain("feature/login")
    },
  })
})

test("rejects a caller-named branch that already exists instead of renaming it", async () => {
  await using tmp = await tmpdir({ git: true })
  execFileSync("git", ["branch", "taken"], { cwd: tmp.path, stdio: "pipe" })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Worktree.create({ name: "x", branch: "taken" })).rejects.toMatchObject({
        name: "WorktreeCreateFailedError",
      })
    },
  })
})

test("borrows an existing branch and never deletes or resets it", async () => {
  await using tmp = await tmpdir({ git: true })
  execFileSync("git", ["branch", "user-work"], { cwd: tmp.path, stdio: "pipe" })
  const tip = gitOut(tmp.path, ["rev-parse", "user-work"])

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const info = await Worktree.create({ name: "review", existingBranch: "user-work" })
      expect(info.branch).toBe("user-work")
      expect(await Worktree.borrowedBranch(info.directory)).toBe("user-work")

      await expect(Worktree.reset({ directory: info.directory })).rejects.toMatchObject({
        name: "WorktreeResetFailedError",
      })

      await Worktree.remove({ directory: info.directory })
      expect(branches(tmp.path)).toContain("user-work")
      expect(gitOut(tmp.path, ["rev-parse", "user-work"])).toBe(tip)
      expect(await Worktree.borrowedBranch(info.directory)).toBeUndefined()
    },
  })
})

test("rejects invalid branch choices", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Worktree.create({ existingBranch: "missing" })).rejects.toThrow(/does not exist/)
      await expect(Worktree.create({ branch: "bad..name" })).rejects.toThrow(/Invalid branch name/)
      await expect(Worktree.create({ existingBranch: "main", startRef: "HEAD" })).rejects.toThrow(/cannot be combined/)
      // Schema validation throws synchronously from the fn wrapper.
      expect(() => Worktree.create({ branch: "-x" })).toThrow()
    },
  })
})

test("repeating a create with the same operation ID returns the first worktree", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const [first, concurrent] = await Promise.all([
        Worktree.create({ name: "op", operationId: "op-1" }),
        Worktree.create({ name: "op", operationId: "op-1" }),
      ])
      const later = await Worktree.create({ name: "op", operationId: "op-1" })
      expect(concurrent).toEqual(first)
      expect(later).toEqual(first)

      const other = await Worktree.create({ name: "op", operationId: "op-2" })
      expect(other.directory).not.toBe(first.directory)

      await Worktree.remove({ directory: first.directory })
      await Worktree.remove({ directory: other.directory })
    },
  })
})

test("a failed create can be retried with the same operation ID", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Worktree.create({ existingBranch: "later", operationId: "retry" })).rejects.toThrow()
      execFileSync("git", ["branch", "later"], { cwd: tmp.path, stdio: "pipe" })
      const info = await Worktree.create({ existingBranch: "later", operationId: "retry" })
      expect(info.branch).toBe("later")
      await Worktree.remove({ directory: info.directory })
      expect(branches(tmp.path)).toContain("later")
    },
  })
})

test("a borrowed branch is protected even when its name has the ax-code/ prefix", async () => {
  await using tmp = await tmpdir({ git: true })
  execFileSync("git", ["branch", "ax-code/mine"], { cwd: tmp.path, stdio: "pipe" })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const info = await Worktree.create({ name: "mine", existingBranch: "ax-code/mine" })
      expect(await Worktree.ownsBranch("ax-code/mine")).toBe(false)
      await Worktree.remove({ directory: info.directory })
      expect(branches(tmp.path)).toContain("ax-code/mine")
    },
  })
})

test("only branches AX Code created count as owned", async () => {
  await using tmp = await tmpdir({ git: true })
  execFileSync("git", ["branch", "user-branch"], { cwd: tmp.path, stdio: "pipe" })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const info = await Worktree.create({ name: "owned", branch: "team/owned" })
      expect(await Worktree.ownsBranch("team/owned")).toBe(true)
      expect(await Worktree.ownsBranch("user-branch")).toBe(false)
      expect(await Worktree.ownsBranch("ax-code/legacy")).toBe(true)
      expect(await Worktree.ownsBranch(undefined)).toBe(false)
      await Worktree.remove({ directory: info.directory })
      expect(branches(tmp.path)).not.toContain("team/owned")
    },
  })
})

test("a branch copied from an owned branch is not owned", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const info = await Worktree.create({ name: "gen", branch: "team/generated" })
      // `git branch -c` copies branch config, including the owned flag.
      execFileSync("git", ["branch", "-c", "team/generated", "my-work"], { cwd: tmp.path, stdio: "pipe" })
      expect(await Worktree.ownsBranch("team/generated")).toBe(true)
      expect(await Worktree.ownsBranch("my-work")).toBe(false)
      await Worktree.remove({ directory: info.directory })
    },
  })
})

test("an unreadable borrowed flag denies ownership even for prefixed branches", async () => {
  await using tmp = await tmpdir({ git: true })
  execFileSync("git", ["branch", "ax-code/odd"], { cwd: tmp.path, stdio: "pipe" })
  // A flag whose value does not name its branch is not trusted either way.
  execFileSync("git", ["config", "branch.ax-code/odd.axCodeBorrowed", "something-else"], {
    cwd: tmp.path,
    stdio: "pipe",
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await Worktree.ownsBranch("ax-code/odd")).toBe(false)
    },
  })
})

test("an operation ID reused for a different worktree is rejected", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const first = await Worktree.create({ name: "a", operationId: "same" })
      await expect(Worktree.create({ name: "b", operationId: "same" })).rejects.toThrow(/already used/)
      await Worktree.remove({ directory: first.directory })
      // After removal the ID no longer returns the deleted worktree.
      const again = await Worktree.create({ name: "a", operationId: "same" })
      expect(gitOut(tmp.path, ["worktree", "list", "--porcelain"])).toContain(again.directory)
      await Worktree.remove({ directory: again.directory })
    },
  })
})

test("a refused borrow does not leave the branch marked borrowed", async () => {
  await using tmp = await tmpdir({ git: true })
  const current = gitOut(tmp.path, ["symbolic-ref", "--short", "HEAD"])

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // git refuses a branch that is already checked out in the primary worktree.
      await expect(Worktree.create({ name: "dup", existingBranch: current })).rejects.toThrow()
      expect(() => gitOut(tmp.path, ["config", "--get", `branch.${current}.axCodeBorrowed`])).toThrow()
    },
  })
})
