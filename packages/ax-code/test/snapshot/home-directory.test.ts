import { afterEach, expect, test, vi } from "vitest"
import { Snapshot } from "../../src/snapshot"
import { Instance } from "../../src/project/instance"
import { ProjectID } from "../../src/project/schema"
import { Global } from "../../src/global"
import * as Git from "../../src/util/git"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

// The desktop web UI (and a plain login-shell launch) can start ax-code with
// cwd == $HOME. Snapshotting there runs `git add .` over the user's entire
// disk, which routinely hits incomplete nested git repos (tool caches, etc.)
// whose HEAD does not resolve to a commit, aborts with exit 128, and — since
// this ran uncaught ahead of the request loop — cancelled the whole prompt
// before the LLM was ever called (#466).
test("skips snapshotting the home directory instead of staging the whole disk", async () => {
  const gitSpy = vi.spyOn(Git, "git")
  const projectID = ProjectID.make("proj_snapshot_home")

  await Instance.reload({
    directory: Global.Path.home,
    worktree: Global.Path.home,
    project: {
      id: projectID,
      worktree: Global.Path.home,
      name: "snapshot-home",
      time: { created: Date.now(), updated: Date.now() },
      sandboxes: [],
    },
  })

  await Instance.provide({
    directory: Global.Path.home,
    fn: async () => {
      expect(await Snapshot.track()).toBeUndefined()
    },
  })

  // The guard fires before any git process is spawned.
  expect(gitSpy).not.toHaveBeenCalled()
})
