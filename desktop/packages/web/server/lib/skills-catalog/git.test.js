import { describe, expect, it } from "vitest"
import fsPromises from "fs/promises"
import os from "os"
import path from "path"
import { assertGitAvailable, cloneRepo, runGit } from "./git.js"

describe("skills-catalog git helpers", () => {
  it("clones a local repository through the shared clone helper", async () => {
    const gitCheck = await assertGitAvailable()
    if (!gitCheck.ok) {
      return
    }

    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "oc-skill-git-"))
    const sourceRepo = path.join(tempRoot, "source.git")
    const cloneDir = path.join(tempRoot, "clone")

    try {
      const initialized = await runGit(["init", "--bare", sourceRepo], { timeoutMs: 10_000 })
      expect(initialized.ok).toBe(true)

      const cloned = await cloneRepo({ cloneUrl: sourceRepo, tempDir: cloneDir, timeoutMs: 10_000 })
      expect(cloned).toEqual({ ok: true })
      expect((await fsPromises.stat(path.join(cloneDir, ".git"))).isDirectory()).toBe(true)
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true })
    }
  })
})
