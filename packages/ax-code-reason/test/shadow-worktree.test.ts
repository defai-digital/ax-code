import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { execFile } from "node:child_process"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { promisify } from "util"
import { ShadowWorktree } from "../src/shadow-worktree"
import { installTestHost } from "./fixture/host"

const execFileAsync = promisify(execFile)

// Real-git contract for the shadow worktree helper. Each test gets a fresh
// repo + a separate "instance" directory (projectRoot) so shadow checkouts
// under <projectRoot>/dre/shadow never dirty the repo itself.

type Repo = {
  base: string
  repo: string
  instanceDir: string
  git(args: string[]): Promise<string>
}

async function makeRepo(): Promise<Repo> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "ax-reason-shadow-"))
  const repo = path.join(base, "repo")
  const instanceDir = path.join(base, "instance")
  await fs.mkdir(repo, { recursive: true })
  await fs.mkdir(instanceDir, { recursive: true })
  const git = async (args: string[]) => (await execFileAsync("git", args, { cwd: repo })).stdout.trim()
  await git(["init"])
  await git(["config", "user.email", "test@example.com"])
  await git(["config", "user.name", "Test"])
  await git(["config", "commit.gpgsign", "false"])
  await fs.writeFile(path.join(repo, "file.txt"), "hello\n")
  await git(["add", "."])
  await git(["commit", "-m", "init"])
  return { base, repo, instanceDir, git }
}

async function pathExists(p: string): Promise<boolean> {
  return fs.stat(p).then(
    () => true,
    () => false,
  )
}

// Branch names without the "*"/"+ " decorations `git branch --list` adds
// for current / worktree-checked-out branches.
async function branchExists(ctx: Repo, branch: string): Promise<boolean> {
  const out = await ctx.git(["branch", "--list", branch, "--format=%(refname:short)"])
  return out === branch
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("ShadowWorktree", () => {
  let ctx: Repo

  beforeEach(async () => {
    ctx = await makeRepo()
    ShadowWorktree.__resetGates()
    installTestHost({ projectRoot: ctx.instanceDir, worktreeRoot: ctx.repo, vcs: "git" })
  })

  afterEach(async () => {
    ShadowWorktree.__resetGates()
    await fs.rm(ctx.base, { recursive: true, force: true }).catch(() => undefined)
  })

  test("precheck accepts a clean git repo", async () => {
    expect(await ShadowWorktree.precheck()).toEqual({ ok: true })
  })

  test("precheck rejects a dirty repo and lists the offending files", async () => {
    await fs.writeFile(path.join(ctx.repo, "file.txt"), "modified\n")
    await fs.writeFile(path.join(ctx.repo, "untracked.txt"), "new\n")

    const result = await ShadowWorktree.precheck()
    if (result.ok || result.reason !== "uncommitted-changes") {
      throw new Error(`expected uncommitted-changes rejection, got ${JSON.stringify(result)}`)
    }
    expect(result.files).toContain("untracked.txt")
    // CURRENT-BEHAVIOR QUIRK: precheck trims the whole porcelain output
    // before splitting, which eats the leading status column of the FIRST
    // line when that line's status starts with a space (" M file.txt" →
    // "M file.txt" → slice(3) drops a filename character). Codified here;
    // a later phase fixes the parse.
    expect(result.files).toContain("ile.txt")
    expect(result.files).not.toContain("file.txt")
  })

  test("precheck reports not-git for a non-git project or a non-repo directory", async () => {
    const testHost = installTestHost({ projectRoot: ctx.instanceDir, worktreeRoot: ctx.repo, vcs: "none" })
    expect(await ShadowWorktree.precheck()).toEqual({ ok: false, reason: "not-git" })

    // vcs claims git but the worktree root is not a repository.
    testHost.env.vcs = "git"
    testHost.env.worktreeRoot = ctx.instanceDir
    expect(await ShadowWorktree.precheck()).toEqual({ ok: false, reason: "not-git" })
  })

  test("open refuses a dirty repo unless allowDirty is set", async () => {
    await fs.writeFile(path.join(ctx.repo, "file.txt"), "modified\n")

    const refused = await ShadowWorktree.open({ planId: "plan-dirty" })
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.reason).toBe("uncommitted-changes")

    const allowed = await ShadowWorktree.open({ planId: "plan-dirty", allowDirty: true })
    expect(allowed.ok).toBe(true)
    if (allowed.ok) await allowed.handle[Symbol.asyncDispose]()
  })

  test("open creates a worktree + branch from HEAD and dispose removes both", async () => {
    const result = await ShadowWorktree.open({ planId: "plan-basic" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const handle = result.handle

    expect(handle.path).toBe(path.join(ctx.instanceDir, "dre", "shadow", "plan-basic"))
    expect(handle.branch).toBe("ax-code/dre/shadow/plan-basic")
    expect(handle.disposed).toBe(false)
    expect(await pathExists(path.join(handle.path, "file.txt"))).toBe(true)
    expect(await branchExists(ctx, handle.branch)).toBe(true)

    await handle[Symbol.asyncDispose]()
    expect(handle.disposed).toBe(true)
    expect(await pathExists(handle.path)).toBe(false)
    expect(await branchExists(ctx, handle.branch)).toBe(false)
  })

  test("asyncDispose is idempotent and `await using` cleans up on throw", async () => {
    const result = await ShadowWorktree.open({ planId: "plan-idem" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    await result.handle[Symbol.asyncDispose]()
    await result.handle[Symbol.asyncDispose]()
    expect(result.handle.disposed).toBe(true)

    let capturedPath = ""
    await expect(
      (async () => {
        const opened = await ShadowWorktree.open({ planId: "plan-throw" })
        if (!opened.ok) throw new Error(`open failed: ${opened.reason}`)
        await using handle = opened.handle
        capturedPath = handle.path
        throw new Error("boom")
      })(),
    ).rejects.toThrow("boom")
    expect(capturedPath).not.toBe("")
    expect(await pathExists(capturedPath)).toBe(false)
    expect(await branchExists(ctx, "ax-code/dre/shadow/plan-throw")).toBe(false)
  })

  test("open with the same planId retries cleanly after dispose", async () => {
    const first = await ShadowWorktree.open({ planId: "plan-retry" })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    await first.handle[Symbol.asyncDispose]()

    const second = await ShadowWorktree.open({ planId: "plan-retry" })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.handle.path).toBe(first.handle.path)
    await second.handle[Symbol.asyncDispose]()
  })

  test("open reports not-git without burning a concurrency slot", async () => {
    installTestHost({ projectRoot: ctx.instanceDir, worktreeRoot: ctx.repo, vcs: "none" })
    expect(await ShadowWorktree.open({ planId: "plan-x" })).toEqual({ ok: false, reason: "not-git" })
  })

  test("concurrency gate: the 4th concurrent shadow waits FIFO for a free slot", async () => {
    const handles: ShadowWorktree.Handle[] = []
    for (const planId of ["p1", "p2", "p3"]) {
      const opened = await ShadowWorktree.open({ planId })
      expect(opened.ok).toBe(true)
      if (opened.ok) handles.push(opened.handle)
    }

    let fourthResolved = false
    const fourth = ShadowWorktree.open({ planId: "p4" }).then((result) => {
      fourthResolved = true
      return result
    })
    await sleep(300)
    expect(fourthResolved).toBe(false)

    // Releasing the first handle hands its slot directly to the waiter.
    await handles[0][Symbol.asyncDispose]()
    const result = await fourth
    expect(fourthResolved).toBe(true)
    expect(result.ok).toBe(true)
    if (result.ok) await result.handle[Symbol.asyncDispose]()
    for (const handle of handles.slice(1)) await handle[Symbol.asyncDispose]()
  })

  test("cleanupOrphans removes crashed shadows but skips active plan IDs", async () => {
    const active = await ShadowWorktree.open({ planId: "plan-active" })
    expect(active.ok).toBe(true)
    if (!active.ok) return

    // Simulate a crashed apply: a shadow worktree + branch left behind with
    // no live handle and no gate entry.
    const orphanDir = path.join(ctx.instanceDir, "dre", "shadow", "plan-orphan")
    await fs.mkdir(path.dirname(orphanDir), { recursive: true })
    await ctx.git(["worktree", "add", "-b", "ax-code/dre/shadow/plan-orphan", orphanDir, "HEAD"])
    expect(await pathExists(orphanDir)).toBe(true)

    const cleaned = await ShadowWorktree.cleanupOrphans()
    // CURRENT-BEHAVIOR QUIRK: `git branch --list` decorates worktree-checked-out
    // branches with a "+ " prefix, but cleanupOrphans only strips "*". Orphan
    // shadow branches are always checked out in their (dead) worktree, so the
    // branch-removal path derives a mangled planId ("+ plan-orphan"), targets a
    // nonexistent worktree dir and branch name, and silently fails — the orphan
    // BRANCH survives cleanup. The directory sweep works because readdir names
    // carry no decoration.
    expect(cleaned).toEqual({ branches: 0, directories: 1 })
    expect(await pathExists(orphanDir)).toBe(false)
    expect(await branchExists(ctx, "ax-code/dre/shadow/plan-orphan")).toBe(true)

    // The active shadow's directory is skipped via the concurrency-gate guard
    // and the worktree remains usable.
    expect(await pathExists(active.handle.path)).toBe(true)
    expect(await branchExists(ctx, active.handle.branch)).toBe(true)
    expect(await pathExists(path.join(active.handle.path, "file.txt"))).toBe(true)

    await active.handle[Symbol.asyncDispose]()

    const again = await ShadowWorktree.cleanupOrphans()
    expect(again).toEqual({ branches: 0, directories: 0 })
  })

  test("cleanupOrphans is a no-op for non-git projects", async () => {
    installTestHost({ projectRoot: ctx.instanceDir, worktreeRoot: ctx.repo, vcs: "none" })
    expect(await ShadowWorktree.cleanupOrphans()).toEqual({ branches: 0, directories: 0 })
  })
})
