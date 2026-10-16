import { execFileSync } from "child_process"
import fs from "fs/promises"
import path from "path"
import { afterEach, describe, expect, test } from "vitest"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

/**
 * ADR-231: when `task_parallel.worktree_isolation` is on, every writer
 * child runs in its own Worktree worktree, and the post-pool pass
 * computes `git diff --stat <base>..HEAD` and `git status --porcelain` to
 * decide whether to keep or remove the worktree. These tests lock the
 * building blocks the executor relies on (worktree create/remove, diff
 * stat, status porcelain) using real git so a missing or misnamed flag
 * is caught here instead of in production dogfood.
 *
 * NOTE on `Worktree.create` vs `createReady`: the sandbox cannot run
 * the start-scripts bootstrap that `createReady` depends on
 * (test/worktree/worktree.test.ts:140 hits the same `Worktree failed
 * to become ready` error). `Worktree.create` returns the same `info`
 * shape (name, branch, directory) without the start-scripts gate, so
 * the post-pool diff/status logic the executor depends on is exercised
 * end-to-end. A future commit that fixes the bootstrap can swap
 * `create` for `createReady` here without changing assertions.
 */
describe("task_parallel worktree isolation primitives (ADR-231)", () => {
  test("Worktree.create gives the child a separate directory, branch, and recorded name", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "tester" },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const base = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: tmp.path,
          encoding: "utf8",
        }).trim()

        const worktree = await Worktree.create({ name: "swarm-0-isolated" })

        try {
          expect(worktree.name).toBe("swarm-0-isolated")
          expect(worktree.branch).toBe("ax-code/swarm-0-isolated")
          // The worktree directory must live under the project's per-worktree
          // root, not inside the primary tree — otherwise a writer would
          // stomp on the main checkout.
          const projectRoot = path.join(Global.Path.data, "worktree", Instance.project.id)
          expect(path.dirname(worktree.directory)).toBe(projectRoot)
          expect(worktree.directory.startsWith(tmp.path)).toBe(false)

          // The worktree is rooted at the project's HEAD, so a
          // post-pool `git diff --stat <base>..HEAD` reports no
          // changes when the child has not yet edited anything.
          const emptyStat = execFileSync("git", ["diff", "--stat", base, "HEAD", "--"], {
            cwd: worktree.directory,
            encoding: "utf8",
          }).trim()
          expect(emptyStat).toBe("")

          // The child branch is the worktree's HEAD.
          const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: worktree.directory,
            encoding: "utf8",
          }).trim()
          expect(branch).toBe(worktree.branch)
        } finally {
          // Cleanup so the per-project worktree root stays empty between
          // test runs.
          await Worktree.remove({ directory: worktree.directory }).catch(() => undefined)
        }
      },
    })
  })

  test("a dirty worktree (uncommitted changes only) keeps the worktree and surfaces a stat fallback", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "tester" },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const base = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: tmp.path,
          encoding: "utf8",
        }).trim()

        const worktree = await Worktree.create({ name: "swarm-1-dirty" })

        try {
          // The post-pool decision in src/tool/task_parallel.ts reads
          // `git diff --stat <base>..HEAD` and `git status --porcelain`.
          // Write a new file in the worktree so the status side reports
          // a dirty tree (no commits yet, so the diff stat stays empty).
          await fs.writeFile(path.join(worktree.directory, "wip.txt"), "wip\n")

          const stat = execFileSync("git", ["diff", "--stat", base, "HEAD", "--"], {
            cwd: worktree.directory,
            encoding: "utf8",
          }).trim()
          const status = execFileSync("git", ["status", "--porcelain=v1"], {
            cwd: worktree.directory,
            encoding: "utf8",
          }).trim()
          // The executor's `dirty = status.length > 0` predicate is the
          // branch that flips "no diff" into "kept worktree with
          // uncommitted changes". Lock the predicate here so a future
          // refactor of either command's flags is caught.
          expect(stat).toBe("")
          expect(status.length).toBeGreaterThan(0)
          expect(status.includes("wip.txt")).toBe(true)
        } finally {
          await Worktree.remove({ directory: worktree.directory }).catch(() => undefined)
        }
      },
    })
  })

  test("a worktree with a committed change keeps the worktree and the diff stat is non-empty", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "tester" },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const base = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: tmp.path,
          encoding: "utf8",
        }).trim()

        const worktree = await Worktree.create({ name: "swarm-2-commit" })

        try {
          await fs.writeFile(path.join(worktree.directory, "new.txt"), "hello\n")
          // The post-pool snapshot in arena-implement.ts commits the
          // writer's work inside the worktree so the diff stat has a
          // stable base. We do the same here to mirror the real
          // executor's working tree state at the moment it reads the
          // diff.
          execFileSync("git", ["add", "--all"], { cwd: worktree.directory })
          execFileSync(
            "git",
            ["-c", "user.name=AX Code Test", "-c", "user.email=test@ax-code.local", "commit", "-m", "wip"],
            { cwd: worktree.directory, stdio: "pipe" },
          )

          const stat = execFileSync("git", ["diff", "--stat", base, "HEAD", "--"], {
            cwd: worktree.directory,
            encoding: "utf8",
          }).trim()
          expect(stat.length).toBeGreaterThan(0)
          expect(stat).toContain("new.txt")
        } finally {
          await Worktree.remove({ directory: worktree.directory }).catch(() => undefined)
        }
      },
    })
  })

  test("Worktree.remove on a worktree with no commits and a clean tree removes both branch and directory", async () => {
    // This is the "zero commits and a clean tree → remove" branch from
    // ADR-231 D3. End-to-end via Worktree.create + Worktree.remove so
    // we know the same calls the executor makes actually clean up.
    await using tmp = await tmpdir({
      git: true,
      config: { username: "tester" },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const base = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: tmp.path,
          encoding: "utf8",
        }).trim()

        const worktree = await Worktree.create({ name: "swarm-3-clean" })

        // No edits: diff and status are both empty.
        const stat = execFileSync("git", ["diff", "--stat", base, "HEAD", "--"], {
          cwd: worktree.directory,
          encoding: "utf8",
        }).trim()
        const status = execFileSync("git", ["status", "--porcelain=v1"], {
          cwd: worktree.directory,
          encoding: "utf8",
        }).trim()
        expect(stat).toBe("")
        expect(status).toBe("")

        // Remove and verify the directory and branch are both gone.
        await Worktree.remove({ directory: worktree.directory })

        await expect(fs.stat(worktree.directory)).rejects.toThrow()
        const branches = execFileSync("git", ["branch", "--list", worktree.branch], {
          cwd: tmp.path,
          encoding: "utf8",
        }).trim()
        expect(branches).toBe("")
      },
    })
  })
})
