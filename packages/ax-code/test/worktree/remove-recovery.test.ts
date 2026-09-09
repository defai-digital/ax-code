import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Worktree } from "@/worktree"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("retains the sandbox when cleanup fails after Git detaches the worktree", async () => {
  await using tmp = await tmpdir({ git: true })
  await using external = await tmpdir()
  const directory = path.join(external.path, "DetachedWorktree")
  const git = (...args: string[]) => execFileSync("git", args, { cwd: tmp.path, encoding: "utf8", stdio: "pipe" })
  git("worktree", "add", "-b", "cleanup-recovery", directory)

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
          expect(git("branch", "--list", "cleanup-recovery").trim()).toBe("")
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
