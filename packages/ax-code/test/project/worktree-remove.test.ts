import { describe, expect, test, vi } from "vitest"
import { execSync } from "child_process"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Worktree } from "../../src/worktree"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

function run(cmd: string, cwd?: string) {
  execSync(cmd, { cwd, stdio: "pipe" })
}
function runOk(cmd: string, cwd?: string): { status: number } {
  try {
    execSync(cmd, { cwd, stdio: "pipe" })
    return { status: 0 }
  } catch (e: any) {
    return { status: e.status ?? 1 }
  }
}

const wintest = process.platform !== "linux" ? test : test.skip

async function startFsmonitor(dir: string) {
  run("git config core.fsmonitor true", dir)
  runOk("git fsmonitor--daemon stop", dir)

  const started = runOk("git fsmonitor--daemon start", dir)
  if (started.status !== 0) return false

  const status = runOk("git fsmonitor--daemon status", dir)
  if (status.status !== 0) {
    runOk("git fsmonitor--daemon stop", dir)
    return false
  }

  return true
}

describe("Worktree.remove", () => {
  test("continues when git remove exits non-zero after detaching", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    const name = `remove-regression-${Date.now().toString(36)}`
    const branch = `opencode/${name}`
    const dir = path.join(root, "..", name)

    run(`git worktree add --no-checkout -b ${branch} ${dir}`, root)
    run("git reset --hard", dir)

    const real = execSync("which git", { encoding: "utf-8" }).trim()
    expect(real).toBeTruthy()

    const bin = path.join(root, "bin")
    const shim = path.join(bin, "git")
    await fs.mkdir(bin, { recursive: true })
    await fs.writeFile(
      shim,
      [
        "#!/bin/bash",
        `REAL_GIT=${JSON.stringify(real)}`,
        'if [ "$1" = "worktree" ] && [ "$2" = "remove" ]; then',
        '  "$REAL_GIT" "$@" >/dev/null 2>&1',
        '  echo "fatal: failed to remove worktree: Directory not empty" >&2',
        "  exit 1",
        "fi",
        'exec "$REAL_GIT" "$@"',
      ].join("\n"),
    )
    await fs.chmod(shim, 0o755)

    const prev = process.env.PATH ?? ""
    process.env.PATH = `${bin}${path.delimiter}${prev}`

    const ok = await (async () => {
      try {
        return await Instance.provide({
          directory: root,
          fn: () => Worktree.remove({ directory: dir }),
        })
      } finally {
        process.env.PATH = prev
      }
    })()

    expect(ok).toBe(true)
    expect(await Filesystem.exists(dir)).toBe(false)

    const list = execSync("git worktree list --porcelain", { cwd: root, encoding: "utf-8" })
    expect(list).not.toContain(`worktree ${dir}`)

    const ref = runOk(`git show-ref --verify --quiet refs/heads/${branch}`, root)
    expect(ref.status).not.toBe(0)
  })

  test("keeps sandbox record when git worktree removal fails", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    const name = `remove-fail-${Date.now().toString(36)}`
    const branch = `opencode/${name}`
    const dir = path.join(root, "..", name)

    run(`git worktree add --no-checkout -b ${branch} ${dir}`, root)
    run("git reset --hard", dir)

    const real = execSync("which git", { encoding: "utf-8" }).trim()
    expect(real).toBeTruthy()

    const bin = path.join(root, "bin-fail")
    const shim = path.join(bin, "git")
    await fs.mkdir(bin, { recursive: true })
    await fs.writeFile(
      shim,
      [
        "#!/bin/bash",
        `REAL_GIT=${JSON.stringify(real)}`,
        'if [ "$1" = "worktree" ] && [ "$2" = "remove" ]; then',
        '  echo "fatal: simulated remove failure" >&2',
        "  exit 1",
        "fi",
        'exec "$REAL_GIT" "$@"',
      ].join("\n"),
    )
    await fs.chmod(shim, 0o755)

    const removeSandbox = vi.spyOn(Project, "removeSandbox")
    const prev = process.env.PATH ?? ""
    process.env.PATH = `${bin}${path.delimiter}${prev}`

    try {
      await expect(
        Instance.provide({
          directory: root,
          fn: () => Worktree.remove({ directory: dir }),
        }),
      ).rejects.toThrow("WorktreeRemoveFailedError")

      expect(removeSandbox).not.toHaveBeenCalled()
    } finally {
      process.env.PATH = prev
      removeSandbox.mockRestore()
      runOk(`git worktree remove --force ${dir}`, root)
      runOk(`git branch -D ${branch}`, root)
    }
  })

  test("deletes the branch even when directory cleanup fails after git removal", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    const name = `remove-clean-fail-${Date.now().toString(36)}`
    const branch = `opencode/${name}`
    const dir = path.join(root, "..", name)

    run(`git worktree add --no-checkout -b ${branch} ${dir}`, root)
    run("git reset --hard", dir)

    const realRm = fs.rm.bind(fs)
    const rm = vi.spyOn(fs, "rm").mockImplementation((target, options) => {
      if (path.resolve(String(target)) === path.resolve(dir)) {
        return Promise.reject(new Error("simulated cleanup failure"))
      }
      return realRm(target, options)
    })

    try {
      await expect(
        Instance.provide({
          directory: root,
          fn: () => Worktree.remove({ directory: dir }),
        }),
      ).rejects.toThrow("WorktreeRemoveFailedError")

      const ref = runOk(`git show-ref --verify --quiet refs/heads/${branch}`, root)
      expect(ref.status).not.toBe(0)
    } finally {
      rm.mockRestore()
      runOk(`git worktree remove --force ${dir}`, root)
      runOk(`git branch -D ${branch}`, root)
    }
  })

  wintest("stops fsmonitor before removing a worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    const name = `remove-fsmonitor-${Date.now().toString(36)}`
    const branch = `opencode/${name}`
    const dir = path.join(root, "..", name)

    run(`git worktree add --no-checkout -b ${branch} ${dir}`, root)
    run("git reset --hard", dir)
    try {
      if (!(await startFsmonitor(dir))) return

      const ok = await Instance.provide({
        directory: root,
        fn: () => Worktree.remove({ directory: dir }),
      })

      expect(ok).toBe(true)
      expect(await Filesystem.exists(dir)).toBe(false)

      const ref = runOk(`git show-ref --verify --quiet refs/heads/${branch}`, root)
      expect(ref.status).not.toBe(0)
    } finally {
      if (await Filesystem.exists(dir)) {
        runOk("git fsmonitor--daemon stop", dir)
        runOk(`git worktree remove --force ${dir}`, root)
      }
    }
  })

  test("removing one worktree does not cancel another pending bootstrap", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    await fs.writeFile(path.join(root, "tracked.txt"), "ready\n")
    run("git add tracked.txt", root)
    run("git commit -m test", root)

    await Instance.provide({
      directory: root,
      fn: async () => {
        const first = await Worktree.create({ name: "first" })
        const second = await Worktree.create({ name: "second" })

        await Worktree.remove({ directory: first.directory })
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(await Filesystem.exists(path.join(second.directory, "tracked.txt"))).toBe(true)

        await Worktree.remove({ directory: second.directory })
      },
    })
  })
})
