import { describe, expect, spyOn, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Worktree } from "../../src/worktree"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

const wintest = process.platform !== "linux" ? test : test.skip

async function startFsmonitor(dir: string) {
  await $`git config core.fsmonitor true`.cwd(dir).quiet()
  await $`git fsmonitor--daemon stop`.cwd(dir).quiet().nothrow()

  const started = await $`git fsmonitor--daemon start`.cwd(dir).quiet().nothrow()
  if (started.exitCode !== 0) return false

  const status = await $`git fsmonitor--daemon status`.cwd(dir).quiet().nothrow()
  if (status.exitCode !== 0) {
    await $`git fsmonitor--daemon stop`.cwd(dir).quiet().nothrow()
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

    await $`git worktree add --no-checkout -b ${branch} ${dir}`.cwd(root).quiet()
    await $`git reset --hard`.cwd(dir).quiet()

    const real = (await $`which git`.quiet().text()).trim()
    expect(real).toBeTruthy()

    const bin = path.join(root, "bin")
    const shim = path.join(bin, "git")
    await fs.mkdir(bin, { recursive: true })
    await Bun.write(
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

    const list = await $`git worktree list --porcelain`.cwd(root).quiet().text()
    expect(list).not.toContain(`worktree ${dir}`)

    const ref = await $`git show-ref --verify --quiet refs/heads/${branch}`.cwd(root).quiet().nothrow()
    expect(ref.exitCode).not.toBe(0)
  })

  test("keeps sandbox record when git worktree removal fails", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    const name = `remove-fail-${Date.now().toString(36)}`
    const branch = `opencode/${name}`
    const dir = path.join(root, "..", name)

    await $`git worktree add --no-checkout -b ${branch} ${dir}`.cwd(root).quiet()
    await $`git reset --hard`.cwd(dir).quiet()

    const real = (await $`which git`.quiet().text()).trim()
    expect(real).toBeTruthy()

    const bin = path.join(root, "bin-fail")
    const shim = path.join(bin, "git")
    await fs.mkdir(bin, { recursive: true })
    await Bun.write(
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

    const removeSandbox = spyOn(Project, "removeSandbox")
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
      await $`git worktree remove --force ${dir}`.cwd(root).quiet().nothrow()
      await $`git branch -D ${branch}`.cwd(root).quiet().nothrow()
    }
  })

  test("deletes the branch even when directory cleanup fails after git removal", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    const name = `remove-clean-fail-${Date.now().toString(36)}`
    const branch = `opencode/${name}`
    const dir = path.join(root, "..", name)

    await $`git worktree add --no-checkout -b ${branch} ${dir}`.cwd(root).quiet()
    await $`git reset --hard`.cwd(dir).quiet()

    const realRm = fs.rm.bind(fs)
    const rm = spyOn(fs, "rm").mockImplementation((target, options) => {
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

      const ref = await $`git show-ref --verify --quiet refs/heads/${branch}`.cwd(root).quiet().nothrow()
      expect(ref.exitCode).not.toBe(0)
    } finally {
      rm.mockRestore()
      await $`git worktree remove --force ${dir}`.cwd(root).quiet().nothrow()
      await $`git branch -D ${branch}`.cwd(root).quiet().nothrow()
    }
  })

  wintest("stops fsmonitor before removing a worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    const name = `remove-fsmonitor-${Date.now().toString(36)}`
    const branch = `opencode/${name}`
    const dir = path.join(root, "..", name)

    await $`git worktree add --no-checkout -b ${branch} ${dir}`.cwd(root).quiet()
    await $`git reset --hard`.cwd(dir).quiet()
    try {
      if (!(await startFsmonitor(dir))) return

      const ok = await Instance.provide({
        directory: root,
        fn: () => Worktree.remove({ directory: dir }),
      })

      expect(ok).toBe(true)
      expect(await Filesystem.exists(dir)).toBe(false)

      const ref = await $`git show-ref --verify --quiet refs/heads/${branch}`.cwd(root).quiet().nothrow()
      expect(ref.exitCode).not.toBe(0)
    } finally {
      if (await Filesystem.exists(dir)) {
        await $`git fsmonitor--daemon stop`.cwd(dir).quiet().nothrow()
        await $`git worktree remove --force ${dir}`.cwd(root).quiet().nothrow()
      }
    }
  })

  test("removing one worktree does not cancel another pending bootstrap", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    await Bun.write(path.join(root, "tracked.txt"), "ready\n")
    await $`git add tracked.txt`.cwd(root).quiet()
    await $`git commit -m test`.cwd(root).quiet()

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
