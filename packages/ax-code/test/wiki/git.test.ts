import { writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "vitest"
import { gitHeadCommit, gitWorktreeDirty } from "../../src/wiki/git"
import { tmpdir } from "../fixture/fixture"

test("Wiki Git probes distinguish committed, clean, and untracked source state", async () => {
  await using tmp = await tmpdir({ git: true })
  const head = await gitHeadCommit(tmp.path)
  expect(head).toMatch(/^[a-f0-9]{40,64}$/)
  expect(await gitWorktreeDirty(tmp.path)).toBe(false)

  await writeFile(path.join(tmp.path, "source.ts"), "export const value = 1\n")
  expect(await gitWorktreeDirty(tmp.path)).toBe(true)
  expect(await gitHeadCommit(tmp.path)).toBe(head)
})

test("unavailable Git evidence never attests a clean snapshot", async () => {
  await using tmp = await tmpdir()
  for (const root of [tmp.path, path.join(tmp.path, "missing")]) {
    expect(await gitHeadCommit(root)).toBeUndefined()
    expect(await gitWorktreeDirty(root)).toBe(true)
  }
})
