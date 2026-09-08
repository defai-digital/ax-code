import { expect, test } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { currentSourceState } from "../../src/quality/source-state"
import { git } from "../../src/util/git"
import { tmpdir } from "../fixture/fixture"

test("source fingerprints change when an already dirty file changes again", async () => {
  await using tmp = await tmpdir({ git: true })
  const file = path.join(tmp.path, "logic.ts")
  await fs.writeFile(file, "export const value = 1\n")
  expect((await git(["add", "logic.ts"], { cwd: tmp.path })).exitCode).toBe(0)
  expect((await git(["commit", "-m", "Add logic"], { cwd: tmp.path })).exitCode).toBe(0)
  await fs.writeFile(file, "export const value = 2\n")
  const before = await currentSourceState(tmp.path, "git")
  await fs.writeFile(file, "export const value = 3\n")
  const after = await currentSourceState(tmp.path, "git")
  expect(before.available).toBe(true)
  expect(after.available).toBe(true)
  expect(after.dirtyDigest).not.toBe(before.dirtyDigest)
})

test("untracked content, additions and removals invalidate source fingerprints", async () => {
  await using tmp = await tmpdir({ git: true })
  await fs.mkdir(path.join(tmp.path, "new"))
  const file = path.join(tmp.path, "new/config.json")
  await fs.writeFile(file, '{"enabled":true}')
  const first = await currentSourceState(tmp.path, "git")
  await fs.writeFile(file, '{"enabled":false}')
  const second = await currentSourceState(tmp.path, "git")
  await fs.unlink(file)
  const third = await currentSourceState(tmp.path, "git")
  expect(new Set([first.dirtyDigest, second.dirtyDigest, third.dirtyDigest]).size).toBe(3)
})

test("Git assurance scopes include declared ignored files and exclude unrelated changes", async () => {
  await using tmp = await tmpdir({ git: true })
  await fs.mkdir(path.join(tmp.path, "src"))
  await fs.writeFile(path.join(tmp.path, "src/config.txt"), "staging")
  await fs.writeFile(path.join(tmp.path, ".gitignore"), "runtime-config.txt\n")
  await fs.writeFile(path.join(tmp.path, "runtime-config.txt"), "enabled")
  const scopes = ["src", "runtime-config.txt"]
  const first = await currentSourceState(tmp.path, "git", scopes)
  await fs.writeFile(path.join(tmp.path, "unrelated.txt"), "a different task")
  expect(await currentSourceState(tmp.path, "git", scopes)).toEqual(first)
  await fs.writeFile(path.join(tmp.path, "runtime-config.txt"), "disabled")
  const second = await currentSourceState(tmp.path, "git", scopes)
  expect(second.dirtyDigest).not.toBe(first.dirtyDigest)
  await fs.writeFile(path.join(tmp.path, "src/config.txt"), "production")
  expect((await currentSourceState(tmp.path, "git", scopes)).dirtyDigest).not.toBe(second.dirtyDigest)
})

test("non-Git scopes support content checks and reject escaping paths", async () => {
  await using tmp = await tmpdir()
  await fs.writeFile(path.join(tmp.path, "config.txt"), "staging")
  expect((await currentSourceState(tmp.path, "")).available).toBe(false)
  const first = await currentSourceState(tmp.path, "", ["config.txt"])
  expect(first.available).toBe(true)
  await fs.writeFile(path.join(tmp.path, "config.txt"), "production")
  expect((await currentSourceState(tmp.path, "", ["config.txt"])).dirtyDigest).not.toBe(first.dirtyDigest)
  expect((await currentSourceState(tmp.path, "", ["../outside"])).available).toBe(false)
})

test.skipIf(process.platform === "win32")("source fingerprints refuse linked files", async () => {
  await using tmp = await tmpdir()
  await fs.writeFile(path.join(tmp.path, "config.txt"), "staging")
  await fs.symlink(path.join(tmp.path, "config.txt"), path.join(tmp.path, "linked.txt"))
  expect((await currentSourceState(tmp.path, "", ["linked.txt"])).available).toBe(false)
})

test.skipIf(process.platform === "win32")(
  "Git scopes refuse linked directories instead of certifying empty input",
  async () => {
    await using tmp = await tmpdir({ git: true })
    await using external = await tmpdir()
    await fs.mkdir(path.join(external.path, "src"))
    await fs.writeFile(path.join(external.path, "src/config.txt"), "external source")
    await fs.symlink(external.path, path.join(tmp.path, "linked"))
    expect((await currentSourceState(tmp.path, "git", ["linked/src"])).available).toBe(false)
  },
)
