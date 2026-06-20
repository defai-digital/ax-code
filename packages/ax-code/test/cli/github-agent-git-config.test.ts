import { expect, test } from "vitest"
import path from "path"

test("github-agent configures git identity locally, not globally", async () => {
  const src = await Bun.file(path.join(import.meta.dirname, "../../src/cli/cmd/github-agent/index.ts")).text()
  const legacySrc = await Bun.file(path.join(import.meta.dirname, "../../../integration-github/index.ts")).text()

  expect(src).toContain('gitRun(["config", "--local", "user.name", AGENT_USERNAME])')
  expect(src).toContain('gitRun(["config", "--local", "user.email", `${AGENT_USERNAME}@users.noreply.github.com`])')
  expect(src).not.toContain('gitRun(["config", "--global", "user.name"')
  expect(src).not.toContain('gitRun(["config", "--global", "user.email"')

  expect(legacySrc).toContain('git config --local user.name "ax-code-agent[bot]"')
  expect(legacySrc).toContain('git config --local user.email "ax-code-agent[bot]@users.noreply.github.com"')
  expect(legacySrc).not.toContain("git config --global user.name")
  expect(legacySrc).not.toContain("git config --global user.email")
})
