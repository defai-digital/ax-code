import { afterEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { File } from "../../src/file"
import { Instance } from "../../src/project/instance"
import { git } from "../../src/util/git"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

async function gitText(cwd: string, args: string[]) {
  const result = await git(args, { cwd })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${result.exitCode}): ${result.stderr.toString()}`)
  }
  return result.text()
}

// A linked worktree shares the commit history but has its own working tree, so
// ignore files that live in that checkout only reach it through the git
// machinery the listing must mirror. The worktree is a sibling of the main
// checkout (a nested one would still look "inside" the main worktree).
async function addWorktree(dir: string, ignore: string) {
  const main = path.join(dir, "main")
  await fs.mkdir(main)
  await gitText(dir, ["init", "-q", "main"])
  await gitText(main, ["config", "core.fsmonitor", "false"])
  await gitText(main, ["config", "user.email", "test@opencode.test"])
  await gitText(main, ["config", "user.name", "Test"])
  await gitText(main, ["commit", "--no-gpg-sign", "--allow-empty", "-m", "root commit"])
  await fs.writeFile(path.join(main, ".gitignore"), ignore, "utf-8")
  await gitText(main, ["add", ".gitignore"])
  await gitText(main, ["commit", "--no-gpg-sign", "-m", "add ignore"])
  const worktree = path.join(dir, "wt")
  await gitText(main, ["worktree", "add", worktree])
  return worktree
}

async function worktreeFixture(ignore: string) {
  return tmpdir<string>({ init: (dir) => addWorktree(dir, ignore) })
}

describe("ignore contexts follow the current checkout", () => {
  test("File.list() applies the root .gitignore of a linked worktree", async () => {
    await using tmp = await worktreeFixture("*.log\n")
    const sub = path.join(tmp.extra, "sub")
    await fs.mkdir(sub)
    await fs.writeFile(path.join(sub, "a.log"), "log data\n", "utf-8")

    await Instance.provide({
      directory: tmp.extra,
      fn: async () => {
        // Precondition for the regression: the project owns the main checkout
        // while the instance runs in the linked worktree.
        expect(Instance.worktree).toBe(tmp.extra)
        expect(Instance.project.worktree).not.toBe(Instance.worktree)

        const nodes = await File.list("sub")
        expect(nodes.find((node) => node.name === "a.log")?.ignored).toBe(true)
      },
    })
  })

  test("directory search from a worktree subdirectory applies that worktree's root .gitignore", async () => {
    await using tmp = await worktreeFixture("ignored-dir/\n")
    const sub = path.join(tmp.extra, "sub")
    await fs.mkdir(path.join(sub, "ignored-dir"), { recursive: true })

    await Instance.provide({
      directory: sub,
      fn: async () => {
        expect(Instance.worktree).toBe(tmp.extra)

        expect(await File.search({ query: "ignored-dir", type: "directory" })).toEqual([])
      },
    })
  })
})

describe("repository ignore sources", () => {
  test("a linked worktree reads info/exclude from the common git dir", async () => {
    await using tmp = await worktreeFixture("")
    const info = path.join(tmp.path, "main", ".git", "info")
    await fs.mkdir(info, { recursive: true })
    await fs.writeFile(path.join(info, "exclude"), "secret/\n", "utf-8")
    await fs.mkdir(path.join(tmp.extra, "secret"))

    await Instance.provide({
      directory: tmp.extra,
      fn: async () => {
        const nodes = await File.list()
        expect(nodes.find((node) => node.name === "secret")?.ignored).toBe(true)
      },
    })
  })

  test(".git/info/exclude is applied to listings and directory search", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "secret"))
    await fs.writeFile(path.join(tmp.path, "secret", "token.txt"), "token\n", "utf-8")
    await fs.mkdir(path.join(tmp.path, ".git", "info"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, ".git", "info", "exclude"), "secret/\n", "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const nodes = await File.list()
        expect(nodes.find((node) => node.name === "secret")?.ignored).toBe(true)
        expect(await File.search({ query: "secret", type: "directory" })).toEqual([])
      },
    })
  })

  test("core.excludesFile patterns are applied like git", async () => {
    await using tmp = await tmpdir({ git: true })
    const global = path.join(tmp.path, "global-ignore")
    await fs.writeFile(global, "*.tmp\n", "utf-8")
    await gitText(tmp.path, ["config", "core.excludesFile", global])
    await fs.writeFile(path.join(tmp.path, "scratch.tmp"), "scratch\n", "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const nodes = await File.list()
        expect(nodes.find((node) => node.name === "scratch.tmp")?.ignored).toBe(true)
      },
    })
  })

  test("a root .gitignore outranks core.excludesFile", async () => {
    await using tmp = await tmpdir({ git: true })
    const global = path.join(tmp.path, "global-ignore")
    await fs.writeFile(global, "*.tmp\n", "utf-8")
    await gitText(tmp.path, ["config", "core.excludesFile", global])
    await fs.writeFile(path.join(tmp.path, ".gitignore"), "!keep.tmp\n", "utf-8")
    await fs.writeFile(path.join(tmp.path, "keep.tmp"), "keep\n", "utf-8")
    await fs.writeFile(path.join(tmp.path, "drop.tmp"), "drop\n", "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const nodes = await File.list()
        expect(nodes.find((node) => node.name === "keep.tmp")?.ignored).toBe(false)
        expect(nodes.find((node) => node.name === "drop.tmp")?.ignored).toBe(true)
      },
    })
  })
})
