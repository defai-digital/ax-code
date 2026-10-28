import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Worktree } from "@/worktree"
import * as GitUtil from "@/util/git"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("retains the sandbox when cleanup fails after Git detaches the worktree", async () => {
  await using tmp = await tmpdir({ git: true })
  await using external = await tmpdir()
  const directory = path.join(external.path, "DetachedWorktree")
  const git = (...args: string[]) => execFileSync("git", args, { cwd: tmp.path, encoding: "utf8", stdio: "pipe" })
  git("worktree", "add", "-b", "ax-code/cleanup-recovery", directory)

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Project.addSandbox(Instance.project.id, directory)
        const recorded = await Project.sandboxes(Instance.project.id)
        expect(recorded).toHaveLength(1)
        const realRm = fs.rm.bind(fs)
        const rm = vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
          if (path.resolve(String(target)).toLowerCase() !== directory.toLowerCase()) return realRm(target, options)
          // Simulate a file appearing after Git detached the worktree, followed
          // by a lock preventing the remaining directory from being removed.
          await fs.mkdir(directory, { recursive: true })
          await fs.writeFile(path.join(directory, "locked.txt"), "remaining file\n")
          throw new Error("simulated file lock after Git removal")
        })
        try {
          await expect(Worktree.remove({ directory })).rejects.toMatchObject({ name: "WorktreeRemoveFailedError" })
          expect(git("worktree", "list", "--porcelain")).not.toContain(directory)
          expect(git("branch", "--list", "ax-code/cleanup-recovery").trim()).toBe("")
          expect(await Project.sandboxes(Instance.project.id)).toEqual(recorded)
        } finally {
          rm.mockRestore()
        }

        await expect(Worktree.remove({ directory })).resolves.toBe(true)
        await expect(fs.stat(directory)).rejects.toMatchObject({ code: "ENOENT" })
        expect(Project.get(Instance.project.id)?.sandboxes).toEqual([])
      },
    })
  } finally {
    git("worktree", "prune")
  }
})

test.each(["lowercase", "MixedCase"])("retains a %s recorded leftover until cleanup succeeds", async (name) => {
  await using tmp = await tmpdir({ git: true })
  await using external = await tmpdir()
  const requested = path.join(external.path, name)
  const leftover =
    name === "lowercase" && (process.platform === "win32" || process.platform === "darwin")
      ? requested.toLowerCase()
      : requested
  await fs.mkdir(leftover)
  const canary = path.join(leftover, "canary.txt")
  await fs.writeFile(canary, "pending cleanup\n")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Project.addSandbox(Instance.project.id, leftover)
      const recorded = await Project.sandboxes(Instance.project.id)
      expect(recorded).toHaveLength(1)
      const realRm = fs.rm.bind(fs)
      const rm = vi.spyOn(fs, "rm").mockImplementation((target, options) => {
        if (path.resolve(String(target)).toLowerCase() === leftover.toLowerCase())
          return Promise.reject(new Error("simulated file lock"))
        return realRm(target, options)
      })
      try {
        await expect(Worktree.remove({ directory: leftover })).rejects.toMatchObject({
          name: "WorktreeRemoveFailedError",
        })
        expect(await fs.readFile(canary, "utf8")).toBe("pending cleanup\n")
        expect(await Project.sandboxes(Instance.project.id)).toEqual(recorded)
      } finally {
        rm.mockRestore()
      }

      await expect(Worktree.remove({ directory: leftover })).resolves.toBe(true)
      await expect(fs.stat(leftover)).rejects.toMatchObject({ code: "ENOENT" })
      expect(Project.get(Instance.project.id)?.sandboxes).toEqual([])
    },
  })
})

test("reset falls back to the primary checkout's branch when no remote or main/master exists", async () => {
  await using tmp = await tmpdir()
  const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" })
  run(tmp.path, "init", "-b", "trunk")
  run(tmp.path, "config", "user.email", "test@example.com")
  run(tmp.path, "config", "user.name", "test")
  run(tmp.path, "commit", "--allow-empty", "-m", "init")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const info = await Worktree.create({ name: "trunk-reset" })
      await fs.writeFile(path.join(info.directory, "dirty.txt"), "local change\n")

      // Pre-fix this threw "Default branch not found": a local-only repo whose
      // primary branch is neither main nor master had no resolvable target.
      await expect(Worktree.reset({ directory: info.directory })).resolves.toBeTruthy()
      await expect(fs.stat(path.join(info.directory, "dirty.txt"))).rejects.toMatchObject({ code: "ENOENT" })
    },
  })
})

test("removing a user's linked worktree keeps its branch, even when recorded", async () => {
  await using tmp = await tmpdir({ git: true })
  await using external = await tmpdir()
  const directory = path.join(external.path, "feature-tree")
  const git = (...args: string[]) => execFileSync("git", args, { cwd: tmp.path, encoding: "utf8", stdio: "pipe" })
  git("worktree", "add", "-b", "feature", directory)
  execFileSync("git", ["commit", "--allow-empty", "-m", "unmerged work"], { cwd: directory, stdio: "pipe" })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Project.addSandbox(Instance.project.id, directory)
      await expect(Worktree.remove({ directory })).resolves.toBe(true)
      expect(git("worktree", "list", "--porcelain")).not.toContain(directory)
      expect(git("branch", "--list", "feature").trim()).toBe("feature")
    },
  })
})

test("reset from inside a sandbox targets the primary checkout's branch", async () => {
  await using tmp = await tmpdir()
  const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" })
  run(tmp.path, "init", "-b", "trunk")
  run(tmp.path, "config", "user.email", "test@example.com")
  run(tmp.path, "config", "user.name", "test")
  run(tmp.path, "commit", "--allow-empty", "-m", "init")
  const trunk = run(tmp.path, "rev-parse", "HEAD").trim()

  const info = await Instance.provide({
    directory: tmp.path,
    fn: () => Worktree.createReady({ name: "inner-reset" }),
  })
  run(info.directory, "commit", "--allow-empty", "-m", "sandbox work")
  expect(run(info.directory, "rev-parse", "HEAD").trim()).not.toBe(trunk)

  await Instance.provide({
    directory: info.directory,
    fn: async () => {
      await expect(Worktree.reset({ directory: info.directory })).resolves.toBeTruthy()
    },
  })
  expect(run(info.directory, "rev-parse", "HEAD").trim()).toBe(trunk)
})

test.skipIf(process.platform === "win32")(
  "pruning a git clean leftover removes a symlink without following it",
  async () => {
    await using tmp = await tmpdir()
    const tracked = path.join(tmp.path, "packages")
    await fs.mkdir(tracked)
    await fs.writeFile(path.join(tracked, "keep.txt"), "tracked\n")
    await fs.symlink(tracked, path.join(tmp.path, "evil-link"))
    await fs.writeFile(path.join(tmp.path, "stale.txt"), "untracked\n")

    await Worktree.prune(tmp.path, ["evil-link", "stale.txt", "..", "."])

    await expect(fs.lstat(path.join(tmp.path, "evil-link"))).rejects.toMatchObject({ code: "ENOENT" })
    await expect(fs.stat(path.join(tmp.path, "stale.txt"))).rejects.toMatchObject({ code: "ENOENT" })
    expect(await fs.readFile(path.join(tracked, "keep.txt"), "utf8")).toBe("tracked\n")
  },
)

test("treats a worktree branch deleted by a concurrent remover as removed", async () => {
  await using tmp = await tmpdir({ git: true })
  await using external = await tmpdir()
  const directory = path.join(external.path, "RacedWorktree")
  const git = (...args: string[]) => execFileSync("git", args, { cwd: tmp.path, encoding: "utf8", stdio: "pipe" })
  git("worktree", "add", "-b", "ax-code/raced-remove", directory)

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Project.addSandbox(Instance.project.id, directory)
        const real = GitUtil.git
        const spy = vi.spyOn(GitUtil, "git").mockImplementation(async (args, options) => {
          // Another remover deletes the branch just before this one does.
          if (args[0] === "branch" && args[1] === "-D") git("branch", "-D", args[2]!)
          return real(args, options)
        })
        try {
          await expect(Worktree.remove({ directory })).resolves.toBe(true)
        } finally {
          spy.mockRestore()
        }
        expect(git("branch", "--list", "ax-code/raced-remove").trim()).toBe("")
        expect(Project.get(Instance.project.id)?.sandboxes).toEqual([])
      },
    })
  } finally {
    git("worktree", "prune")
  }
})

test("removes a managed worktree whose directory vanished and was pruned", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const info = await Worktree.create({ name: "vanished" })
      await fs.rm(info.directory, { recursive: true, force: true })
      execFileSync("git", ["worktree", "prune"], { cwd: tmp.path, stdio: "pipe" })

      // The data root can sit under a symlinked ancestor (macOS /var →
      // /private/var); the missing directory must still be recognized as
      // living under the managed root.
      await expect(Worktree.remove({ directory: info.directory })).resolves.toBe(true)
    },
  })
})
