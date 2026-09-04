import { afterEach, describe, expect, test } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { File } from "../../src/file"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { git } from "../../src/util/git"
import { tmpdir } from "../fixture/fixture"

afterEach(() => Instance.disposeAll())

describe.skipIf(process.platform === "win32")("file status path fidelity", () => {
  test.each([
    { label: "leading spaces", filename: " leading.txt" },
    { label: "trailing spaces", filename: "trailing.txt " },
    { label: "quoted tabs", filename: `tab${String.fromCharCode(9)}name.txt` },
    { label: "Git C escapes", filename: `bell${String.fromCharCode(7)}name.txt` },
  ])("preserves $label in untracked and modified files", async ({ filename }) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = path.join(tmp.path, filename)
        await Filesystem.write(file, "before\n")
        expect(await File.status()).toContainEqual({ path: filename, added: 1, removed: 0, status: "added" })

        expect((await git(["add", "--", filename], { cwd: tmp.path })).exitCode).toBe(0)
        expect((await git(["commit", "--no-gpg-sign", "-m", "Add fixture"], { cwd: tmp.path })).exitCode).toBe(0)
        await Filesystem.write(file, "after\n")

        expect(await File.status()).toContainEqual({ path: filename, added: 1, removed: 1, status: "modified" })
      },
    })
  })
})

test("reports a deleted path once with deleted status", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const filename = "deleted.txt"
      await Filesystem.write(path.join(tmp.path, filename), "before\n")
      expect((await git(["add", "--", filename], { cwd: tmp.path })).exitCode).toBe(0)
      expect((await git(["commit", "--no-gpg-sign", "-m", "Add fixture"], { cwd: tmp.path })).exitCode).toBe(0)
      await fs.unlink(path.join(tmp.path, filename))

      const entries = (await File.status()).filter((entry) => entry.path === filename)
      expect(entries).toEqual([{ path: filename, added: 0, removed: 1, status: "deleted" }])
    },
  })
})

test("reports literal paths for staged renames", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Filesystem.write(path.join(tmp.path, "old.txt"), "unchanged\n")
      expect((await git(["add", "--", "old.txt"], { cwd: tmp.path })).exitCode).toBe(0)
      expect((await git(["commit", "--no-gpg-sign", "-m", "Add fixture"], { cwd: tmp.path })).exitCode).toBe(0)
      expect((await git(["mv", "--", "old.txt", "new.txt"], { cwd: tmp.path })).exitCode).toBe(0)

      const entries = await File.status()
      expect(entries).toContainEqual({ path: "old.txt", added: 0, removed: 1, status: "deleted" })
      expect(entries.find((entry) => entry.path === "new.txt")).toBeDefined()
      expect(entries.some((entry) => entry.path.includes("=>"))).toBe(false)
    },
  })
})

test("reports tracked paths relative to the active project directory", async () => {
  await using tmp = await tmpdir({ git: true })
  const directory = path.join(tmp.path, "nested")
  await Filesystem.write(path.join(directory, "tracked.txt"), "before\n")
  await Filesystem.write(path.join(directory, "deleted.txt"), "before\n")
  expect((await git(["add", "--", "nested"], { cwd: tmp.path })).exitCode).toBe(0)
  expect((await git(["commit", "--no-gpg-sign", "-m", "Add fixture"], { cwd: tmp.path })).exitCode).toBe(0)
  await Filesystem.write(path.join(directory, "tracked.txt"), "after\n")
  await fs.unlink(path.join(directory, "deleted.txt"))

  await Instance.provide({
    directory,
    fn: async () => {
      expect(await File.status()).toEqual([
        { path: "tracked.txt", added: 1, removed: 1, status: "modified" },
        { path: "deleted.txt", added: 0, removed: 1, status: "deleted" },
      ])
      expect((await File.read("tracked.txt")).content).toBe("after\n")
    },
  })
})
