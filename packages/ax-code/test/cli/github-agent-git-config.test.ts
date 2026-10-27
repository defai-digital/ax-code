import { expect, test } from "vitest"
import path from "path"
import { readFile } from "node:fs/promises"
import { configureGit, createGitHelpers, restoreGitConfig } from "../../src/cli/cmd/github-agent/git-ops"
import { tmpdir } from "../fixture/fixture"

test("github-agent configures git identity locally, not globally", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/github-agent/git-ops.ts"), "utf-8")

  expect(src).toContain('gitRun(["config", "--local", "user.name", AGENT_USERNAME])')
  expect(src).toContain('gitRun(["config", "--local", "user.email", `${AGENT_USERNAME}@users.noreply.github.com`])')
  expect(src).not.toContain('gitRun(["config", "--global", "user.name"')
  expect(src).not.toContain('gitRun(["config", "--global", "user.email"')
})

test("restoreGitConfig removes the app token header when none existed before", async () => {
  await using tmp = await tmpdir({ git: true })
  const { gitRun, gitStatus } = createGitHelpers(tmp.path)
  const header = "http.https://github.com/.extraheader"

  const saved = await configureGit(gitRun, gitStatus, "ghs_test", false)
  expect((await gitStatus(["config", "--local", "--get", header])).exitCode).toBe(0)

  await restoreGitConfig(gitRun, false, saved.savedUserName, saved.savedUserEmail, saved.savedGitConfig)
  expect((await gitStatus(["config", "--local", "--get", header])).exitCode).not.toBe(0)
  // A second restore finds every key already gone and must not throw.
  await restoreGitConfig(gitRun, false, saved.savedUserName, saved.savedUserEmail, saved.savedGitConfig)
})
