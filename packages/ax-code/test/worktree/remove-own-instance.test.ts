import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import { afterEach, expect, test } from "vitest"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Worktree } from "@/worktree"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("removing the instance's own worktree disposes it before deleting the checkout and branch", async () => {
  await using tmp = await tmpdir({ git: true })

  const info = await Instance.provide({
    directory: tmp.path,
    fn: () => Worktree.create({ name: "self-remove" }),
  })
  expect(
    execFileSync("git", ["branch", "--list", "ax-code/self-remove"], { cwd: tmp.path, encoding: "utf8" }),
  ).toContain("ax-code/self-remove")

  let checkoutPresentDuringDisposal: boolean | undefined
  const observeDisposal = Instance.state(
    () => undefined,
    async () => {
      checkoutPresentDuringDisposal = await Filesystem.isDir(info.directory)
    },
  )
  await Instance.provide({
    directory: info.directory,
    fn: async () => {
      // This instance's own checkout is the linked worktree being removed,
      // while the project's recorded worktree is the primary checkout that
      // survives the removal.
      expect(Instance.worktree).not.toBe(Instance.project.worktree)
      observeDisposal()
      await expect(Worktree.remove({ directory: info.directory })).resolves.toBe(true)
    },
  })

  expect(checkoutPresentDuringDisposal).toBe(true)
  expect(Instance.list()).not.toContain(info.directory)
  await expect(fs.stat(info.directory)).rejects.toMatchObject({ code: "ENOENT" })
  expect(execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: tmp.path, encoding: "utf8" })).not.toContain(
    info.directory,
  )
  expect(execFileSync("git", ["branch", "--list", "ax-code/self-remove"], { cwd: tmp.path, encoding: "utf8" })).toBe("")
})

test("refusing to remove the primary checkout keeps its instance available", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Worktree.remove({ directory: tmp.path })).rejects.toMatchObject({
        name: "WorktreeRemoveFailedError",
      })
      expect(Instance.list()).toContain(Instance.directory)
      expect(await Filesystem.isDir(tmp.path)).toBe(true)
    },
  })
})
