import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  inspectImplementArenaBase,
  linkPrimaryNodeModules,
  snapshotContestantPatch,
} from "../../src/tool/arena-implement"
import { tmpdir } from "../fixture/fixture"

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
}

describe("implement arena git lifecycle", () => {
  test("links ignored Node dependencies into an isolated contestant worktree", async () => {
    await using primary = await tmpdir({ git: true })
    await using contestant = await tmpdir({ git: true })
    await using nonIgnored = await tmpdir({ git: true })
    await fs.mkdir(path.join(primary.path, "node_modules", "example"), { recursive: true })
    await fs.writeFile(path.join(primary.path, "node_modules", "example", "index.js"), "module.exports = 1\n")
    await fs.writeFile(path.join(contestant.path, ".gitignore"), "node_modules\n")

    await expect(linkPrimaryNodeModules(primary.path, contestant.path)).resolves.toBe(true)
    expect(await fs.readFile(path.join(contestant.path, "node_modules", "example", "index.js"), "utf8")).toBe(
      "module.exports = 1\n",
    )
    const status = git(contestant.path, ["status", "--porcelain=v1", "--untracked-files=all"])
    expect(status).toContain(".gitignore")
    expect(status).not.toContain("node_modules")
    await expect(linkPrimaryNodeModules(primary.path, contestant.path)).resolves.toBe(false)
    await expect(linkPrimaryNodeModules(primary.path, nonIgnored.path)).resolves.toBe(false)
    await expect(fs.lstat(path.join(nonIgnored.path, "node_modules"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("preflight reports non-git and unborn repositories without throwing", async () => {
    await using tmp = await tmpdir()
    const outsideGit = await inspectImplementArenaBase(tmp.path)
    expect(outsideGit).toMatchObject({ ok: false, reason: "not_git" })

    git(tmp.path, ["init"])
    const unborn = await inspectImplementArenaBase(tmp.path)
    expect(unborn).toMatchObject({ ok: false, reason: "no_base_commit" })
  })

  test("clean-base preflight rejects changes the contestants cannot inherit", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "tracked.txt"), "tracked\n")
    git(tmp.path, ["add", "tracked.txt"])
    git(tmp.path, ["commit", "-m", "tracked baseline"])
    const clean = await inspectImplementArenaBase(tmp.path)
    expect(clean.ok).toBe(true)

    await fs.writeFile(path.join(tmp.path, "uncommitted.txt"), "local only\n")
    const dirty = await inspectImplementArenaBase(tmp.path)
    expect(dirty.ok).toBe(false)
    if (dirty.ok) throw new Error("expected dirty preflight")
    expect(dirty.reason).toBe("dirty_worktree")
    expect(dirty.changes).toContain("uncommitted.txt")

    await fs.rm(path.join(tmp.path, "uncommitted.txt"))
    git(tmp.path, ["mv", "tracked.txt", "renamed.txt"])
    const renamed = await inspectImplementArenaBase(tmp.path)
    expect(renamed.ok).toBe(false)
    if (renamed.ok) throw new Error("expected rename preflight failure")
    expect(renamed.changes).toEqual(expect.arrayContaining(["tracked.txt", "renamed.txt"]))
  })

  test("snapshots tracked and untracked changes into a durable branch commit", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "tracked.txt"), "before\n")
    git(tmp.path, ["add", "tracked.txt"])
    git(tmp.path, ["commit", "-m", "baseline"])
    const baseCommit = git(tmp.path, ["rev-parse", "HEAD"])

    await fs.writeFile(path.join(tmp.path, "tracked.txt"), "after\n")
    await fs.writeFile(path.join(tmp.path, "new-file.txt"), "new\n")

    const snapshot = await snapshotContestantPatch({
      cwd: tmp.path,
      baseCommit,
      memberId: "provider/model",
    })

    expect(snapshot.hasChanges).toBe(true)
    expect(snapshot.changedFiles).toBe(2)
    expect(snapshot.linesChanged).toBeGreaterThanOrEqual(3)
    expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{16}$/)
    expect(snapshot.commit).toMatch(/^[a-f0-9]{40}$/)
    expect(git(tmp.path, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe("")
    expect(git(tmp.path, ["diff", "--name-only", baseCommit, snapshot.commit!]).split("\n").sort()).toEqual([
      "new-file.txt",
      "tracked.txt",
    ])
  })

  test("reports an empty implementation without creating a commit", async () => {
    await using tmp = await tmpdir({ git: true })
    const baseCommit = git(tmp.path, ["rev-parse", "HEAD"])
    const snapshot = await snapshotContestantPatch({
      cwd: tmp.path,
      baseCommit,
      memberId: "provider/model",
    })

    expect(snapshot.hasChanges).toBe(false)
    expect(snapshot.changedFiles).toBe(0)
    expect(snapshot.commit).toBeUndefined()
    expect(git(tmp.path, ["rev-parse", "HEAD"])).toBe(baseCommit)
  })

  test("re-anchors rewritten contestant history on its durable arena branch", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "tracked.txt"), "before\n")
    git(tmp.path, ["add", "tracked.txt"])
    git(tmp.path, ["commit", "-m", "baseline"])
    const baseCommit = git(tmp.path, ["rev-parse", "HEAD"])

    git(tmp.path, ["checkout", "--orphan", "rewritten-history"])
    git(tmp.path, ["rm", "-rf", "."])
    await fs.writeFile(path.join(tmp.path, "tracked.txt"), "after\n")
    git(tmp.path, ["add", "tracked.txt"])
    git(tmp.path, ["commit", "-m", "unrelated contestant commit"])

    const snapshot = await snapshotContestantPatch({
      cwd: tmp.path,
      baseCommit,
      memberId: "provider/model",
      targetBranch: "ax-code/arena-candidate",
    })

    expect(snapshot.hasChanges).toBe(true)
    expect(git(tmp.path, ["branch", "--show-current"])).toBe("ax-code/arena-candidate")
    expect(git(tmp.path, ["rev-parse", `${snapshot.commit}^`])).toBe(baseCommit)
    expect(git(tmp.path, ["show", `${snapshot.commit}:tracked.txt`])).toBe("after")
  })
})
