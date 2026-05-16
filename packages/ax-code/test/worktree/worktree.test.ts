import { $ } from "bun"
import { afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("create removes the preallocated directory when git worktree add fails", async () => {
  await using tmp = await tmpdir()
  await $`git init`.cwd(tmp.path).quiet()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Worktree.create({ name: "orphan-cleanup" })).rejects.toThrow()

      const projectRoot = path.join(Global.Path.data, "worktree", Instance.project.id)
      await expect(fs.stat(path.join(projectRoot, "orphan-cleanup"))).rejects.toThrow()
    },
  })
})
