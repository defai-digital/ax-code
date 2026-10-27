import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import { afterEach, expect, test } from "vitest"
import { Instance } from "@/project/instance"
import { Worktree } from "@/worktree"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("removing the instance's own worktree deletes the AX Code-owned branch", async () => {
  await using tmp = await tmpdir({ git: true })

  const info = await Instance.provide({
    directory: tmp.path,
    fn: () => Worktree.create({ name: "self-remove" }),
  })
  expect(
    execFileSync("git", ["branch", "--list", "ax-code/self-remove"], { cwd: tmp.path, encoding: "utf8" }),
  ).toContain("ax-code/self-remove")

  await Instance.provide({
    directory: info.directory,
    fn: async () => {
      // This instance's own checkout is the linked worktree being removed,
      // while the project's recorded worktree is the primary checkout that
      // survives the removal.
      expect(Instance.worktree).not.toBe(Instance.project.worktree)
      await expect(Worktree.remove({ directory: info.directory })).resolves.toBe(true)
    },
  })

  await expect(fs.stat(info.directory)).rejects.toMatchObject({ code: "ENOENT" })
  expect(execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: tmp.path, encoding: "utf8" })).not.toContain(
    info.directory,
  )
  expect(execFileSync("git", ["branch", "--list", "ax-code/self-remove"], { cwd: tmp.path, encoding: "utf8" })).toBe("")
})
