import { execSync } from "child_process"
import { afterEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { setTimeout as sleep } from "node:timers/promises"
import { tmpdir } from "../fixture/fixture"
import { FileWatcher } from "../../src/file/watcher"
import { Instance } from "../../src/project/instance"
import { GlobalBus } from "../../src/bus/global"
import { Vcs } from "../../src/project/vcs"

// Skip in CI — native @parcel/watcher binding needed
const describeVcs = FileWatcher.hasNativeBinding() && !process.env.CI ? describe : describe.skip

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withVcs(directory: string, body: () => Promise<void>) {
  return Instance.provide({
    directory,
    fn: async () => {
      try {
        await FileWatcher.init({ enabled: true, disabled: false })
        await Vcs.init()
        await sleep(500)
        await body()
      } finally {
        await Instance.dispose()
      }
    },
  })
}

type BranchEvent = { directory?: string; payload: { type: string; properties: { branch?: string } } }

/** Wait for a Vcs.Event.BranchUpdated event on GlobalBus, with retry polling as fallback */
function nextBranchUpdate(directory: string, timeout = 10_000) {
  return new Promise<string | undefined>((resolve, reject) => {
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      GlobalBus.off("event", on)
      reject(new Error("timed out waiting for BranchUpdated event"))
    }, timeout)

    function on(evt: BranchEvent) {
      if (evt.directory !== directory) return
      if (evt.payload.type !== Vcs.Event.BranchUpdated.type) return
      if (settled) return
      settled = true
      clearTimeout(timer)
      GlobalBus.off("event", on)
      resolve(evt.payload.properties.branch)
    }

    GlobalBus.on("event", on)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeVcs("Vcs", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("branch() returns current branch name", async () => {
    await using tmp = await tmpdir({ git: true })

    await withVcs(tmp.path, async () => {
      const branch = await Vcs.branch()
      expect(branch).toBeDefined()
      expect(typeof branch).toBe("string")
    })
  })

  test("branch() returns undefined for non-git directories", async () => {
    await using tmp = await tmpdir()

    await withVcs(tmp.path, async () => {
      const branch = await Vcs.branch()
      expect(branch).toBeUndefined()
    })
  })

  test("publishes BranchUpdated when .git/HEAD changes", async () => {
    await using tmp = await tmpdir({ git: true })
    const branch = `test-${Math.random().toString(36).slice(2)}`
    execSync(`git branch ${branch}`, { cwd: tmp.path, stdio: "pipe" })

    await withVcs(tmp.path, async () => {
      const pending = nextBranchUpdate(tmp.path)

      const head = path.join(tmp.path, ".git", "HEAD")
      await fs.writeFile(head, `ref: refs/heads/${branch}\n`)

      const updated = await pending
      expect(updated).toBe(branch)
    })
  })

  test("branch() reflects the new branch after HEAD change", async () => {
    await using tmp = await tmpdir({ git: true })
    const branch = `test-${Math.random().toString(36).slice(2)}`
    execSync(`git branch ${branch}`, { cwd: tmp.path, stdio: "pipe" })

    await withVcs(tmp.path, async () => {
      const pending = nextBranchUpdate(tmp.path)

      const head = path.join(tmp.path, ".git", "HEAD")
      await fs.writeFile(head, `ref: refs/heads/${branch}\n`)

      await pending
      const current = await Vcs.branch()
      expect(current).toBe(branch)
    })
  })
})

test("branches() returns local branches without remote-tracking refs", async () => {
  await using tmp = await tmpdir({ git: true })
  execSync("git branch feature/merge-target", { cwd: tmp.path, stdio: "pipe" })
  execSync("git update-ref refs/remotes/origin/remote-only HEAD", { cwd: tmp.path, stdio: "pipe" })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const branches = await Vcs.branches()
      expect(branches).toContain("feature/merge-target")
      expect(branches).not.toContain("remote-only")
    },
  })
})

test("branches() preserves a branch name shared with a tag", async () => {
  await using tmp = await tmpdir({ git: true })
  execSync("git branch release-target", { cwd: tmp.path, stdio: "pipe" })
  execSync("git tag release-target", { cwd: tmp.path, stdio: "pipe" })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await Vcs.branches()).toContain("release-target")
      expect(await Vcs.branches()).not.toContain("heads/release-target")
    },
  })
})

test("branch() reports an unborn branch before the first commit", async () => {
  await using tmp = await tmpdir({
    init: async (directory) => {
      execSync("git init --initial-branch=unborn-target", { cwd: directory, stdio: "pipe" })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      try {
        expect(await Vcs.branch()).toBe("unborn-target")
      } finally {
        await Instance.dispose()
      }
    },
  })
})

test("branch() preserves the current branch name when a tag shares its name", async () => {
  await using tmp = await tmpdir({ git: true })
  execSync("git checkout -b release-target", { cwd: tmp.path, stdio: "pipe" })
  execSync("git tag release-target", { cwd: tmp.path, stdio: "pipe" })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      try {
        expect(await Vcs.branch()).toBe("release-target")
      } finally {
        await Instance.dispose()
      }
    },
  })
})

test("branch() preserves the detached HEAD indicator", async () => {
  await using tmp = await tmpdir({ git: true })
  execSync("git checkout --detach", { cwd: tmp.path, stdio: "pipe" })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      try {
        expect(await Vcs.branch()).toBe("HEAD")
      } finally {
        await Instance.dispose()
      }
    },
  })
})
