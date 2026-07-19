import { describe, expect, test } from "vitest"
import path from "path"
import { readFile } from "node:fs/promises"

const repoRoot = path.resolve(import.meta.dirname, "../../../..")

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), "utf-8")
}

describe("public safety documentation contract", () => {
  test("front-door docs state that runtime isolation defaults to workspace-write", async () => {
    const readme = await readRepoFile("README.md")
    const security = await readRepoFile("SECURITY.md")
    const sandbox = await readRepoFile("docs/guides/sandbox.md")

    expect(readme).toContain(
      "AX Code starts with autonomous mode on and runtime isolation in `workspace-write` by default",
    )
    expect(security).toContain("The runtime isolation default is `workspace-write` with network disabled")
    expect(sandbox).toContain("By default, AX Code starts in **workspace-write**")
  })

  test("autonomous safety docs describe sandbox-on as the default", async () => {
    const autonomous = await readRepoFile("docs/guides/autonomous.md")

    expect(autonomous).toContain("Recommended default")
    expect(autonomous).toContain("The default runtime posture is autonomous on plus sandbox on")
  })

  test("security policy supported version table tracks the current minor line", async () => {
    const security = await readRepoFile("SECURITY.md")
    const pkg = JSON.parse(await readFile(path.join(repoRoot, "packages/ax-code/package.json"), "utf-8"))
    const [major, minor] = String(pkg.version).split(".")

    expect(security).toContain(`| ${major}.${minor}.x`)
    expect(security).not.toContain("| 3.2.x")
  })
})
