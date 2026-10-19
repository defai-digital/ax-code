import { execSync } from "node:child_process"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { Bus } from "../../src/bus"
import { GlobalBus } from "../../src/bus/global"
import { FileWatcher } from "../../src/file/watcher"
import { Instance } from "../../src/project/instance"
import { Vcs } from "../../src/project/vcs"
import * as Git from "../../src/util/git"
import { tmpdir } from "../fixture/fixture"

const realGit = Git.git

afterEach(async () => {
  await Instance.disposeAll()
  vi.restoreAllMocks()
})

function pauseBranchRead() {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let paused = false
  vi.spyOn(Git, "git").mockImplementation(async (args, opts) => {
    const result = await realGit(args, opts)
    if (!paused && args[0] === "symbolic-ref") {
      paused = true
      started.resolve()
      await release.promise
    }
    return result
  })
  return { started: started.promise, release: () => release.resolve() }
}

test("does not lose a HEAD update while the initial branch read is pending", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const pending = pauseBranchRead()
      const initialized = Vcs.init()
      await pending.started
      execSync("git checkout -b switched-during-init", { cwd: tmp.path, stdio: "pipe" })
      const event = Bus.publish(FileWatcher.Event.Updated, { file: path.join(tmp.path, ".git/HEAD"), event: "change" })
      pending.release()
      await initialized
      await event
      expect(await Vcs.branch()).toBe("switched-during-init")
    },
  })
})

test("does not publish a pending branch refresh after instance disposal", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Vcs.init()
      const pending = pauseBranchRead()
      execSync("git checkout -b disposed-branch", { cwd: tmp.path, stdio: "pipe" })
      const updates: unknown[] = []
      const listener = (event: { directory?: string; payload: { type: string } }) => {
        if (event.directory === tmp.path && event.payload.type === Vcs.Event.BranchUpdated.type) updates.push(event)
      }
      GlobalBus.on("event", listener)
      try {
        const event = Bus.publish(FileWatcher.Event.Updated, {
          file: path.join(tmp.path, ".git/HEAD"),
          event: "change",
        })
        await pending.started
        await Instance.dispose()
        pending.release()
        await event
        expect(updates).toEqual([])
      } finally {
        pending.release()
        GlobalBus.off("event", listener)
      }
    },
  })
})
